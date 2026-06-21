# settings-ui Specification

## Purpose
Defines the shared Settings right-pane layout, the Agents settings profile table, and the streamlined New agent dialog behavior.
## Requirements
### Requirement: Settings right content layout
The Settings page SHALL render every selected settings module inside a centered right-content container whose width is 80% of the available right pane.

#### Scenario: General settings is selected
- **WHEN** the user selects `General`
- **THEN** the General form card is horizontally centered in the right pane
- **AND** the card uses 80% of the right pane width without a fixed height
- **AND** the form shows `Project Name`, `Repository path`, and `Git completion strategy` in that order

### Requirement: Agents settings table
The Settings Agents module SHALL present agent profiles in a table below a top action card.

#### Scenario: Agents page is opened
- **WHEN** the user opens the Settings `Agents` module
- **THEN** the right pane shows the `Agents` title
- **AND** a card below the title contains a `+ New agent` button aligned to the card's upper right
- **AND** a table below the card lists agent profiles

#### Scenario: Agent profiles are listed
- **WHEN** project and global agent profiles have loaded
- **THEN** the table shows columns for Type, Name, Command, Scope, and Workflow Skill
- **AND** the Type column displays the Codex or Claude logo image for each profile
- **AND** the Scope column displays whether the profile is `Global` or `Project`

#### Scenario: Agent profile has no workflow skill
- **WHEN** a profile's workflow skill is empty
- **THEN** the Workflow Skill column shows a stable empty-state placeholder

### Requirement: New agent dialog fields
The create-agent dialog SHALL use a unified `New agent` title and expose only the primary configuration fields.

#### Scenario: Creating an agent
- **WHEN** the user clicks `+ New agent`
- **THEN** a dialog titled `New agent` opens
- **AND** the fields are ordered as Name, Type, Command, Scope, and Workflow Skill
- **AND** Type defaults to `codex`
- **AND** Scope defaults to `Global`

#### Scenario: Choosing agent type
- **WHEN** the Type field is shown
- **THEN** the options include `codex` and `Claude Code`
- **AND** selecting `Claude Code` saves the existing `claude` agent type value

#### Scenario: Detecting command
- **WHEN** a command is detected for a new agent
- **THEN** the Command field is populated with the command name instead of the full executable path

#### Scenario: Testing command
- **WHEN** the user clicks the Command field's `测试` button
- **THEN** the frontend calls the existing agent command test flow for the current Command value
- **AND** the dialog shows whether the command is available or why validation failed

#### Scenario: Workflow skill options for global scope
- **WHEN** Scope is `Global`
- **THEN** Workflow Skill options are loaded from cached global skills for the selected agent type
- **AND** project-scoped skills are not shown

#### Scenario: Workflow skill options for project scope
- **WHEN** Scope is `Project`
- **THEN** Workflow Skill options are loaded from current-project skills for the selected agent type
- **AND** global skills are not shown

#### Scenario: Skill option rendering
- **WHEN** Workflow Skill options are displayed
- **THEN** each option shows the skill name in normal text
- **AND** the skill path is shown in muted gray text

#### Scenario: Hidden advanced fields
- **WHEN** the user creates an agent
- **THEN** Usage Mode and Prompt Template fields are not rendered
- **AND** the saved profile uses the default mode with dangerous parameters enabled
- **AND** the saved prompt template is empty

### Requirement: Global Settings entry
The application shell SHALL provide a global Settings icon at the bottom of the left navigation that opens application-level Preferences.

#### Scenario: Global Settings icon is rendered
- **WHEN** a project workbench is visible
- **THEN** the left navigation shows the project activity buttons for Issues, Agents, and Project Settings in the primary group
- **AND** a Settings icon is rendered at the bottom of the navigation without visible text
- **AND** the icon exposes an accessible name for Global Settings

#### Scenario: Opening Global Settings
- **WHEN** the user clicks the bottom Settings icon
- **THEN** the main content area shows Global Settings
- **AND** the Global Settings layout uses a left menu and right content area consistent with Project Settings
- **AND** the left menu contains `Preferences`

#### Scenario: Returning to project activity
- **WHEN** the user opens Global Settings and then selects Issues, Agents, or Project Settings
- **THEN** the application returns to the selected project activity
- **AND** previously selected project activity state is not reset solely because Global Settings was opened

### Requirement: Global Preferences language
Global Preferences SHALL allow the user to switch the UI language between English and Chinese.

#### Scenario: Default language
- **WHEN** the application starts without a saved language preference
- **THEN** the UI language defaults to English
- **AND** the Preferences Language section shows `English` selected

#### Scenario: Switching to Chinese
- **WHEN** the user opens Global Settings Preferences
- **AND** selects `中文` in the Language section
- **THEN** visible UI text managed by the i18n runtime changes to Chinese without restarting the app
- **AND** the selected language is persisted for the next app launch

#### Scenario: Switching back to English
- **WHEN** the current language is Chinese
- **AND** the user selects `English`
- **THEN** visible UI text managed by the i18n runtime changes to English without restarting the app
- **AND** the selected language is persisted for the next app launch

