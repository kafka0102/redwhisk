export function ProjectSettingsActivity() {
  return (
    <main className="activity-surface">
      <header className="surface-header">
        <div className="surface-header__copy">
          <h2>Settings</h2>
          <p className="surface-header__description">
            Keep repository paths, runtime defaults, and local preferences for
            the current project in one place.
          </p>
        </div>
      </header>
      <section className="empty-state-panel" aria-label="Settings empty state">
        <h3>Project settings are not available yet.</h3>
        <p>
          This surface will hold local configuration once the settings flow is
          implemented.
        </p>
      </section>
    </main>
  );
}
