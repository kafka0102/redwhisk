# agent-skill-index Specification

## Purpose
Defines the in-memory Codex and Claude Code skill index, refresh lifecycle, query API, update notification, and Agent Profile skill selection behavior.
## Requirements
### Requirement: Global skill preload
The system SHALL asynchronously load global Codex and Claude Code skills into an in-memory index when the application starts.

#### Scenario: Application starts
- **WHEN** the Tauri application setup runs
- **THEN** the system starts a background refresh for global Codex and Claude Code skills without blocking the UI startup path

#### Scenario: Global refresh completes
- **WHEN** the global skill refresh succeeds
- **THEN** the in-memory index contains skill records with name, canonical path, agent type, global scope, source root, and no project id

#### Scenario: Global refresh fails partially
- **WHEN** one global skill root cannot be read
- **THEN** the system keeps records discovered from readable roots and stores the refresh error state for the failed root

### Requirement: Project skill preload
The system SHALL asynchronously load Codex and Claude Code skills for the selected project after a project is created or opened.

#### Scenario: Project is created
- **WHEN** `create_project` succeeds for a Git repository path
- **THEN** the system starts a background refresh for that project's skill roots without delaying the command response

#### Scenario: Project is opened
- **WHEN** `open_project` succeeds for an existing project
- **THEN** the system starts a background refresh for that project's skill roots without delaying the command response

#### Scenario: Project refresh completes
- **WHEN** the project skill refresh succeeds
- **THEN** the in-memory index contains skill records with name, canonical path, agent type, project scope, source root, and the project id

### Requirement: Codex skill discovery
The system SHALL discover Codex skills from official Codex skill roots and current-environment compatibility roots.

#### Scenario: Codex global roots exist
- **WHEN** `$HOME/.agents/skills`, `$HOME/.codex/skills`, `$HOME/.codex/superpowers/skills`, or `/etc/codex/skills` exists
- **THEN** the system scans each existing root for child directories containing `SKILL.md`

#### Scenario: Codex project roots exist
- **WHEN** a selected project contains `.agents/skills` or `.codex/skills` roots
- **THEN** the system scans those roots for child directories containing `SKILL.md`

#### Scenario: Codex skill metadata is parsed
- **WHEN** a Codex `SKILL.md` contains frontmatter `name`
- **THEN** the skill record uses that name and stores the `SKILL.md` path

### Requirement: Claude skill discovery
The system SHALL discover Claude Code skills from personal and project skill roots.

#### Scenario: Claude personal root exists
- **WHEN** `$HOME/.claude/skills` exists
- **THEN** the system scans it for child directories containing `SKILL.md`

#### Scenario: Claude project roots exist
- **WHEN** a selected project contains `.claude/skills` roots
- **THEN** the system scans those roots for child directories containing `SKILL.md`

#### Scenario: Claude skill metadata has no name
- **WHEN** a Claude `SKILL.md` has no frontmatter `name`
- **THEN** the skill record uses the skill directory name as the skill name

### Requirement: Skill query API
The system SHALL expose cached skill records through a Tauri command that does not perform filesystem scanning.

#### Scenario: Frontend queries cached skills
- **WHEN** the frontend calls `list_agent_skills` with an agent type and project id
- **THEN** the command returns matching global skills and matching project skills from memory only

#### Scenario: Cache is still loading
- **WHEN** the frontend calls `list_agent_skills` while a refresh is in progress
- **THEN** the command returns available cached records and a loading status

#### Scenario: Duplicate names exist
- **WHEN** multiple skill records have the same name
- **THEN** the command returns all records separately with their paths and source roots

### Requirement: Skill update notification
The system SHALL notify the frontend when a background skill refresh updates the in-memory index.

#### Scenario: Refresh updates global cache
- **WHEN** a global refresh finishes
- **THEN** the system emits `agent-skills-updated` with global scope and no project id

#### Scenario: Refresh updates project cache
- **WHEN** a project refresh finishes
- **THEN** the system emits `agent-skills-updated` with project scope and the project id

### Requirement: Agent Profile skill selection
The frontend SHALL use the cached skill index to populate the Agent Profile default skill selector.

#### Scenario: Creating a Codex profile
- **WHEN** the user creates an Agent Profile with agent type `codex`
- **THEN** the Skill selector shows Codex project and global skills from the cached index

#### Scenario: Creating a Claude profile
- **WHEN** the user creates an Agent Profile with agent type `claude`
- **THEN** the Skill selector shows Claude project and global skills from the cached index

#### Scenario: Background refresh completes while form is open
- **WHEN** `agent-skills-updated` fires for the current project or global scope
- **THEN** the form refreshes its Skill selector options without resetting unsaved form fields
