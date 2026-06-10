---
name: bmad-workflow
description: 'End-to-end BMad automation from natural-language input. Use when the user wants input turned into epic/story work, then developed and code-reviewed automatically.'
---

# BMad Workflow

This skill turns user input into one implementable BMad story, creates missing planning seeds when needed, then runs the story through `bmad-create-story`, `bmad-dev-story`, and `bmad-code-review`.

Act as the workflow conductor. Keep planning edits small, delegate child workflows by name, persist phase state to a handoff file, and carry only the minimal summary across phases.

## Design Constraints

- Scope is exactly one implementable story per run unless the user explicitly requests another run.
- Do not copy or rewrite child skill internals. Execute `bmad-create-story`, `bmad-dev-story`, and `bmad-code-review` by loading their `SKILL.md` files and following their rules.
- Use direct planning-file edits only to create or update the minimal epic/story seed that `bmad-create-story` needs.
- If a child skill has its own HALT condition, respect it.
- Project rules from `AGENTS.md` and `docs/standards/shared/git-workflow.md` override weaker defaults here or in child skills.
- Communicate in the configured `communication_language`; generated workflow artifacts use `document_output_language`.

## Conventions

- Bare paths resolve from the skill root.
- `{skill-root}` resolves to this skill directory.
- `{project-root}` resolves to the project working directory.
- `{skill-name}` resolves to `bmad-workflow`.

## Operating Modes

- `explicit-story`: user provided a story key or story file; skip planning seed creation and run dev/review.
- `backlog-story`: a matching backlog story already exists; create the story file, then run dev/review.
- `input-to-story`: user provided natural-language requirements; ensure an epic/story seed exists, then create the story file and run dev/review.

Natural-language requirements include feature requests, bug reports, acceptance criteria, implementation intent, UX requirements, or multi-sentence tasks that are not merely a story key/path or direct question.

## On Activation

### 1. Resolve Workflow Configuration

Run:

```bash
python3 {project-root}/_bmad/scripts/resolve_customization.py --skill {skill-root} --key workflow
```

If the resolver fails, merge these files manually in base -> team -> user order:

1. `{skill-root}/customize.toml`
2. `{project-root}/_bmad/custom/{skill-name}.toml`
3. `{project-root}/_bmad/custom/{skill-name}.user.toml`

Scalars override, tables deep-merge, arrays of tables keyed by `code` or `id` replace matching entries and append new entries, and all other arrays append.

### 2. Execute Activation Hooks

Execute each `{workflow.activation_steps_prepend}` entry in order.

Load every `{workflow.persistent_facts}` entry as foundational context. Entries prefixed `file:` are paths or globs under `{project-root}`; all other entries are literal facts.

Load `{project-root}/_bmad/bmm/config.yaml` and resolve:

- `project_name`, `planning_artifacts`, `implementation_artifacts`, `user_name`
- `communication_language`, `document_output_language`, `user_skill_level`
- `epics_file = {planning_artifacts}/epics.md`
- `sprint_status = {implementation_artifacts}/sprint-status.yaml`
- `handoff_file = {workflow.handoff_output_path}`
- current datetime as `date`

Greet `{user_name}` briefly in `{communication_language}`.

Execute each `{workflow.activation_steps_append}` entry in order before starting the workflow.

### 3. Classify Invocation

Classify the user request as `explicit-story`, `backlog-story`, or `input-to-story`.

For `input-to-story`, preserve the original user request verbatim as `story_creation_request`. Do not summarize it before planning/story creation.

## Handoff Contract

After every phase, overwrite `{handoff_file}` with YAML containing only:

```yaml
workflow: bmad-workflow
phase: preflight|planning-seeded|story-created|dev-complete|review-complete|blocked|complete
workflow_mode:
story_creation_request:
epic_key:
epic_title:
story_file:
story_key:
story_status:
baseline_commit:
changed_files: []
validation_commands: []
validation_results: []
review_summary:
blocking_reason:
updated_at:
```

## Soft Cleanup Rule

At each phase boundary:

1. Save detail to authoritative artifacts: `epics.md`, `sprint-status.yaml`, story file, Dev Agent Record, review findings, deferred-work file, and `{handoff_file}`.
2. Produce a handoff summary of no more than 30 lines.
3. State: "Soft cleanup boundary reached; I will carry forward only the handoff fields."
4. In the next phase, rely on `{handoff_file}`, `story_file`, `baseline_commit`, changed files, validation results, and review summary unless a child skill explicitly requires more.

## Workflow

### 1. Preflight

Inspect `epics_file` and `sprint_status` if present.

Determine the target:

- If the user supplied a story path/key, set `workflow_mode: explicit-story`.
- Else if a `ready-for-dev` story matches the input intent, set `workflow_mode: explicit-story`.
- Else if a matching or first available `backlog` story exists, set `workflow_mode: backlog-story`.
- Else if the user supplied natural-language requirements and `{workflow.auto_create_planning_seed}` is true, set `workflow_mode: input-to-story`.
- Else HALT and ask for a story key/path or requirements.

Record current git status and current `HEAD` short SHA if git is available. Do not modify unrelated dirty files.

Write `{handoff_file}` with `phase: preflight`.

### 2. Create Planning Seed When Needed

Only run this phase for `input-to-story`.

Create the smallest planning seed required by `bmad-create-story`:

