# project-labels Specification Delta

## MODIFIED Requirements

### Requirement: Label lifecycle in Project Settings

The application SHALL allow users to create, edit, list, and delete labels from Project Settings.

#### Scenario: Creating a label
- **WHEN** the user clicks `+ New label`
- **THEN** a label dialog opens
- **AND** the dialog shows `Name`, `Scope`, `Color`, and `Workflow Skill`
- **AND** the dialog does not render an `Agent` field

#### Scenario: Workflow skill sourced from saved skills
- **WHEN** the label dialog renders the `Workflow Skill` field
- **THEN** the field is a single-select dropdown
- **AND** the options come from saved agent skills (project-scoped plus global saved skills)
- **AND** the options are not filtered by any agent type
- **AND** the stored value is the selected saved skill's `name`
- **AND** a `None` option is always available

#### Scenario: Workflow skill is optional
- **WHEN** the user saves a label without selecting a workflow skill
- **THEN** the save succeeds with no workflow skill stored

### Requirement: Label validation rules

The application SHALL enforce label naming and scope rules when saving labels.

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

## REMOVED Requirements

_None. The "Showing workflow skill only for selected agent", "Hiding workflow skill when no agent is selected", and "Rejecting workflow skill without agent" scenarios previously under `Label lifecycle in Project Settings` / `Label validation rules` are dropped via the MODIFIED requirements above, because labels no longer associate with an agent._
