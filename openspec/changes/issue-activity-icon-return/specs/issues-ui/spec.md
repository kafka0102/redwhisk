# issues-ui Specification Delta

## ADDED Requirements

### Requirement: Activity bar Issue icon quick return

The leftmost activity bar Issue icon SHALL act as a quick return to the Issues kanban when the user is already on the Issues Activity, instead of being a no-op.

#### Scenario: Returning from a read-only Issue detail

- **WHEN** the user is viewing a read-only Issue detail page on the Issues Activity
- **AND** the user clicks the leftmost activity bar Issue icon
- **THEN** the app closes the detail page and returns to the Issues kanban

#### Scenario: Returning from an unchanged edit or create form

- **WHEN** the user is editing an existing Issue or creating a new Issue on the Issues Activity
- **AND** the form content has not changed from its baseline (the saved Issue for edit, the empty form for create)
- **AND** the user clicks the leftmost activity bar Issue icon
- **THEN** the app closes the edit or create page and returns to the Issues kanban

#### Scenario: Preserving a changed edit or create form

- **WHEN** the user is editing an existing Issue or creating a new Issue on the Issues Activity
- **AND** the form content has changed from its baseline
- **AND** the user clicks the leftmost activity bar Issue icon
- **THEN** the app takes no action and keeps the user on the edit or create page

#### Scenario: No effect on the kanban or while saving

- **WHEN** the Issues kanban is already shown
- **AND** the user clicks the leftmost activity bar Issue icon
- **THEN** the app takes no action
- **WHEN** an Issue save or status change is in progress
- **AND** the user clicks the leftmost activity bar Issue icon
- **THEN** the app takes no action and does not interrupt the in-progress operation

#### Scenario: Switching to Issues from another Activity is unchanged

- **WHEN** the user is on the Agents, Terminals, or Settings Activity, or has the global settings panel open
- **AND** the user clicks the leftmost activity bar Issue icon
- **THEN** the app switches to the Issues Activity as before
- **AND** the app does not trigger the quick return behavior
