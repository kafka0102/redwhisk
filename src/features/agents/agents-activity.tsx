interface AgentsActivityProps {
  activeSessionId: number | null;
}

export function AgentsActivity({ activeSessionId }: AgentsActivityProps) {
  return (
    <main className="activity-surface">
      <div>
        <h2>Agents</h2>
      </div>
      {activeSessionId ? (
        <p className="empty-state">{`Session #${activeSessionId} selected. Agent sessions will appear here after the project flow is implemented.`}</p>
      ) : (
        <p className="empty-state">
          Agent sessions will appear here after the project flow is implemented.
        </p>
      )}
    </main>
  );
}
