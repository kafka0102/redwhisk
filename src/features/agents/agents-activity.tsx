export function AgentsActivity() {
  return (
    <main className="activity-surface">
      <header className="surface-header">
        <div className="surface-header__copy">
          <h2>Agents</h2>
          <p className="surface-header__description">
            Review runs, terminal output, and completion evidence for the
            current project.
          </p>
        </div>
      </header>
      <section className="empty-state-panel" aria-label="Agents empty state">
        <h3>Agent sessions are not available yet.</h3>
        <p>
          Start from Issues first. Runs will appear here after the project flow
          is wired in.
        </p>
      </section>
    </main>
  );
}
