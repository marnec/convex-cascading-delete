# Convex Cascading Delete

[![npm version](https://badge.fury.io/js/@00akshatsinha00%2Fconvex-cascading-delete.svg)](https://badge.fury.io/js/@00akshatsinha00%2Fconvex-cascading-delete)

A Convex component for managing cascading deletes across related documents. Configure relationships via existing indexes, then delete documents safely knowing all related records will be cleaned up automatically with clear consistency guarantees.

## Why Use This Component?

- **Works with existing schemas** - No need to migrate to special schema definitions
- **Explicit configuration** - Clear, JSON-like rules for cascade relationships
- **Two deletion modes** - Inline for small deletes, batched for large trees
- **Progress tracking** - React hooks for real-time batch deletion progress
- **Safety guards** - Optional `patchDb` helper prevents accidental direct deletes
- **Index validation** - Catch configuration errors at startup, not at delete time
- **Circular handling** - Automatically handles circular and diamond dependencies
- **Full observability** - Returns deletion summary with per-table counts

## Installation

Install the package:

```bash
npm install @00akshatsinha00/convex-cascading-delete
```

Add the component to your Convex app:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import convexCascadingDelete from "@00akshatsinha00/convex-cascading-delete/convex.config";

const app = defineApp();
app.use(convexCascadingDelete);

export default app;
```

## Quick Start

### 1. Define Your Cascade Rules

```ts
// convex/cascading.ts
import { 
  CascadingDelete, 
  defineCascadeRules,
  makeBatchDeleteHandler 
} from "@00akshatsinha00/convex-cascading-delete";
import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";

export const cascadeRules = defineCascadeRules({
  users: [
    { to: "posts", via: "byAuthorId", field: "authorId" },
    { to: "comments", via: "byAuthorId", field: "authorId" }
  ],
  posts: [
    { to: "comments", via: "byPostId", field: "postId" }
  ]
});

export const cd = new CascadingDelete(components.convexCascadingDelete, {
  rules: cascadeRules
});

export const _cascadeBatchHandler = makeBatchDeleteHandler(
  internalMutation,
  components.convexCascadingDelete
);
```

### 2. Use in Your Mutations

```ts
// convex/users.ts
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { cd } from "./cascading";

export const deleteUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    // Deletes user + all their posts + all their comments
    const summary = await cd.deleteWithCascade(ctx, "users", userId);
    console.log("Deleted:", summary);
    // Returns: { users: 1, posts: 5, comments: 23 }
  }
});
```

## API Reference

### `defineCascadeRules(config)`

Defines cascade relationships between tables.

```ts
const rules = defineCascadeRules({
  [sourceTable]: [
    { 
      to: "targetTable",      // Table to cascade to
      via: "indexName",        // Index on target table
      field: "fieldName"       // Field in index that holds parent ID
    }
  ]
});
```

**Requirements:**
- Index must exist on target table
- Index must include the specified field
- Field must contain IDs from source table

### `CascadingDelete` Class

Main interface for deletion operations.

#### Constructor

```ts
const cd = new CascadingDelete(component, { rules });
```

#### `deleteWithCascade(ctx, table, id)`

Deletes a document and all dependents in a single transaction.

```ts
const summary = await cd.deleteWithCascade(ctx, "users", userId);
// Returns: { users: 1, posts: 5, comments: 23 }
```

**Use for:** Small to medium deletion trees (< 4,000 documents)

**Consistency:** Fully atomic - all deletes succeed or all fail

#### `deleteWithCascadeBatched(ctx, table, id, options)`

Deletes a document and dependents across multiple batched transactions.

```ts
const result = await cd.deleteWithCascadeBatched(
  ctx, 
  "organizations", 
  orgId,
  {
    batchHandlerRef: internal.cascading._cascadeBatchHandler,
    batchSize: 2000  // Optional, defaults to 2000
  }
);
// Returns: { jobId: "...", initialSummary: { organizations: 1, teams: 3 } }
```

**Use for:** Large deletion trees (any size)

**Consistency:** Per-batch atomic, inter-batch eventual

**Progress tracking:** Use `jobId` with `useDeletionJobStatus` hook

#### `validateRules(ctx)`

Validates that all configured indexes exist.

```ts
await cd.validateRules(ctx);
// Throws if any index is missing or misconfigured
```

**When to call:** Once during app initialization or in a dev-only check

#### `patchDb(db)`

Returns a proxied database that blocks direct delete calls.

```ts
export const safeDeleteUser = mutation({
  handler: async (ctx, args) => {
    const safeDb = cd.patchDb(ctx.db);
    // safeDb.delete(id) throws error
    // Must use cd.deleteWithCascade() instead
  }
});
```

### React Hooks

#### `useDeletionJobStatus(api, jobId)`

Monitors batch deletion progress with reactive updates.

```tsx
import { useDeletionJobStatus } from "@00akshatsinha00/convex-cascading-delete/react";

