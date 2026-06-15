## ADDED Requirements

### Requirement: Project creation confirmation form
The project home SHALL validate a selected repository before creation and present a confirmation form before persisting the project.

#### Scenario: Creating a project from a valid git repository
- **WHEN** the user clicks `Create Project`
- **AND** selects a valid Git repository directory
- **THEN** the app opens a project creation dialog instead of creating immediately
- **AND** the dialog shows the same fields as Settings `General`
- **AND** `Project Name` defaults to the repository directory name
- **AND** `Git completion strategy` defaults to `auto commit`

#### Scenario: Confirming project creation
- **WHEN** the user confirms the creation dialog
- **THEN** the frontend sends `name`, `repoPath`, and `completionPolicy` to project creation
- **AND** the project is persisted only after that confirmation

#### Scenario: Rejecting a non-git repository during create flow
- **WHEN** the user selects a directory that is not a Git repository
- **THEN** the project creation dialog does not open
- **AND** the project home shows an error explaining that the directory is not a Git repository
