/*
(1.) Example application mutations and queries demonstrating component usage
(2.) Showcases both inline and batched deletion modes with real data
(3.) Provides data access patterns for demo UI

This module implements the example application's core operations, demonstrating
how to use the cascading delete component in practice. It includes mutations for
both inline and batched deletion modes, queries for displaying organizational
hierarchies, and utility functions for data seeding. The operations show proper
integration patterns including error handling, progress tracking, and safety
guard usage. These serve as reference implementations for developers adopting
the component in their own applications.
*/

import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { cd, _cascadeBatchHandler } from "./cascading.js";

/**
 * Deletes an organization and all related data using inline mode.
 * Suitable for organizations with moderate amounts of data.
 */
export const deleteOrganization = mutation({
  args: { organizationId: v.id("organizations") },
  returns: v.any(),
  handler: async (ctx, { organizationId }) => {
    const summary = await cd.deleteWithCascade(
      ctx,
      "organizations",
      organizationId
    );
    return summary;
  },
});

/**
 * Deletes an organization using batched mode for large datasets.
 * Returns job ID for progress tracking.
 */
export const deleteOrganizationBatched = mutation({
  args: {
    organizationId: v.id("organizations"),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    jobId: v.union(v.string(), v.null()),
    initialSummary: v.any(),
  }),
  handler: async (ctx, { organizationId, batchSize }) => {
    const result = await cd.deleteWithCascadeBatched(
      ctx,
      "organizations",
      organizationId,
      {
        batchHandlerRef: _cascadeBatchHandler,
        batchSize: batchSize || 2000,
      }
    );
    return result;
  },
});

/**
 * Deletes a team and its subtree (members, projects, tasks, comments).
 */
export const deleteTeam = mutation({
  args: { teamId: v.id("teams") },
  returns: v.any(),
  handler: async (ctx, { teamId }) => {
    const summary = await cd.deleteWithCascade(ctx, "teams", teamId);
    return summary;
  },
});

/**
 * Deletes a project and its subtree (tasks, comments).
 */
export const deleteProject = mutation({
  args: { projectId: v.id("projects") },
  returns: v.any(),
  handler: async (ctx, { projectId }) => {
    const summary = await cd.deleteWithCascade(ctx, "projects", projectId);
    return summary;
  },
});

/**
 * Retrieves all organizations with nested document counts.
 */
export const getAllOrganizations = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("organizations"),
      _creationTime: v.number(),
      name: v.string(),
      description: v.string(),
      teamCount: v.number(),
    })
  ),
  handler: async (ctx) => {
    const orgs = await ctx.db.query("organizations").collect();

    const orgsWithCounts = await Promise.all(
      orgs.map(async (org) => {
        const teams = await ctx.db
          .query("teams")
          .withIndex("byOrganizationId", (q) => q.eq("organizationId", org._id))
          .collect();

        return {
          ...org,
          teamCount: teams.length,
        };
      })
    );

    return orgsWithCounts;
  },
});

/**
 * Retrieves complete organizational tree with all nested entities.
 */
export const getOrganizationTree = query({
  args: { organizationId: v.id("organizations") },
  returns: v.any(),
  handler: async (ctx, { organizationId }) => {
    const org = await ctx.db.get(organizationId);
    if (!org) return null;

    const teams = await ctx.db
      .query("teams")
      .withIndex("byOrganizationId", (q) => q.eq("organizationId", organizationId))
      .collect();

    const teamsWithData = await Promise.all(
      teams.map(async (team) => {
        const members = await ctx.db
          .query("members")
          .withIndex("byTeamId", (q) => q.eq("teamId", team._id))
          .collect();

        const projects = await ctx.db
          .query("projects")
          .withIndex("byTeamId", (q) => q.eq("teamId", team._id))
          .collect();

        const projectsWithTasks = await Promise.all(
          projects.map(async (project) => {
            const tasks = await ctx.db
              .query("tasks")
              .withIndex("byProjectId", (q) => q.eq("projectId", project._id))
              .collect();

            const tasksWithComments = await Promise.all(
              tasks.map(async (task) => {
                const comments = await ctx.db
                  .query("comments")
                  .withIndex("byTaskId", (q) => q.eq("taskId", task._id))
                  .collect();

                return { ...task, comments };
              })
            );

            return { ...project, tasks: tasksWithComments };
          })
        );

        return { ...team, members, projects: projectsWithTasks };
      })
    );

    return { ...org, teams: teamsWithData };
  },
});

/**
 * Seeds sample data for demonstration.
 */
