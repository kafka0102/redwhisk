## ADDED Requirements

### Requirement: Project Settings Terminals menu entry
Project Settings SHALL expose a `Terminals` menu entry directly below `Agents` in the left settings menu.

#### Scenario: Settings menu is rendered
- **WHEN** the user opens Project Settings
- **THEN** the left menu shows `General`, `Agents`, and `Terminals` in that order
- **AND** `Terminals` appears directly below `Agents`
- **AND** the left menu width and splitter behavior remain consistent with other Project Settings modules

### Requirement: Project Settings Terminals page layout
The `Terminals` module SHALL keep the existing two-column Settings layout and render a compact stack of expandable terminal cards.

#### Scenario: Terminals page is opened
- **WHEN** the user selects `Terminals`
- **THEN** the right pane shows the title `Terminals`
- **AND** a plus button is shown at the far right of the first row
- **AND** terminal cards are rendered below in a tightly stacked list

#### Scenario: Terminal card is expanded
- **WHEN** the user opens a terminal card
- **THEN** the card header shows a terminal icon and the terminal name on the left
- **AND** the card body shows the terminal content region on the right
- **AND** the page keeps the same shared Settings content width rules used by other modules

### Requirement: Project terminal item lifecycle
The `Terminals` module SHALL let the user create and remove project terminal cards from the page.

#### Scenario: Creating a terminal
- **WHEN** the user clicks the plus button on the `Terminals` page
- **THEN** a new terminal item is added with the default name `New Terminal`
- **AND** the item can be expanded to reveal its terminal content area

#### Scenario: Removing a terminal
- **WHEN** the user hovers a terminal card
- **THEN** a delete icon is shown near the card's upper-right corner
- **AND** clicking the delete icon removes only that terminal item

### Requirement: Theme-aware terminal card colors
Each terminal card SHALL use a randomized background chosen from a palette that remains legible in both light and dark themes.

#### Scenario: Light theme terminal colors
- **WHEN** the application theme is `light`
- **THEN** each terminal card uses one randomly selected light-compatible background color
- **AND** card text and terminal chrome remain readable against that background

#### Scenario: Dark theme terminal colors
- **WHEN** the application theme is `dark`
- **THEN** each terminal card uses one randomly selected dark-compatible background color
- **AND** card text and terminal chrome remain readable against that background