### Requirement: Global Preferences theme
Global Preferences SHALL present a Theme setting whose MVP behavior supports Light mode only.

#### Scenario: Default theme
- **WHEN** the application starts
- **THEN** the theme preference defaults to `Light`
- **AND** the Preferences Theme section shows Light selected

#### Scenario: Unimplemented themes are not selectable
- **WHEN** Dark or System theme options are visible
- **THEN** they are disabled or otherwise non-selectable
- **AND** selecting them does not change the current theme away from Light

#### Scenario: Light-only rendering
- **WHEN** the MVP chooses not to show unavailable themes
- **THEN** the Theme section may show only the Light option
- **AND** the UI must not imply that Dark or System mode is currently supported

### Requirement: Project General settings form
The Project Settings `General` form SHALL allow the user to maintain the project name, repository path, and Git completion strategy together.

#### Scenario: Choosing a new repository path
- **WHEN** the user clicks the `Repository path` chooser in `General`
- **THEN** the app opens a directory picker
- **AND** the selected path is shown in the form before save

#### Scenario: Distinguishing auxiliary and primary actions
- **WHEN** the `General` form renders action buttons
- **THEN** only submit or execution-focused primary actions such as `Save` use primary emphasis
- **AND** ordinary auxiliary actions such as the `Repository path` chooser use the default non-primary button style

#### Scenario: Saving a valid repository path
- **WHEN** the user changes the repository path to a valid Git repository
- **AND** clicks `Save`
- **THEN** the frontend submits `name`, `repoPath`, and `completionPolicy` together
- **AND** the updated project summary reflects the new repository path

#### Scenario: Rejecting a non-git repository path
- **WHEN** the selected repository path is not a Git repository
- **THEN** the form shows an error
- **AND** the `Save` action is blocked until the path is valid

### Requirement: Project Settings navigation menu
Project Settings SHALL expose `General`, `Agents`, and `Labels` in the left settings menu, in that order.

#### Scenario: Settings menu is rendered
- **WHEN** the user opens Project Settings
- **THEN** the left menu shows `General`, `Agents`, and `Labels` in that order
- **AND** `Labels` appears directly below `Agents`
- **AND** the left menu width and splitter behavior remain consistent across all three modules

### Requirement: Project Settings Labels page layout
The `Labels` module SHALL render a table-based management view using the shared Settings content frame.

#### Scenario: Labels settings is selected
- **WHEN** the user selects `Labels`
- **THEN** the Labels content uses the same centered 80% right-content container as General and Agents

#### Scenario: Labels page is opened
- **WHEN** the user selects `Labels`
- **THEN** the right pane shows the title `Labels`
- **AND** a `+ New label` button is shown at the upper right of the section header
- **AND** a table is rendered below the header

#### Scenario: Labels are listed
- **WHEN** project and global labels have loaded
- **THEN** the table shows columns for `Name`, `Scope`, `Color`, `Workflow Skill`, and `Actions`
- **AND** the `Name` column shows the label name together with the selected agent name
- **AND** the `Color` column shows the stored RGB hex value as text and uses that same color for the text itself
- **AND** the `Actions` column shows a delete link button

#### Scenario: Editing an existing label
- **WHEN** the user clicks a label name in the table
- **THEN** a label edit dialog opens for that row

### Requirement: Project general worktree settings
Project General settings SHALL own the worktree root location and worktree setup command for issue execution.

#### Scenario: Agent profile form does not expose worktree path
- **WHEN** the user opens the create-agent or edit-agent dialog
- **THEN** the dialog does not show a `Worktree path` field
- **AND** saving an agent profile does not submit a worktree path value

#### Scenario: Selecting a project worktree location
- **WHEN** the user opens Project General settings for a repository at `/workspace/kafka/redwhisk`
- **THEN** the `Worktree path` field is a select control
- **AND** it offers `/workspace/kafka/redwhisk.worktrees`
- **AND** it offers `/workspace/kafka/redwhisk/.worktrees`
- **AND** it offers `~/.redwhisk/worktrees/redwhisk`
- **AND** the saved value is one of `repo_sibling`, `repo_internal`, or `user_home`

#### Scenario: Worktree location options follow repository path changes
- **WHEN** the user changes the project repository path
- **THEN** the displayed worktree path options are recalculated from the new repository path
- **AND** the persisted value remains the selected enum rather than a full path

#### Scenario: Rejecting unsafe repository-internal worktree location
- **WHEN** the user saves Project General settings with `repo_internal`
- **AND** the repository has no `.gitignore` entry for `.worktrees/`
- **THEN** the save is rejected
- **AND** the project settings are not persisted

#### Scenario: Configuring worktree setup command
- **WHEN** the user opens Project General settings
- **THEN** the form shows a three-line `Worktree setup after creation` textarea below `Worktree path`
- **AND** the textarea stores the project default setup command
- **AND** an empty value is allowed
