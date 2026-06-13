## ADDED Requirements

### Requirement: Settings right content layout
The Settings page SHALL render every selected settings module inside a centered right-content container whose width is 80% of the available right pane.

#### Scenario: General settings is selected
- **WHEN** the user selects `General`
- **THEN** the General form card is horizontally centered in the right pane
- **AND** the card uses 80% of the right pane width without a fixed height

#### Scenario: Agents settings is selected
- **WHEN** the user selects `Agents`
- **THEN** the Agents content uses the same centered 80% right-content container as General

#### Scenario: Future settings modules are added
- **WHEN** a new Settings menu item renders right-pane content
- **THEN** it uses the shared Settings right-content container instead of defining a module-specific page width

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
