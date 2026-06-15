## MODIFIED Requirements

### Requirement: Settings right content layout
The Settings page SHALL render every selected settings module inside a centered right-content container whose width is 80% of the available right pane.

#### Scenario: General settings is selected
- **WHEN** the user selects `General`
- **THEN** the General form card is horizontally centered in the right pane
- **AND** the card uses 80% of the right pane width without a fixed height
- **AND** the form shows `Project Name`, `Repository path`, and `Git completion strategy` in that order

## ADDED Requirements

### Requirement: Project General settings form
The Project Settings `General` form SHALL allow the user to maintain the project name, repository path, and Git completion strategy together.

#### Scenario: Choosing a new repository path
- **WHEN** the user clicks the `Repository path` chooser in `General`
- **THEN** the app opens a directory picker
- **AND** the selected path is shown in the form before save

#### Scenario: Saving a valid repository path
- **WHEN** the user changes the repository path to a valid Git repository
- **AND** clicks `Save`
- **THEN** the frontend submits `name`, `repoPath`, and `completionPolicy` together
- **AND** the updated project summary reflects the new repository path

#### Scenario: Rejecting a non-git repository path
- **WHEN** the selected repository path is not a Git repository
- **THEN** the form shows an error
- **AND** the `Save` action is blocked until the path is valid
