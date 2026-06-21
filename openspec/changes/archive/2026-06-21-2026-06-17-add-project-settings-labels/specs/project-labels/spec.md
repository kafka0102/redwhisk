## ADDED Requirements

### Requirement: Label lifecycle in Project Settings
The application SHALL allow users to create, edit, list, and delete labels from Project Settings.

#### Scenario: Creating a label
- **WHEN** the user clicks `+ New label`
- **THEN** a label dialog opens
- **AND** the dialog shows `Name`, `Scope`, `Color`, and `Agent`
- **AND** `Agent` defaults to `None`

#### Scenario: Showing workflow skill only for selected agent
- **WHEN** the user selects an agent in the label dialog
- **THEN** a single-select `Workflow Skill` field is shown
- **AND** the available skills are constrained to the selected agent context

#### Scenario: Hiding workflow skill when no agent is selected
- **WHEN** the current agent selection is `None`
- **THEN** the dialog does not render `Workflow Skill`
- **AND** any previously selected workflow skill is cleared before save

### Requirement: Label validation rules
The application SHALL enforce label naming, scope, and association rules when saving labels.

#### Scenario: Rejecting label names longer than 15 characters
- **WHEN** the trimmed label name exceeds 15 characters
- **THEN** the save request is rejected
- **AND** the user sees an error explaining the maximum length

#### Scenario: Enforcing project-scope uniqueness within one project
- **WHEN** the user saves a project-scoped label
- **THEN** its name must be unique within that same project
- **AND** the same name may still exist in a different project

#### Scenario: Enforcing global-scope uniqueness across all labels
- **WHEN** the user saves a global-scoped label
- **THEN** its name must be unique across all global labels and all project labels

#### Scenario: Rejecting workflow skill without agent
- **WHEN** a save request includes `Workflow Skill` but no agent
- **THEN** the save request is rejected

### Requirement: Label color selection
The label dialog SHALL support both free color selection and common preset colors.

#### Scenario: Choosing a custom color
- **WHEN** the user uses the color picker
- **THEN** the chosen RGB hex value is stored with the label

#### Scenario: Choosing a preset color
- **WHEN** the user clicks a preset color swatch
- **THEN** that color becomes the current label color selection
