# settings-ui Specification Delta

## MODIFIED Requirements

### Requirement: Agents settings table

The Settings Agents module SHALL present agent profiles in a table below a top action card.

#### Scenario: Agents page is opened
- **WHEN** the user opens the Settings `Agents` module
- **THEN** the right pane shows the `Agents` title
- **AND** a card below the title contains a `+ New agent` button aligned to the card's upper right
- **AND** a table below the card lists agent profiles

#### Scenario: Agent profiles are listed
- **WHEN** project and global agent profiles have loaded
- **THEN** the table shows columns for Type, Name, Command, Scope, and Actions
- **AND** the Type column displays the Codex or Claude logo image for each profile
- **AND** the Scope column displays whether the profile is `Global` or `Project`
- **AND** the table does not render a Workflow Skill column

### Requirement: New agent dialog fields

The create-agent dialog SHALL use a unified `New agent` title and expose only the primary configuration fields.

#### Scenario: Creating an agent
- **WHEN** the user clicks `+ New agent`
- **THEN** a dialog titled `New agent` opens
- **AND** the fields are ordered as Name, Type, Command, and Scope
- **AND** Type defaults to `codex`
- **AND** Scope defaults to `Global`
- **AND** the dialog does not render a Workflow Skill field

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

#### Scenario: Hidden advanced fields
- **WHEN** the user creates an agent
- **THEN** Usage Mode and Prompt Template fields are not rendered
- **AND** the saved profile uses the default mode with dangerous parameters enabled
- **AND** the saved prompt template is empty
- **AND** the saved default skill is empty

## REMOVED Requirements

_None. The "Workflow skill options for global scope", "Workflow skill options for project scope", and "Skill option rendering" scenarios previously under `New agent dialog fields` are dropped via the MODIFIED requirement above, because agent profiles no longer carry a workflow skill selector._
