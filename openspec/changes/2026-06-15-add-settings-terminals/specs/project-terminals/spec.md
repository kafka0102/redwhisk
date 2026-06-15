## ADDED Requirements

### Requirement: Project local terminal sessions
The application SHALL provide project-scoped local terminal sessions that are independent from agent sessions.

#### Scenario: Creating a local project terminal
- **WHEN** the user creates a terminal from Project Settings `Terminals`
- **THEN** the backend starts a new terminal session for the current project
- **AND** the session uses the current project's repository path as its working directory
- **AND** the terminal is exposed to the frontend with the default display name `New Terminal`

#### Scenario: Interacting with a local project terminal
- **WHEN** a project terminal card is expanded
- **THEN** the frontend can restore terminal output, stream new output, send input, and resize the session
- **AND** these operations do not depend on agent session identifiers

#### Scenario: Closing a local project terminal
- **WHEN** the user deletes a terminal card
- **THEN** the frontend closes the corresponding local terminal session
- **AND** the backend releases the PTY resources for that session
