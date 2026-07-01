# issues-ui Specification Delta

## ADDED Requirements

### Requirement: Issue run dialog agent and workflow skill sourcing

The backlog issue run dialog SHALL source the agent list from configured agent profiles and source workflow skill options from saved agent skills filtered by the selected agent's type.

#### Scenario: Agent dropdown sources from configured agents
- **WHEN** the user opens the run dialog
- **THEN** the agent profile dropdown lists project-scoped and global agent profiles
- **AND** the dropdown does not derive its options from any label association

#### Scenario: Defaulting the agent to the most recently used
- **WHEN** the run dialog opens and a previous issue session exists for the project
- **THEN** the agent dropdown defaults to the agent profile used by the most recent issue session
- **AND** if no prior issue session exists, the dropdown defaults to the last available profile

#### Scenario: Workflow skill options filtered by agent type
- **WHEN** the user selects an agent profile
- **THEN** the workflow skill dropdown lists saved agent skills (project-scoped plus global) whose `skillPaths` include a path for the selected agent's type
- **AND** the dropdown always includes a `None` option

#### Scenario: Defaulting the workflow skill from an associated label
- **WHEN** the run dialog opens with a selected agent
- **AND** the issue has one or more associated labels with a workflow skill
- **THEN** the workflow skill defaults to the first label skill whose saved skill name is present in the filtered options for the selected agent type

#### Scenario: Defaulting the workflow skill to none
- **WHEN** no associated label has a workflow skill that matches the filtered options for the selected agent type
- **THEN** the workflow skill defaults to `None`

#### Scenario: Recomputing on agent switch
- **WHEN** the user changes the selected agent profile
- **THEN** the workflow skill options are recomputed for the new agent type
- **AND** the workflow skill default is recomputed from the associated labels against the new options
