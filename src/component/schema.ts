/*
(1.) Database schema for batch deletion job tracking and management
(2.) Stores job state, progress, and completion summaries for large cascading deletes
(3.) Enables reactive progress monitoring and failure recovery

This schema defines the deletionJobs table which manages the lifecycle of batched
cascade delete operations. Each job tracks remaining targets to be deleted, batch
processing configuration, completion progress, and error states. The status index
enables efficient queries for active and failed jobs. The remainingTargets array
acts as a FIFO queue that shrinks as batches are processed. Completion summaries
are stored as JSON strings to accommodate dynamic table name keys that cannot be
expressed in Convex's static validator system.
*/

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  deletionJobs: defineTable({
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
    ),
    totalTargetCount: v.number(),
    remainingTargets: v.array(
      v.object({ table: v.string(), id: v.string() })
    ),
    batchSize: v.number(),
    deleteHandleStr: v.string(),
    completedCount: v.number(),
    completedSummary: v.string(),   // JSON-serialized Record<string, number>
    error: v.optional(v.string()),  // JSON-serialized string[] of error messages
    onCompleteHandleStr: v.optional(v.string()), // serialized FunctionReference for completion callback
  }).index("byStatus", ["status"]),
});
