/*
(1.) Component backend functions for managing batch deletion job lifecycle
(2.) Handles job creation, batch processing orchestration, and progress tracking
(3.) Coordinates with app-side deletion handlers via function handles

This module implements the component's core batch processing logic. Jobs are created
with pending status and contain all targets to be deleted. The processing flow uses
the scheduler to distribute deletion work across multiple transactions, respecting
Convex's transaction limits. Each batch is processed atomically by the app's deletion
handler, which reports completion back to the component. The 200ms delay between
batches prevents scheduler flooding and allows concurrent operations. Status queries
enable reactive UI updates during long-running deletion operations.
*/

import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";

/**
 * Creates a new batch deletion job with pending status.
 * 
 * @param targets - Array of documents to be deleted across batches
 * @param deleteHandleStr - Function handle string for app's batch deletion handler
 * @param batchSize - Number of documents to delete per batch
 * @returns Job ID for tracking progress
 */
export const createBatchJob = mutation({
  args: {
    targets: v.array(v.object({ table: v.string(), id: v.string() })),
    deleteHandleStr: v.string(),
    batchSize: v.number(),
    onCompleteHandleStr: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, { targets, deleteHandleStr, batchSize, onCompleteHandleStr }) => {
    const jobId = await ctx.db.insert("deletionJobs", {
      status: "pending",
      totalTargetCount: targets.length,
      remainingTargets: targets,
      batchSize,
      deleteHandleStr,
      completedCount: 0,
      completedSummary: JSON.stringify({}),
      onCompleteHandleStr,
    });

    return jobId;
  },
});

/**
 * Initiates batch processing for a pending job.
 * Sets status to processing and triggers first batch.
 * 
 * @param jobId - ID of the job to start processing
 */
export const kickOffProcessing = mutation({
  args: { jobId: v.string() },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId as Id<"deletionJobs">);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status !== "pending") {
      throw new Error(`Job ${jobId} is not in pending state`);
    }

    await ctx.db.patch(jobId as Id<"deletionJobs">, {
      status: "processing",
    });

    await ctx.scheduler.runAfter(0, internal.lib.processNextBatch as any, { jobId });
  },
});

/**
 * Processes the next batch of deletions for a job.
 * Schedules app's deletion handler and reschedules itself if more batches remain.
 * 
 * @param jobId - ID of the job being processed
 */
export const processNextBatch = internalMutation({
  args: { jobId: v.string() },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId as Id<"deletionJobs">);
    if (!job) {
      return;
    }

    if (job.status !== "processing") {
      return;
    }

    if (job.remainingTargets.length === 0) {
      return;
    }

    const batch = job.remainingTargets.slice(0, job.batchSize);
    const remaining = job.remainingTargets.slice(job.batchSize);

    await ctx.db.patch(jobId as Id<"deletionJobs">, {
      remainingTargets: remaining,
    });

    const deleteHandle = job.deleteHandleStr as any;
    await ctx.scheduler.runAfter(0, deleteHandle, {
      targets: batch,
      jobId,
    });

    if (remaining.length > 0) {
      await ctx.scheduler.runAfter(200, internal.lib.processNextBatch as any, {
        jobId,
      });
    }
  },
});

/**
 * Records completion of a batch and updates job progress.
 * Marks job as completed when all batches finish.
 * 
 * @param jobId - ID of the job
 * @param batchSummary - JSON string of deletion counts for this batch
 * @param errors - Optional JSON string array of error messages for observability
 */
export const reportBatchComplete = mutation({
  args: {
    jobId: v.string(),
    batchSummary: v.string(),
    errors: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, batchSummary, errors }) => {
    const job = await ctx.db.get(jobId as Id<"deletionJobs">);
    if (!job) {
      return;
    }

    const currentSummary = JSON.parse(job.completedSummary);
    const batchCounts = JSON.parse(batchSummary);

    for (const [table, count] of Object.entries(batchCounts)) {
      currentSummary[table] = (currentSummary[table] || 0) + (count as number);
    }

    const batchCount = Object.values(batchCounts).reduce(
      (sum: number, count) => sum + (count as number),
      0
    );
    const newCompletedCount = job.completedCount + batchCount;

    const updates: any = {
      completedCount: newCompletedCount,
      completedSummary: JSON.stringify(currentSummary),
    };

    // Accumulate errors for observability
    if (errors) {
      const batchErrors = JSON.parse(errors);
      const existingErrors = job.error ? JSON.parse(job.error) : [];
      updates.error = JSON.stringify([...existingErrors, ...batchErrors]);
    }

    // Terminal state: no remaining targets means all batches have been dispatched
    const isTerminal = job.remainingTargets.length === 0;

    if (isTerminal) {
      const hasErrors = updates.error || job.error;
      updates.status = hasErrors && newCompletedCount < job.totalTargetCount
        ? "failed"
        : "completed";
    }

    await ctx.db.patch(jobId as Id<"deletionJobs">, updates);

    // Schedule callback when job reaches a terminal state (completed or failed)
    if (isTerminal && job.onCompleteHandleStr) {
      await ctx.scheduler.runAfter(0, job.onCompleteHandleStr as any, {
        summary: JSON.stringify(currentSummary),
        status: updates.status,
      });
    }
  },
});

/**
 * Retrieves current status of a deletion job.
 * Reactive query that updates as batches complete.
 * 
 * @param jobId - ID of the job to query
 * @returns Job status with progress information
 */
export const getJobStatus = query({
  args: { jobId: v.string() },
  returns: v.union(
    v.object({
      status: v.union(
        v.literal("pending"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed")
      ),
      totalTargetCount: v.number(),
      completedCount: v.number(),
      completedSummary: v.string(),
      error: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId as Id<"deletionJobs">);
    if (!job) {
      return null;
    }

    return {
      status: job.status,
      totalTargetCount: job.totalTargetCount,
      completedCount: job.completedCount,
      completedSummary: job.completedSummary,
      error: job.error,
    };
  },
});
