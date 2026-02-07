import "./App.css";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useDeletionJobStatus } from "@00akshatsinha00/convex-cascading-delete/react";

function App() {
  const [activeTab, setActiveTab] = useState<"overview" | "demo">(() => {
    const saved = localStorage.getItem("activeTab");
    return (saved === "demo" || saved === "overview") ? saved : "overview";
  });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<any>(null);

  const handleTabChange = (tab: "overview" | "demo") => {
    setActiveTab(tab);
    localStorage.setItem("activeTab", tab);
  };

  const organizations = useQuery(api.operations.getAllOrganizations);
  const counts = useQuery(api.operations.getDocumentCounts);
  const jobStatus = useDeletionJobStatus(api as any, jobId);

  const seedData = useMutation(api.operations.seedSampleData);
  const seedLarge = useMutation(api.operations.seedLargeDataset);
  const clearData = useMutation(api.operations.clearAllData);
  const deleteOrg = useMutation(api.operations.deleteOrganization);
  const deleteOrgBatched = useMutation(api.operations.deleteOrganizationBatched);

  const handleSeedData = async () => {
    await seedData();
  };

  const handleClearData = async () => {
    await clearData();
    setLastSummary(null);
    setJobId(null);
  };

  const handleDeleteInline = async (orgId: string) => {
    setDeletingId(orgId);
    try {
      const summary = await deleteOrg({ organizationId: orgId as any });
      setLastSummary(summary);
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteBatched = async (orgId: string) => {
    setDeletingId(orgId);
    try {
      const result = await deleteOrgBatched({
        organizationId: orgId as any,
        batchSize: 100,
      });
      setJobId(result.jobId);
      setLastSummary(result.initialSummary);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1 className="title">Cascading Delete</h1>
        <p className="subtitle">
          Manage cascading deletes across related documents in Convex
        </p>
      </header>

      <nav className="nav">
        <button
          className={`nav-item ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => handleTabChange("overview")}
        >
          Overview
        </button>
        <button
          className={`nav-item ${activeTab === "demo" ? "active" : ""}`}
          onClick={() => handleTabChange("demo")}
        >
          Demo
        </button>
      </nav>

      <main className="content">
        {activeTab === "overview" && (
          <div className="section">
            <h2 className="section-title">What is Cascading Delete?</h2>
            <p className="text">
              A Convex component that automatically deletes related documents
              when you delete a parent document. Configure relationships via
              existing indexes, then delete documents safely knowing all related
              records will be cleaned up automatically.
            </p>

            <div className="feature-grid">
              <div className="feature-card">
                <svg
                  className="feature-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <h3 className="feature-title">Configure Once</h3>
                <p className="feature-text">
                  Define cascade relationships using your existing indexes
                </p>
              </div>

              <div className="feature-card">
                <svg
                  className="feature-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <h3 className="feature-title">Delete Safely</h3>
                <p className="feature-text">
                  Automatically clean up all related records with one function
                  call
                </p>
              </div>

              <div className="feature-card">
                <svg
                  className="feature-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h3 className="feature-title">Consistency Guaranteed</h3>
                <p className="feature-text">
                  Batch processing with explicit consistency semantics
                </p>
              </div>
            </div>

            <div className="code-section">
              <h3 className="code-title">Quick Example</h3>
              <pre className="code-block">
                <code>{`import { CascadingDelete, defineCascadeRules } from "@00akshatsinha00/convex-cascading-delete";

const cascadeRules = defineCascadeRules({
  users: [
    { to: "posts", via: "by_author", field: "authorId" },
    { to: "comments", via: "by_author", field: "authorId" }
  ],
  posts: [
    { to: "comments", via: "by_post", field: "postId" }
  ]
});

const cd = new CascadingDelete(components.convexCascadingDelete, {
  rules: cascadeRules
});

// Delete user and all related data
const summary = await cd.deleteWithCascade(ctx, "users", userId);
// Returns: { users: 1, posts: 5, comments: 23 }`}</code>
              </pre>
            </div>
          </div>
        )}

        {activeTab === "demo" && (
          <div className="section">
            <h2 className="section-title">Demo</h2>
            <p className="text">
              Try out cascading deletes with a sample organizational hierarchy.
              Create sample data, then delete organizations to see how all
              related teams, members, projects, tasks, and comments are
              automatically cleaned up.
            </p>

            <div className="demo-controls">
              <button className="demo-button primary" onClick={handleSeedData}>
                <svg
                  className="button-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Seed Sample Data
              </button>
              <button className="demo-button primary" onClick={() => seedLarge()}>
                <svg
                  className="button-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                </svg>
                Seed Large Dataset
              </button>
              <button className="demo-button secondary" onClick={handleClearData}>
                <svg
                  className="button-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Clear All Data
              </button>
            </div>

            {counts && (
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-value">{counts.organizations}</div>
                  <div className="stat-label">Organizations</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{counts.teams}</div>
                  <div className="stat-label">Teams</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{counts.members}</div>
                  <div className="stat-label">Members</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{counts.projects}</div>
                  <div className="stat-label">Projects</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{counts.tasks}</div>
                  <div className="stat-label">Tasks</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{counts.comments}</div>
                  <div className="stat-label">Comments</div>
                </div>
              </div>
            )}

            {organizations && organizations.length > 0 && (
              <div className="organizations-list">
                <h3 className="list-title">Organizations</h3>
                {organizations.map((org: any) => (
                  <div key={org._id} className="org-card">
                    <div className="org-info">
                      <h4 className="org-name">{org.name}</h4>
                      <p className="org-description">{org.description}</p>
                      <p className="org-meta">{org.teamCount} teams</p>
                    </div>
                    <div className="org-actions">
                      <button
                        className="action-button inline"
                        onClick={() => handleDeleteInline(org._id)}
                        disabled={deletingId === org._id}
                      >
                        {deletingId === org._id ? "Deleting..." : "Delete (Inline)"}
                      </button>
                      <button
                        className="action-button batched"
                        onClick={() => handleDeleteBatched(org._id)}
                        disabled={deletingId === org._id}
                      >
                        {deletingId === org._id ? "Deleting..." : "Delete (Batched)"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {organizations && organizations.length === 0 && (
              <div className="empty-state">
                <svg
                  className="empty-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
                <p className="empty-text">No data yet. Click "Seed Sample Data" to get started.</p>
              </div>
            )}

            {lastSummary && (
              <div className="summary-section">
                <h3 className="summary-title">Last Deletion Summary</h3>
                <div className="summary-grid">
                  {Object.entries(lastSummary).map(([table, count]) => (
                    <div key={table} className="summary-item">
                      <span className="summary-table">{table}</span>
                      <span className="summary-count">{count as number}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {jobStatus && (
              <div className="progress-section">
                <h3 className="progress-title">Batch Deletion Progress</h3>
                <div className="progress-bar-container">
                  <div
                    className="progress-bar"
                    style={{
                      width: `${(jobStatus.completedCount / jobStatus.totalTargetCount) * 100}%`,
                    }}
                  />
                </div>
                <p className="progress-text">
                  {jobStatus.status}: {jobStatus.completedCount} / {jobStatus.totalTargetCount} documents
                </p>
                {jobStatus.status === "completed" && (
                  <div className="summary-grid">
                    {Object.entries(JSON.parse(jobStatus.completedSummary)).map(([table, count]) => (
                      <div key={table} className="summary-item">
                        <span className="summary-table">{table}</span>
                        <span className="summary-count">{count as number}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="footer">
        <p className="footer-text">
          Built for the Convex Components Authoring Challenge
        </p>
      </footer>
    </div>
  );
}

export default App;
