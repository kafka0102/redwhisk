## ADDED Requirements

### Requirement: Issue dialog label picker
The Issues page SHALL allow users to assign configured labels while creating or editing a backlog issue.

#### Scenario: Selecting labels from configured project and global labels
- **WHEN** the user opens a create or edit dialog for a backlog issue
- **THEN** the dialog shows a `labels` row below the description field
- **AND** the picker options include both project-scoped and global labels for the current project
- **AND** the picker trigger renders selected labels as colored chips inside the control

#### Scenario: Managing labels from the picker
- **WHEN** the picker has at least one available label
- **THEN** the dropdown lists label options first
- **AND** separates non-label actions with a divider
- **AND** shows a `管理 labels` action at the bottom
- **AND** clicking that action opens Project Settings with the `labels` tab active

#### Scenario: Empty labels state
- **WHEN** the current project has no project-scoped labels and there are no global labels
- **THEN** the dropdown does not show label options
- **AND** instead shows an `添加标签` action
- **AND** clicking that action opens Project Settings with the `labels` tab active
