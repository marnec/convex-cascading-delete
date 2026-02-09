/*
(1.) Inserts a large dataset for testing batched cascading deletes
(2.) Creates 3 orgs x 3 teams x 4 members, 3 projects, 3 tasks, 2 comments each
(3.) Total document count exceeds inline deletion limits

Inserts enough documents that inline (single-transaction) deletion will hit
Convex transaction limits. This forces use of batched deletion mode, which
deletes in multiple scheduled transactions with progress tracking.
*/

import { v } from "convex/values";
import { mutation } from "./_generated/server.js";

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
