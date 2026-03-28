/*
(1.) Test suite for component batch deletion job lifecycle management
(2.) Validates job creation, status queries, progress reporting, and state transitions
(3.) Uses convex-test to simulate real database operations against component schema

This test suite exercises the component's backend functions that manage batch deletion
jobs. It verifies correct behavior of the job lifecycle from creation through completion,
including edge cases like non-existent jobs, invalid state transitions, and progressive
summary merging. The tests use convex-test to run against the actual component schema,
ensuring that database operations, validators, and state transitions behave correctly
in a realistic execution environment.
*/

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "./schema.js";
import { api, internal } from "./_generated/api.js";

const modules = import.meta.glob("./**/*.ts");


describe("createBatchJob", () => {
  it("should create a job with pending status and correct fields", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [
        { table: "users", id: "user1" },
        { table: "posts", id: "post1" },
        { table: "posts", id: "post2" },
      ],
      deleteHandleStr: "handle:abc123",
      batchSize: 100,
    });

    expect(jobId).toBeDefined();
    expect(typeof jobId).toBe("string");

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status).not.toBeNull();
    expect(status!.status).toBe("pending");
    expect(status!.totalTargetCount).toBe(3);
    expect(status!.completedCount).toBe(0);
    expect(status!.completedSummary).toBe(JSON.stringify({}));
  });

  it("should store all targets in remaining targets", async () => {
    const t = convexTest(schema, modules);
    const targets = [
      { table: "users", id: "u1" },
      { table: "users", id: "u2" },
      { table: "posts", id: "p1" },
    ];

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets,
      deleteHandleStr: "handle:xyz",
      batchSize: 50,
    });

    const job = await t.run(async (ctx) => {
      return await ctx.db.get(jobId as any);
    });

    expect(job).not.toBeNull();
    expect(job!.remainingTargets).toHaveLength(3);
    expect(job!.batchSize).toBe(50);
    expect(job!.deleteHandleStr).toBe("handle:xyz");
  });

  it("should handle empty targets array", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [],
      deleteHandleStr: "handle:empty",
      batchSize: 100,
    });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status!.totalTargetCount).toBe(0);
    expect(status!.completedCount).toBe(0);
  });
});

describe("getJobStatus", () => {
  it("should return null for non-existent job", async () => {
    const t = convexTest(schema, modules);

    const status = await t.query(api.lib.getJobStatus, {
      jobId: "nonexistent_id_12345",
    });

    expect(status).toBeNull();
  });

  it("should return correct status fields for existing job", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [{ table: "docs", id: "d1" }],
      deleteHandleStr: "handle:test",
      batchSize: 10,
    });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status).toEqual({
      status: "pending",
      totalTargetCount: 1,
      completedCount: 0,
      completedSummary: "{}",
      error: undefined,
    });
  });
});

