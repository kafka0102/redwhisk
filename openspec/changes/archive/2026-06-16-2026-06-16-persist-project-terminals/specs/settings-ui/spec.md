## MODIFIED Requirements

### Requirement: Project Settings Terminals page layout
The `Terminals` module SHALL keep the existing two-column Settings layout and render a compact stack of editable terminal cards.

#### Scenario: Terminals page is opened
- **WHEN** the user selects `Terminals`
- **THEN** the right pane shows the title `Terminals`
- **AND** a plus button is shown at the far right of the first row
- **AND** terminal cards are rendered below in a tightly stacked list with only 4px vertical spacing

#### Scenario: Terminal card is selected
- **WHEN** the user clicks a terminal card
- **THEN** the selected card uses a darker background and border variant of the shared terminal card color
- **AND** unselected cards keep a stable non-random background

#### Scenario: Terminal card is hovered
- **WHEN** the pointer hovers a terminal card
- **THEN** an edit button is shown on the left side of the card header
- **AND** the delete button remains available for removing the card

#### Scenario: Editing a terminal card
- **WHEN** the user clicks the terminal card edit button
- **THEN** a dialog opens
- **AND** the dialog allows editing `Name`, `Path`, and `Launch command`

### Requirement: Theme-aware terminal card colors
Each terminal card SHALL use a stable non-random background and distinguish the active card by darkening that shared visual treatment.

#### Scenario: Stable terminal colors
- **WHEN** the application theme is rendered
- **THEN** terminal cards use a fixed, legible background treatment instead of a random color per terminal
- **AND** card text and terminal chrome remain readable

#### Scenario: Active terminal contrast
- **WHEN** a terminal card is active
- **THEN** its background and border are darkened relative to the inactive state
- **AND** the active state remains readable in the supported theme
