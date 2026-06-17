## MODIFIED Requirements

### Requirement: Project Settings navigation menu
Project Settings SHALL expose `General`, `Agents`, and `Labels` in the left settings menu, in that order.

#### Scenario: Settings menu is rendered
- **WHEN** the user opens Project Settings
- **THEN** the left menu shows `General`, `Agents`, and `Labels` in that order
- **AND** `Labels` appears directly below `Agents`
- **AND** the left menu width and splitter behavior remain consistent across all three modules

### Requirement: Settings right content layout
The Settings page SHALL render every selected settings module inside a centered right-content container whose width is 80% of the available right pane.

#### Scenario: Labels settings is selected
- **WHEN** the user selects `Labels`
- **THEN** the Labels content uses the same centered 80% right-content container as General and Agents

### Requirement: Project Settings Labels page layout
The `Labels` module SHALL render a table-based management view using the shared Settings content frame.

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