function DeletionProgress({ jobId }: { jobId: string | null }) {
  const status = useDeletionJobStatus(api, jobId);
  
  if (!status) return null;
  
  const progress = (status.completedCount / status.totalTargetCount) * 100;
  
  return (
    <div>
      <progress value={progress} max={100} />
      <p>{status.status}: {status.completedCount} / {status.totalTargetCount}</p>
      {status.status === "completed" && (
        <pre>{JSON.stringify(JSON.parse(status.completedSummary), null, 2)}</pre>
      )}
    </div>
  );
}
```

## Schema Requirements

Your schema must have indexes for cascade relationships:

```ts
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
  }),
  
  posts: defineTable({
    authorId: v.id("users"),
    title: v.string(),
    content: v.string(),
  }).index("byAuthorId", ["authorId"]),  // Required for cascade
  
  comments: defineTable({
    authorId: v.id("users"),
    postId: v.id("posts"),
    text: v.string(),
  })
    .index("byAuthorId", ["authorId"])   // For user cascade
    .index("byPostId", ["postId"]),      // For post cascade
});
```

## Examples

### Multi-Level Hierarchy

```ts
const rules = defineCascadeRules({
  organizations: [
    { to: "teams", via: "byOrganizationId", field: "organizationId" }
  ],
  teams: [
    { to: "members", via: "byTeamId", field: "teamId" },
    { to: "projects", via: "byTeamId", field: "teamId" }
  ],
  projects: [
    { to: "tasks", via: "byProjectId", field: "projectId" }
  ],
  tasks: [
    { to: "comments", via: "byTaskId", field: "taskId" }
  ]
});

// Deleting an organization cascades through 5 levels
const summary = await cd.deleteWithCascade(ctx, "organizations", orgId);
// Returns: { organizations: 1, teams: 5, members: 23, projects: 12, tasks: 67, comments: 234 }
```

### Branching Cascades

```ts
const rules = defineCascadeRules({
  users: [
    { to: "posts", via: "byAuthorId", field: "authorId" },
    { to: "comments", via: "byAuthorId", field: "authorId" },
    { to: "likes", via: "byUserId", field: "userId" },
    { to: "follows", via: "byFollowerId", field: "followerId" }
  ]
});

// One parent, multiple dependent types
```

### Circular Dependencies

```ts
const rules = defineCascadeRules({
  users: [
    { to: "friendships", via: "byUserId", field: "userId" }
  ],
  friendships: [
    { to: "users", via: "byFriendId", field: "friendId" }
  ]
});