export const seedSampleData = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Acme Corporation",
      description: "A sample organization for testing cascading deletes",
    });

    const teamId = await ctx.db.insert("teams", {
      organizationId: orgId,
      name: "Engineering",
      description: "Product development team",
    });

    await ctx.db.insert("members", {
      teamId,
      name: "Alice Johnson",
      email: "alice@acme.com",
      role: "Engineer",
    });

    await ctx.db.insert("members", {
      teamId,
      name: "Bob Smith",
      email: "bob@acme.com",
      role: "Manager",
    });

    const projectId = await ctx.db.insert("projects", {
      teamId,
      name: "Website Redesign",
      description: "Modernize company website",
      status: "active",
    });

    const taskId = await ctx.db.insert("tasks", {
      projectId,
      title: "Design homepage mockup",
      description: "Create initial design concepts",
      status: "in_progress",
      assignedTo: "Alice Johnson",
    });

    await ctx.db.insert("comments", {
      taskId,
      authorName: "Bob Smith",
      text: "Looking good! Can we add more color?",
    });

    await ctx.db.insert("comments", {
      taskId,
      authorName: "Alice Johnson",
      text: "Sure, I'll update the palette.",
    });

    return orgId;
  },
});

/**
 * Seeds a larger dataset for stress-testing cascading deletes.
 * Creates 3 organizations with multiple teams, members, projects, tasks, and comments.
 */
export const seedLargeDataset = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const orgNames = [
      { name: "TechCorp Industries", description: "Enterprise software and cloud services" },
      { name: "Creative Labs", description: "Design and media production studio" },
      { name: "DataFlow Systems", description: "Data analytics and machine learning platform" },
    ];

    const teamTemplates = [
      { name: "Engineering", description: "Core product development" },
      { name: "Design", description: "User experience and visual design" },
      { name: "Operations", description: "Infrastructure and reliability" },
    ];

    const memberTemplates = [
      { name: "Alice Chen", email: "alice@example.com", role: "Lead" },
      { name: "Bob Martinez", email: "bob@example.com", role: "Senior" },
      { name: "Carol Davis", email: "carol@example.com", role: "Mid" },
      { name: "Dan Wilson", email: "dan@example.com", role: "Junior" },
    ];

    const projectTemplates = [
      { name: "Platform v2", description: "Next-gen platform rebuild", status: "active" as const },
      { name: "Mobile App", description: "Cross-platform mobile client", status: "active" as const },
      { name: "API Gateway", description: "Unified API layer", status: "completed" as const },
    ];

    const taskStatuses = ["todo", "in_progress", "done"] as const;
    let firstOrgId = "";

    for (let o = 0; o < orgNames.length; o++) {
      const orgId = await ctx.db.insert("organizations", orgNames[o]);
      if (o === 0) firstOrgId = orgId;

      for (let t = 0; t < teamTemplates.length; t++) {
        const teamId = await ctx.db.insert("teams", {
          organizationId: orgId,
          name: `${teamTemplates[t].name} ${o + 1}`,
          description: teamTemplates[t].description,
        });

        for (const member of memberTemplates) {
          await ctx.db.insert("members", {
            teamId,
            name: member.name,
            email: `${member.name.toLowerCase().replace(" ", ".")}+t${t}o${o}@example.com`,
            role: member.role,
          });
        }

        for (let p = 0; p < projectTemplates.length; p++) {
          const projectId = await ctx.db.insert("projects", {
            teamId,
            name: `${projectTemplates[p].name} (T${t + 1})`,
            description: projectTemplates[p].description,
            status: projectTemplates[p].status,
          });

          for (let tk = 0; tk < 3; tk++) {
            const taskId = await ctx.db.insert("tasks", {
              projectId,
              title: `Task ${tk + 1} for ${projectTemplates[p].name}`,
              description: `Implementation task ${tk + 1}`,
              status: taskStatuses[tk % taskStatuses.length],
              assignedTo: memberTemplates[tk % memberTemplates.length].name,
            });

            for (let c = 0; c < 2; c++) {
              await ctx.db.insert("comments", {
                taskId,
                authorName: memberTemplates[(tk + c + 1) % memberTemplates.length].name,
                text: `Comment ${c + 1} on task ${tk + 1}`,
              });
            }
          }
        }
      }
    }

    return firstOrgId;
  },
});

/**
 * Clears all data from the database.
 */
export const clearAllData = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const tables = ["comments", "tasks", "projects", "members", "teams", "organizations"];
    
    for (const table of tables) {
      const docs = await ctx.db.query(table as any).collect();
      for (const doc of docs) {
        await ctx.db.delete(doc._id);
      }
    }

    return null;
  },
});

/**
 * Gets document counts for all tables.
 */
export const getDocumentCounts = query({
  args: {},
  returns: v.object({
    organizations: v.number(),
    teams: v.number(),
    members: v.number(),
    projects: v.number(),
    tasks: v.number(),
    comments: v.number(),
  }),
  handler: async (ctx) => {
    const [organizations, teams, members, projects, tasks, comments] = await Promise.all([
      ctx.db.query("organizations").collect(),
      ctx.db.query("teams").collect(),
      ctx.db.query("members").collect(),
      ctx.db.query("projects").collect(),
      ctx.db.query("tasks").collect(),
      ctx.db.query("comments").collect(),
    ]);

    return {
      organizations: organizations.length,
      teams: teams.length,
      members: members.length,
      projects: projects.length,
      tasks: tasks.length,
      comments: comments.length,
    };
  },
});
