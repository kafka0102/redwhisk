# project-terminals Specification Delta

## ADDED Requirements

### Requirement: Temporary project terminal sessions

The runtime SHALL support temporary project terminal sessions for feature surfaces that need an interactive PTY without persisting a Project Terminal configuration.

#### Scenario: Starting a temporary terminal for an Agent Session

- **WHEN** the frontend requests a temporary terminal for a selected Agent Session
- **THEN** the backend resolves the Agent Session by `agentSessionId` within the requested Project
- **AND** the backend starts the terminal in that Agent Session's recorded `working_dir`
- **AND** the backend returns a terminal summary containing `sessionId`, `name`, `workingDir`, and `launchCommand`
- **AND** the backend does not insert a row into `project_terminal_configs`

#### Scenario: Agent Session belongs to another Project

- **WHEN** the requested Agent Session does not belong to the requested Project
- **THEN** the backend fails with a structured Project Terminal validation error
- **AND** no PTY is started
