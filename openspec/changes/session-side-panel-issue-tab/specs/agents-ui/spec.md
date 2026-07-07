# agents-ui Specification Delta

## MODIFIED Requirements

### Requirement: Session side panel changes view

Agents Activity SHALL provide a right Session side panel that can show linked Issue details alongside workspace views.

#### Scenario: Side panel opens with a linked Issue

- **WHEN** the selected Session has a linked Issue
- **AND** the user opens the right Session side panel
- **THEN** the top panel tabs include `Issue`, `变更`, and `文件`
- **AND** the `Issue` tab is rendered in the first position
- **AND** the `Issue` tab is active immediately after opening the panel

#### Scenario: Issue tab shows linked Issue details

- **WHEN** the `Issue` tab is active
- **THEN** the panel shows the linked Issue title
- **AND** the title row shows a `查看 issue` link button aligned to the right
- **AND** the panel shows a divider below the title row
- **AND** the panel shows the Issue description below that divider
- **AND** if the Issue has labels, the panel shows another divider and renders the labels inline using the existing label chip style

#### Scenario: Open linked Issue from the side panel

- **WHEN** the user clicks `查看 issue` in the side panel `Issue` tab
- **THEN** the app switches to the Issues Activity
- **AND** the linked Issue is selected
- **AND** the Issue detail view is opened for that Issue

#### Scenario: Side panel opens for a standalone Session

- **WHEN** the selected Session has no linked Issue
- **AND** the user opens the right Session side panel
- **THEN** the top panel keeps the existing `变更` and `文件` tabs
- **AND** the panel does not add a standalone-only empty `Issue` primary flow
