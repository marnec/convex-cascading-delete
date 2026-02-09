/*
(1.) Primary client API for cascading delete operations in application context
(2.) Implements depth-first traversal with cycle detection for inline deletions
(3.) Provides batch processing coordination and safety guard utilities

This module exports the CascadingDelete class which serves as the main interface
for applications using the component. The class encapsulates cascade configuration
and provides methods for both inline and batched deletion modes. Inline mode performs
complete traversal and deletion in a single transaction using post-order depth-first
search with a visited set for cycle prevention. Batched mode collects all targets
first, then coordinates distributed deletion across multiple transactions via the
component's job management system. The patchDb utility enforces cascade-only deletion
by intercepting direct db.delete calls.
*/

import { createFunctionHandle } from "convex/server";
import { v } from "convex/values";
import type {
  GenericMutationCtx,
  GenericQueryCtx,
  GenericDataModel,
  FunctionReference,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import type {
  CascadeConfig,
  DeletionSummary,
  DeletionTarget,
} from "../component/types.js";

export { defineCascadeRules } from "../component/config.js";
export type {
  CascadeConfig,
  CascadeRule,
  DeletionSummary,
  DeletionTarget,
  BatchJobStatus,
} from "../component/types.js";

type MutationCtx = {
  db: any;
  runMutation: GenericMutationCtx<GenericDataModel>["runMutation"];
  runQuery: GenericMutationCtx<GenericDataModel>["runQuery"];
  scheduler: GenericMutationCtx<GenericDataModel>["scheduler"];
};

type QueryCtx = {
  db: any;
};

/**
 * Main class for managing cascading delete operations.
 * 
 * @example
 * ```typescript
 * const cd = new CascadingDelete(components.convexCascadingDelete, {
 *   rules: cascadeRules
 * });
 * 
 * // Inline mode (small deletes)
 * const summary = await cd.deleteWithCascade(ctx, "users", userId);
 * 
 * // Batched mode (large deletes)
 * const { jobId } = await cd.deleteWithCascadeBatched(ctx, "users", userId, {
 *   batchHandlerRef: internal.cascadeBatchHandler,
 *   batchSize: 2000
 * });
 * ```
 */
export class CascadingDelete {
  private rules: CascadeConfig;
  private component: ComponentApi;

  constructor(component: ComponentApi, options: { rules: CascadeConfig }) {
    this.component = component;
    this.rules = options.rules;
  }

  /**
   * Deletes a document and all its cascading dependents in a single transaction.
   * Uses depth-first post-order traversal with cycle detection.
   * 
   * @param ctx - Mutation context with db access
   * @param table - Source table name
   * @param id - Document ID to delete
   * @returns Summary of documents deleted per table
   */
  async deleteWithCascade(
    ctx: MutationCtx,
    table: string,
    id: string
  ): Promise<DeletionSummary> {
    const visited = new Set<string>();
    const summary: DeletionSummary = {};

    await this.collectAndDelete(ctx, table, id, visited, summary);

    return summary;
  }

  /**
   * Internal recursive function for traversal and deletion.
   * Post-order: deletes children before parents.
   */
  private async collectAndDelete(
    ctx: MutationCtx,
    table: string,
    id: string,
    visited: Set<string>,
    summary: DeletionSummary
  ): Promise<void> {
    const key = `${table}:${id}`;
    if (visited.has(key)) {
      return;
    }
    visited.add(key);

    const rules = this.rules[table] || [];

    for (const rule of rules) {
      const dependents = await ctx.db
        .query(rule.to)
        .withIndex(rule.via, (q: any) => q.eq(rule.field, id))
        .collect();

      for (const dep of dependents) {
        await this.collectAndDelete(ctx, rule.to, dep._id, visited, summary);
      }
    }

    try {
      await ctx.db.delete(id);
      summary[table] = (summary[table] || 0) + 1;
    } catch {
      // Already deleted (OCC retry or concurrent cascade)
    }
  }

  /**
   * Deletes a document and its dependents using batched processing.
   * First batch is deleted inline, remaining batches are scheduled.
   * 
   * @param ctx - Mutation context
   * @param table - Source table name
   * @param id - Document ID to delete
   * @param options - Batch configuration
   * @returns Job ID and initial batch summary
   */
  async deleteWithCascadeBatched(
    ctx: MutationCtx,
    table: string,
    id: string,
    options: {
      batchHandlerRef: FunctionReference<"mutation">;
      batchSize?: number;
    }
  ): Promise<{ jobId: string | null; initialSummary: DeletionSummary }> {
    const batchSize = options.batchSize || 2000;

    // Phase 1: Collect all targets
    const visited = new Set<string>();
    const targets: DeletionTarget[] = [];
    await this.collectTargets(ctx, table, id, visited, targets);

    // Phase 2: Delete first batch inline
    const firstBatch = targets.slice(0, batchSize);
    const initialSummary: DeletionSummary = {};

    for (const target of firstBatch) {
      try {
        await ctx.db.delete(target.id);
        initialSummary[target.table] = (initialSummary[target.table] || 0) + 1;
      } catch {
        // Already deleted
      }
    }

    // Phase 3: Schedule remaining batches
    const remaining = targets.slice(batchSize);
    if (remaining.length === 0) {
      return { jobId: null, initialSummary };
    }

    const handle = await createFunctionHandle(options.batchHandlerRef);
    const jobId = await ctx.runMutation(this.component.lib.createBatchJob, {
      targets: remaining,
      deleteHandleStr: handle,
      batchSize,
    });

    await ctx.runMutation(this.component.lib.kickOffProcessing, { jobId });

    return { jobId, initialSummary };
  }

  /**
   * Collects all deletion targets without deleting (read-only traversal).
   */
  private async collectTargets(
    ctx: QueryCtx,
    table: string,
    id: string,
    visited: Set<string>,
    targets: DeletionTarget[]
  ): Promise<void> {
    const key = `${table}:${id}`;
    if (visited.has(key)) {
      return;
    }
    visited.add(key);

    const rules = this.rules[table] || [];

    for (const rule of rules) {
      const dependents = await ctx.db
        .query(rule.to)
        .withIndex(rule.via, (q: any) => q.eq(rule.field, id))
        .collect();

      for (const dep of dependents) {
        await this.collectTargets(ctx, rule.to, dep._id, visited, targets);
      }
    }

    targets.push({ table, id });
  }

  /**
   * Validates that all configured indexes exist in the database.
   * Should be called once during app initialization.
   * 
   * @param ctx - Query context with db access
   * @throws Error if any index is missing or misconfigured
   */
  async validateRules(ctx: QueryCtx): Promise<void> {
    for (const [sourceTable, rules] of Object.entries(this.rules)) {
      for (const rule of rules) {
        try {
          await ctx.db
            .query(rule.to)
            .withIndex(rule.via, (q: any) => q.eq(rule.field, "__validation__"))
            .first();
        } catch (error) {
          throw new Error(
            `Cascade validation failed: Index "${rule.via}" with field "${rule.field}" ` +
              `does not exist on table "${rule.to}". Define it in your schema. ` +
              `Source table: "${sourceTable}"`
          );
        }
      }
    }
  }

  /**
   * Returns a proxied database writer that blocks direct delete calls.
   * Forces use of cascade delete methods for safety.
   * 
   * @param db - Original database writer
   * @returns Proxied database writer with delete disabled
   */
  patchDb(db: any): any {
    return new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "delete") {
          return (...args: any[]) => {
            throw new Error(
              "Direct db.delete() is disabled. " +
                "Use CascadingDelete.deleteWithCascade() instead."
            );
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }
}

/**
 * Factory function to create app-side batch deletion handler.
 * 
 * @param internalMutationBuilder - Internal mutation builder from app
 * @param componentRef - Reference to the cascading delete component
 * @returns Internal mutation that processes deletion batches
 * 
 * @example
 * ```typescript
 * export const _cascadeBatchHandler = makeBatchDeleteHandler(
 *   internalMutation,
 *   components.convexCascadingDelete
 * );
 * ```
 */
export function makeBatchDeleteHandler(
  internalMutationBuilder: any,
  componentRef: ComponentApi
) {
  return internalMutationBuilder({
    args: {
      targets: v.array(v.object({ table: v.string(), id: v.string() })),
      jobId: v.string(),
    },
    handler: async (ctx: any, { targets, jobId }: any) => {
      const batchSummary: Record<string, number> = {};
      const errors: string[] = [];

      for (const { table, id } of targets) {
        try {
          await ctx.db.delete(id);
          batchSummary[table] = (batchSummary[table] || 0) + 1;
        } catch (error: any) {
          // Document already deleted or other error - log for observability
          errors.push(`${table}:${id} - ${error.message || 'Unknown error'}`);
        }
      }

      await ctx.runMutation(componentRef.lib.reportBatchComplete, {
        jobId,
        batchSummary: JSON.stringify(batchSummary),
        errors: errors.length > 0 ? JSON.stringify(errors) : undefined,
      });
    },
  });
}