1. Ensure `epics_file` exists. If it does not exist, create it with the standard `# {project_name} - Epic Breakdown` title, an `## Epic List`, and the new epic section.
2. Select a target epic:
   - If no `## Epic N:` section exists, create `Epic 1`.
   - If the input clearly belongs to an existing non-done epic, use that epic.
   - Otherwise create the next numeric epic after the highest existing epic.
3. Select the story number:
   - Use the next available `Story E.N` number within the target epic.
   - Derive a concise Chinese story title from the user input.
4. Append or update exactly one `### Story E.N: ...` block with:
   - user story statement
   - requirements/source notes derived from `story_creation_request`
   - acceptance criteria in Given/When/Then style
   - explicit implementation boundaries and non-goals when inferable
5. Ensure `sprint_status` contains:
   - `epic-E: backlog` for newly created epics, or preserve an existing valid epic status unless it is `done`
   - `E-N-<slug>: backlog` for the new story
   - `epic-E-retrospective: optional` if missing

If a suitable existing epic is marked `done`, do not reopen it silently. Create a new epic instead unless the user explicitly asked to extend that completed epic.

If `sprint_status` is missing and `{workflow.create_sprint_status_when_missing}` is true, create a minimal valid `sprint-status.yaml` with project metadata and the seeded epic/story. If false, HALT and ask the user to run sprint planning.

Use stable kebab-case slugs in story keys. Prefer ASCII slugs, for example `6-2-unify-settings-layout`.

Update `{handoff_file}` with `phase: planning-seeded`, `epic_key`, `epic_title`, and `story_key`.

Apply the Soft Cleanup Rule.

### 3. Create Story File

Run `bmad-create-story` with the selected story key.

Let the child skill perform artifact discovery, story generation, checklist validation, and sprint-status updates. Do not manually write the final story file unless the child skill explicitly provides a fallback.

After it finishes:

- locate the created story file in `{implementation_artifacts}`
- verify the story status is `ready-for-dev`
- verify `sprint_status` has the selected story as `ready-for-dev`

Update `{handoff_file}` with `phase: story-created`, `story_file`, `story_key`, and `story_status`.

If `{workflow.require_story_approval}` is true, HALT and ask for approval before development. Otherwise continue.

Apply the Soft Cleanup Rule.

### 4. Develop Story

Run `bmad-dev-story` with the explicit `story_file` from `{handoff_file}`.

After it finishes, reload only the story metadata and Dev Agent Record needed to extract:

- `story_status`
- `baseline_commit`
- changed file list
- validation commands actually run
- validation results for each command

Require exact command strings. If validation is only described in prose, set `phase: blocked` and HALT.

Update `{handoff_file}` with `phase: dev-complete`.

If story status is not `review`, set `phase: blocked`, record `blocking_reason`, and HALT.

Apply the Soft Cleanup Rule.

### 5. Code Review

Run `bmad-code-review` with this review intent:

- review target: changes for `story_file`
- spec/context file: `story_file`
- diff base: `baseline_commit` from the story or handoff
- changed files: changed files from the Dev Agent Record or handoff
- policy: `{workflow.review_policy}`

If `{workflow.review_policy}` is `automatic`, use these defaults:

- construct the diff without asking, using `baseline_commit` and changed files
- use full review mode with `story_file` as spec/context
- skip target, checkpoint, patch-handling, and next-step confirmations where the child skill supports skipping
- write review findings to the story file
- do not apply code patches during the review phase
- continue without asking only when review is clean

HALT if review reports `decision-needed`, cannot construct a non-empty diff, cannot read `story_file`, or cannot run required review layers.

Update `{handoff_file}` with `phase: review-complete`, `story_status`, and `review_summary`.

### 6. Review Follow-Up Loop

If review marks the story `done`, continue to Finalize.

If review leaves findings or marks the story `in-progress`:

- If `{workflow.auto_continue_review_fix_loop}` is false, HALT and report follow-up state.
- If true, run `bmad-dev-story` again with the same `story_file`, then run `bmad-code-review` again.
- Stop after `{workflow.max_review_cycles}` review attempts and HALT with remaining findings.

Apply the Soft Cleanup Rule after every dev or review pass.

### 7. Finalize

Verify story status and sprint status agree.

Summarize:

- story file and final status
- created/updated epic and story seed, if any
- changed files
- validation commands and results
- review result
- unresolved findings or deferred work

Before any git commit, enforce this exact order:

1. confirm implementation and review work for the story are complete
2. verify required validation already ran, or run missing required validation now
3. inspect `git status --short`
4. stage only files directly related to this workflow
5. inspect staged diff
6. create one git commit

Validation rules:

- If TypeScript or JavaScript source changed, run affected package `lint` and `typecheck`.
- If runtime behavior, branch logic, data flow, rendering logic, or test-dependent implementation changed, also run affected `test`.
- If formatting is configured for the affected package, run it before lint/typecheck/test.
- Record every validation command verbatim.

Commit rules:

- Commit only files directly related to the completed story.
- Include workflow artifacts only when directly updated for traceability.
- If a file contains mixed unrelated edits that cannot be safely separated, HALT instead of committing.
- Commit message subject must use Chinese Conventional Commits: `<type>: <简要描述>`.

Run `{workflow.on_complete}` if non-empty. Update `{handoff_file}` with `phase: complete`.
