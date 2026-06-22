# agents-ui Specification Delta

## MODIFIED Requirements

### Requirement: Agents Session header compact issue bar

Agents Activity SHALL render the selected Session header as a compact, full-width issue bar without Card styling.

#### Scenario: Session has a linked Issue

- **WHEN** the user selects an Agent Session with a linked Issue
- **THEN** the Session header shows only `#<Issue ID> <Issue title>` as the primary text
- **AND** the header does not show `当前会话`, `当前绘画`, or a `Status` field
- **AND** the header has no outer margin or Card background
- **AND** a horizontal divider separates the header from the content below

#### Scenario: Header actions are rendered

- **WHEN** the selected Session header renders actions
- **THEN** the previous `Open Issue` button is not shown
- **AND** the status transition dropdown remains available when the Session can transition
- **AND** the transition dropdown button uses a white background
- **AND** terminal and right-split icon buttons are shown to the right of the transition control

#### Scenario: Opening the side panel

- **WHEN** the user clicks the right-split icon button
- **THEN** the right Session side panel opens
- **AND** the right-split icon button indicates the selected state with a subtle light background or inset treatment

#### Scenario: Opening the inline terminal panel

- **WHEN** the user clicks the terminal icon button in the Session header
- **THEN** the Session workspace opens an inline terminal panel below the Session main content
- **AND** the terminal icon button indicates the selected state with a subtle light background or inset treatment

## ADDED Requirements

### Requirement: Session inline terminal panel

Agents Activity SHALL provide a Session-scoped inline terminal panel below the Session main content.

#### Scenario: Opening the first terminal

- **WHEN** the user clicks the Session header terminal icon and no inline terminal is open
- **THEN** Agents Activity starts one temporary terminal for the selected Agent Session
- **AND** the panel appears below the Session main content with default height `200px`
- **AND** the terminal tab name is the final path segment of the terminal working directory
- **AND** the terminal process working directory is the selected Agent Session's actual working directory

#### Scenario: Managing terminal tabs

- **WHEN** at least one inline terminal is open
- **THEN** the terminal tab row shows one tab per terminal
- **AND** a plus icon button is available next to the tabs
- **AND** clicking the plus icon starts another temporary terminal for the same selected Agent Session
- **AND** each tab can be closed
- **AND** closing the active tab selects another remaining tab when one exists
- **AND** closing the last tab hides the inline terminal panel

#### Scenario: Resizing terminal panel

- **WHEN** the inline terminal panel is visible and not maximized
- **THEN** a horizontal splitter separates Session main content from the terminal panel
- **AND** dragging the splitter up or down changes the terminal panel height
- **AND** the panel remains within usable minimum and maximum heights

#### Scenario: Maximizing Session main content

- **WHEN** the user clicks the maximize button at the far right of the terminal tab row
- **THEN** Agents Activity hides the inline terminal panel and lets the Session main content use the available height
- **AND** clicking the button again restores the previous inline terminal panel

#### Scenario: Switching Session

- **WHEN** the user opens inline terminals for Session A and then switches to Session B
- **THEN** the inline terminal panel state is scoped to the selected Session
- **AND** new terminals for Session B start in Session B's actual working directory
