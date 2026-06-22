# project-terminals Specification

## Purpose
TBD - created by archiving change 2026-06-15-add-settings-terminals. Update Purpose after archive.
## Requirements
### Requirement: Project local terminal sessions
The application SHALL provide project-scoped local terminal sessions that are independent from agent sessions and can be restored from saved project terminal configurations.

#### Scenario: Creating a saved project terminal
- **WHEN** the user creates a terminal from Project Settings `Terminals`
- **THEN** the backend saves a project terminal configuration for the current project
- **AND** the default display name is `New Terminal`
- **AND** the default working directory is the current project's repository path
- **AND** the saved configuration is used to start a new local terminal session

#### Scenario: Editing a saved project terminal
- **WHEN** the user edits a project terminal's name, working directory, or launch command and saves
- **THEN** the updated configuration is persisted in the database
- **AND** reopening the project later uses the saved values

#### Scenario: Automatically starting saved terminals when opening a project
- **WHEN** the user opens a project that has saved terminal configurations
- **THEN** the backend loads all saved project terminal configurations for that project
- **AND** starts one local terminal session for each saved configuration
- **AND** exposes those sessions to the frontend without requiring the user to recreate them manually

#### Scenario: Removing a saved project terminal
- **WHEN** the user deletes a terminal card
- **THEN** the frontend closes the corresponding local terminal session
- **AND** the backend removes the saved terminal configuration for that project
- **AND** the backend releases the PTY resources for that session

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