// Automatically handled with visited set - no infinite loops
```

## Best Practices

1. **Start with inline mode** - Use `deleteWithCascade` for most cases
2. **Switch to batched for large trees** - Use `deleteWithCascadeBatched` when deleting > 4,000 documents
3. **Validate rules on startup** - Call `validateRules()` in a dev-only initialization function
4. **Use patchDb in critical mutations** - Prevent accidental direct deletes in sensitive operations
5. **Monitor batch progress** - Use `useDeletionJobStatus` hook for user feedback
6. **Test cascade rules** - Verify relationships work as expected before production

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  USER'S APP                                                     │
│                                                                 │
│  ┌──────────────────────────────────┐                           │
│  │  User's Mutation                 │                           │
│  │                                  │                           │
│  │  const cd = new CascadingDelete( │                           │
│  │    components.convexCascadingDel,│                           │
│  │    { rules: { ... } }            │                           │
│  │  );                              │                           │
│  │                                  │  ctx.db (APP's tables)    │
│  │  // Inline mode:                 │─────► .query(table)       │
│  │  cd.deleteWithCascade(ctx,       │      .withIndex(idx, ...) │
│  │    "teams", teamId)              │      .collect()           │
│  │                                  │      .delete(id)          │
│  │  // Batched mode:                │                           │
│  │  cd.deleteWithCascadeBatched(ctx,│                           │
│  │    "teams", teamId, opts)        │                           │
│  │                                  │                           │
│  └──────────┬───────────────────────┘                           │
│             │                                                   │
│             │ ctx.runMutation(component.lib.createBatchJob, ...)│
│             │ ctx.runQuery(component.lib.getJobStatus, ...)     │
│             ▼                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  COMPONENT (Isolated — own DB, own transactions)         │   │
│  │                                                          │   │
│  │  Table: deletionJobs                                     │   │
│  │    { status, targets, deleteHandle, batchSize, summary } │   │
│  │                                                          │   │
│  │  Functions:                                              │   │
│  │    createBatchJob(targets, handle, batchSize)            │   │
│  │    processNextBatch(jobId)                               │   │
│  │      ├─ ctx.scheduler.runAfter(0, deleteHandle, batch)   │──►│
│  │      └─ ctx.scheduler.runAfter(200ms, self, jobId)       │   │
│  │    getJobStatus(jobId) → reactive query                  │   │
│  │    reportBatchComplete(jobId, summary)                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│             │                                                   │
│             │ Function handle callback                          │
│             ▼                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  APP's Batch Delete Handler (user exports via helper)    │   │
│  │                                                          │   │
│  │  handler: async (ctx, { targets, jobId }) => {           │   │
│  │    for (t of targets) await ctx.db.delete(t.id);         │   │
│  │    await ctx.runMutation(component.reportBatchComplete,  │   │
│  │      { jobId, summary });                                │   │
│  │  }                                                       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Consistency Guarantees

### Inline Mode
- **Fully atomic** - All deletes succeed or all fail
- **Single transaction** - Respects Convex's ACID guarantees
- **Immediate** - Returns complete summary synchronously

### Batched Mode
- **Per-batch atomic** - Each batch is a separate transaction
- **Inter-batch eventual** - Batches may complete at different times
- **First batch inline** - Initial batch deleted in calling mutation
- **Remaining batches scheduled** - Processed asynchronously with 200ms delay

## Performance Characteristics

- **Inline mode limit:** ~4,000 documents (conservative estimate based on Convex transaction limits)
- **Batch size:** Configurable, defaults to 2,000 documents per batch
- **Traversal:** Depth-first, post-order (children deleted before parents)
- **Cycle detection:** O(1) lookup with visited set
- **Index usage:** Efficient `.withIndex()` queries, no table scans

## Troubleshooting

### "Index does not exist" error

Run `validateRules()` to identify missing indexes:

```ts
await cd.validateRules(ctx);
```

Add the missing index to your schema.

### Batch deletion stuck

Check job status:

```ts
const status = await ctx.runQuery(
  components.convexCascadingDelete.lib.getJobStatus,
  { jobId }
);
console.log(status);
```

### Type errors with table names

Use type assertions for dynamic table access:

```ts
const summary = await cd.deleteWithCascade(ctx, "users", userId as any);
```

## Live Demo

Try the interactive demo: [https://convex-cascading-delete.vercel.app](https://convex-cascading-delete.vercel.app)

## Contributing

Found a bug? Feature request? [File it here](https://github.com/akshatsinha0/convex-cascading-delete/issues).

## License

MIT

## Built For

Convex Components Authoring Challenge - Full-Stack Drop-In Features
