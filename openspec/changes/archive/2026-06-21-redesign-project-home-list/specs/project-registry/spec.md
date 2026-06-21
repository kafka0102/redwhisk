# project-registry Specification Delta

## ADDED Requirements

### Requirement: Project Home compact list

Project Home SHALL render local projects as a compact list rather than a card grid.

#### Scenario: Project Home renders compact toolbar

- **WHEN** Project Home is shown
- **THEN** the page does not show `RedWhisk`, `Projects`, or `Local Git repositories available to this workbench...`
- **AND** the top toolbar shows a project search input on the left
- **AND** the top toolbar shows a `New Project` button on the right
- **AND** a horizontal divider separates the toolbar from the project list

#### Scenario: Project list rows are rendered

- **WHEN** projects are available
- **THEN** each project is rendered as one full-width list row
- **AND** the row shows an icon containing the first letter of the project name
- **AND** the icon background color is generated stably from project data
- **AND** the icon text is white
- **AND** the project name is rendered as the primary bold text
- **AND** the project path is rendered below the project name
- **AND** clicking the row opens that project

#### Scenario: Project path is under the user home directory

- **WHEN** a project path starts with the current user's Home directory
- **THEN** Project Home renders the path with the Home directory replaced by `~/`

### Requirement: Project Home local search

Project Home SHALL provide local real-time filtering by project name.

#### Scenario: Search input is empty

- **WHEN** the search input is empty
- **THEN** all projects are shown
- **AND** the clear search button is not shown

#### Scenario: Search input filters projects

- **WHEN** the user types characters into the search input
- **THEN** Project Home filters projects locally by project name
- **AND** only matching projects are rendered
- **AND** non-matching projects are hidden instead of disabled
- **AND** hidden projects cannot be clicked

#### Scenario: Search input has a value

- **WHEN** the search input has a non-empty value
- **THEN** a clear search button is shown
- **AND** clicking the clear search button clears the input
- **AND** all projects are shown again

#### Scenario: Search placeholder is shown

- **WHEN** the search input is empty
- **THEN** the input placeholder is `searching projects`

### Requirement: Project Home window header interactions

The small Project Home window SHALL support desktop window movement and maximize toggling from its Header area.

#### Scenario: Dragging the header

- **WHEN** the user drags an empty area of the Project Home Header
- **THEN** the app window moves with the pointer

#### Scenario: Double-clicking the header

- **WHEN** the user double-clicks an empty area of the Project Home Header while the window is not maximized
- **THEN** the app maximizes the window without entering fullscreen

#### Scenario: Double-clicking the maximized header

- **WHEN** the user double-clicks an empty area of the Project Home Header while the window is maximized
- **THEN** the app restores the previous window size

#### Scenario: Interacting with header controls

- **WHEN** the user clicks or edits a Header control such as a button or search input
- **THEN** the control interaction is handled normally
- **AND** the app does not start dragging or toggle maximize from that control interaction