describe("reportBatchComplete", () => {
  it("should increment completed count from batch summary", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [
        { table: "users", id: "u1" },
        { table: "posts", id: "p1" },
        { table: "posts", id: "p2" },
      ],
      deleteHandleStr: "handle:test",
      batchSize: 100,
    });

    await t.mutation(api.lib.reportBatchComplete, {
      jobId,
      batchSummary: JSON.stringify({ users: 1, posts: 2 }),
    });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status!.completedCount).toBe(3);
    expect(JSON.parse(status!.completedSummary)).toEqual({
      users: 1,
      posts: 2,
    });
  });

  it("should merge summaries across multiple batch completions", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: Array.from({ length: 10 }, (_, i) => ({
        table: i < 5 ? "users" : "posts",
        id: `id${i}`,
      })),
      deleteHandleStr: "handle:merge",
      batchSize: 5,
    });

    await t.mutation(api.lib.reportBatchComplete, {
      jobId,
      batchSummary: JSON.stringify({ users: 3, posts: 2 }),
    });

    await t.mutation(api.lib.reportBatchComplete, {
      jobId,
      batchSummary: JSON.stringify({ users: 2, posts: 1 }),
    });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status!.completedCount).toBe(8);
    expect(JSON.parse(status!.completedSummary)).toEqual({
      users: 5,
      posts: 3,
    });
  });

  it("should mark job as completed when all targets are processed and none remain", async () => {
    const t = convexTest(schema, modules);

    const targets = [
      { table: "users", id: "u1" },
      { table: "posts", id: "p1" },
    ];

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets,
      deleteHandleStr: "handle:complete",
      batchSize: 100,
    });

    // Simulate that remaining targets have been consumed by processNextBatch
    await t.run(async (ctx) => {
      await ctx.db.patch(jobId as any, {
        remainingTargets: [],
        status: "processing",
      });
    });

    await t.mutation(api.lib.reportBatchComplete, {
      jobId,
      batchSummary: JSON.stringify({ users: 1, posts: 1 }),
    });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status!.status).toBe("completed");
    expect(status!.completedCount).toBe(2);
  });

  it("should not mark as completed if remaining targets exist", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [
        { table: "users", id: "u1" },
        { table: "users", id: "u2" },
        { table: "users", id: "u3" },
      ],
      deleteHandleStr: "handle:partial",
      batchSize: 1,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(jobId as any, {
        status: "processing",
      });
    });

    await t.mutation(api.lib.reportBatchComplete, {
      jobId,
      batchSummary: JSON.stringify({ users: 1 }),
    });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status!.status).toBe("processing");
    expect(status!.completedCount).toBe(1);
  });

  it("should mark job as failed when errors occur and not all targets were deleted", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [
        { table: "users", id: "u1" },
        { table: "users", id: "u2" },
      ],
      deleteHandleStr: "handle:fail",
      batchSize: 100,
    });

    // Simulate: all targets dispatched, but only 1 of 2 succeeded
    await t.run(async (ctx) => {
      await ctx.db.patch(jobId as any, {
        remainingTargets: [],
        status: "processing",
      });
    });

    await t.mutation(api.lib.reportBatchComplete, {
      jobId,
      batchSummary: JSON.stringify({ users: 1 }),
      errors: JSON.stringify(["users:u2 - Document not found"]),
    });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status!.status).toBe("failed");
    expect(status!.completedCount).toBe(1);
    expect(status!.error).toBeDefined();
    expect(JSON.parse(status!.error!)).toContain("users:u2 - Document not found");
  });

  it("should silently handle non-existent job", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.lib.reportBatchComplete, {
        jobId: "nonexistent_id_12345",
        batchSummary: JSON.stringify({ users: 1 }),
      })
    ).resolves.toBeNull();
  });
});

describe("kickOffProcessing", () => {
  it("should throw error for non-existent job", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.lib.kickOffProcessing, { jobId: "nonexistent_id_12345" })
    ).rejects.toThrow("not found");
  });

  it("should throw error if job is not in pending state", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [],
      deleteHandleStr: "handle:already",
      batchSize: 100,
    });

    // Manually transition to processing to test the guard
    await t.run(async (ctx) => {
      await ctx.db.patch(jobId as any, { status: "processing" });
    });

    await expect(
      t.mutation(api.lib.kickOffProcessing, { jobId })
    ).rejects.toThrow("not in pending state");
  });
});

describe("processNextBatch", () => {
  it("should do nothing for non-existent job", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(internal.lib.processNextBatch as any, {
        jobId: "nonexistent_id_12345",
      })
    ).resolves.toBeNull();
  });

  it("should do nothing if job is not processing", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [{ table: "users", id: "u1" }],
      deleteHandleStr: "handle:notprocessing",
      batchSize: 100,
    });

    // Job is in pending state, not processing
    await expect(
      t.mutation(internal.lib.processNextBatch as any, { jobId })
    ).resolves.toBeNull();

    // Job should remain in pending state
    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status!.status).toBe("pending");
  });

  it("should do nothing when remaining targets are empty", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [],
      deleteHandleStr: "handle:empty",
      batchSize: 100,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(jobId as any, { status: "processing" });
    });

    // With empty remaining targets, processNextBatch should return immediately
    await t.mutation(internal.lib.processNextBatch as any, { jobId });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status!.status).toBe("processing");
  });
});
