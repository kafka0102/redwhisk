---
name: bmad-dev-workflow
description: 'Orchestrates one BMad story workflow. Use when the user says "run bmad dev workflow" or "develop the next BMad story end to end".'
---

# BMad Dev Workflow

This skill orchestrates one BMad story through `bmad-create-story`, `bmad-dev-story`, and `bmad-code-review` in the same session while using soft context cleanup between phases. Act as the workflow conductor: delegate phase work to the existing skills, persist detailed handoff data to files, and carry only the minimal phase summary forward.

## Design Constraints

- Do not use subagents or child sessions for phase isolation or context cleanup.
- If a delegated child skill has its own reviewer/subprocess mechanism, follow that child skill's rules. If the user forbids that mechanism, let the child skill's fallback or HALT condition control the run.
- When review policy is `automatic`, do not ask the user to confirm the review target, diff summary, patch handling menu, or next-step menu; use the automatic handoff defaults defined below.
- Do not copy or rewrite the child skills' internal workflows; execute them by name and respect their HALT conditions.
- Soft cleanup does not remove tokens already in the session. It means detailed phase context is written to disk, then ignored unless the next phase explicitly reloads a needed file.
- Scope is exactly one story unless the user explicitly starts another workflow run.

## Conventions

- Bare paths (e.g. `customize.toml`) resolve from the skill root.
- `{skill-root}` resolves to this skill's installed directory (where `customize.toml` lives).
- `{project-root}`-prefixed paths resolve from the project working directory.
- `{skill-name}` resolves to the skill directory's basename.

## On Activation

### Step 1: Resolve the Workflow Block

Run: `python3 {project-root}/_bmad/scripts/resolve_customization.py --skill {skill-root} --key workflow`

If the script fails, resolve the `workflow` block yourself by reading these three files in base -> team -> user order and applying structural merge rules: `{skill-root}/customize.toml`, `{project-root}/_bmad/custom/{skill-name}.toml`, `{project-root}/_bmad/custom/{skill-name}.user.toml`. Scalars override, tables deep-merge, arrays of tables keyed by `code` or `id` replace matching entries and append new entries, and all other arrays append.

### Step 2: Execute Prepend Steps

Execute each entry in `{workflow.activation_steps_prepend}` in order before proceeding.

### Step 3: Load Persistent Facts

Treat every entry in `{workflow.persistent_facts}` as foundational context. Entries prefixed `file:` are paths or globs under `{project-root}`; load the referenced contents as facts. Other entries are literal facts.

### Step 4: Load Config

Load config from `{project-root}/_bmad/bmm/config.yaml` and resolve:

- `project_name`, `planning_artifacts`, `implementation_artifacts`, `user_name`
- `communication_language`, `document_output_language`, `user_skill_level`
- `date` as system-generated current datetime
- `sprint_status` = `{implementation_artifacts}/sprint-status.yaml`
- `handoff_file` = `{workflow.handoff_output_path}`

Communicate in `{communication_language}` and generate workflow artifacts in `{document_output_language}`.

### Step 5: Greet the User

Greet `{user_name}` briefly in `{communication_language}`.

### Step 6: Execute Append Steps

Execute each entry in `{workflow.activation_steps_append}` in order. Do not begin the workflow until activation steps are complete.

## Handoff Contract

After every phase, overwrite `{handoff_file}` with YAML containing only:

```yaml
workflow: bmad-dev-workflow
phase: preflight|story-created|dev-complete|review-complete|blocked|complete
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

The handoff file is the phase boundary. Do not paste full child-skill output, full diffs, full test logs, PRD, architecture, UX, or story content into the next phase summary.

## Soft Cleanup Rule

At every phase boundary:

1. Save details to the authoritative artifact: story file, Dev Agent Record, review findings, deferred-work file, and `{handoff_file}`.
2. Produce a handoff summary of no more than 30 lines.
3. State: "Soft cleanup boundary reached; I will carry forward only the handoff fields."
4. For the next phase, rely only on `{handoff_file}`, `story_file`, `baseline_commit`, changed file list, validation summary, and review summary unless a child skill explicitly requires reloading more.

## Child Skill Execution

To execute a child skill, load that skill's `SKILL.md` and follow its activation and workflow exactly as if the user invoked it directly. The parent workflow supplies the target story, handoff fields, and intent; the child skill remains authoritative for implementation, validation, review menus, and HALT conditions.

## Workflow

### 1. Preflight

Inspect `sprint_status` if it exists and determine the target story:

- If the user provided a story path or story key, use it.
- Else if a `ready-for-dev` story exists, skip story creation and use that story.
- Else if a `backlog` story exists and `{workflow.auto_create_story}` is true, run story creation.
- Else HALT and ask the user to choose a story or run sprint planning.

Record initial git state and current `HEAD` short SHA if git is available. If unrelated dirty changes are visible, note them and continue; final commit staging must include only files directly related to this workflow.

Write `{handoff_file}` with `phase: preflight`.

### 2. Create Story When Needed

If no `ready-for-dev` story is available, execute `bmad-create-story` for the selected backlog story. Let that skill perform its own discovery, story generation, checklist validation, and sprint-status update.

After it finishes, locate the created story file and verify its status is `ready-for-dev`. Update `{handoff_file}` with `phase: story-created`, `story_file`, `story_key`, and `story_status`.

If `{workflow.require_story_approval}` is true, HALT after the handoff summary and ask the user to approve entering development. If false, continue.

Apply the Soft Cleanup Rule before development.

### 3. Develop Story

Execute `bmad-dev-story` with the explicit `story_file` from `{handoff_file}`. Let it write tests, run validations, update Dev Agent Record, update File List, and move the story to `review`.

After it finishes, reload only the story file metadata and Dev Agent Record sections needed to extract:

- `story_status`
- `baseline_commit`
- changed file list
- validation commands and pass/fail results

Update `{handoff_file}` with `phase: dev-complete`. If story status is not `review`, set `phase: blocked`, record `blocking_reason`, and HALT.

Apply the Soft Cleanup Rule before review.

### 4. Review Story

Execute `bmad-code-review` with this review intent:

- review target: changes for `story_file`
- spec/context file: `story_file`
- diff base: `baseline_commit` from the story frontmatter or handoff file when available
- changed files: changed file list extracted from the Dev Agent Record or handoff file
- mode: `{workflow.review_policy}` same-session workflow handoff; present the review result to the user

If `{workflow.review_policy}` is `automatic`, pass these defaults to `bmad-code-review`:

- construct the diff without asking, using `baseline_commit` and the story's changed file list when available
- set review mode to `full` with `story_file` as the spec/context file
- skip review-target, checkpoint, patch-handling, and next-step confirmations
- write review findings to the story file
- leave patch findings as story action items instead of applying code changes inside the review phase
- continue without asking when the review is clean

When `{workflow.review_policy}` is `interactive`, respect every checkpoint inside `bmad-code-review`. This workflow may pre-fill target, spec, and diff base, but it must not bypass required human confirmations unless the child skill itself supports that mode.

Even in `automatic` mode, HALT if `bmad-code-review` reports a `decision-needed` finding, cannot construct a non-empty diff, cannot read `story_file`, or cannot run its required review layers without external input.

After review completes, update `{handoff_file}` with `phase: review-complete`, `story_status`, and `review_summary`.

### 5. Review Follow-Up Loop

If review marks the story `done`, continue to Finalize.

If review leaves patch findings as action items or marks story `in-progress`:

- If `{workflow.auto_continue_review_fix_loop}` is false, HALT and report the follow-up state to the user.
- If true, run `bmad-dev-story` again with the same `story_file` to address Review Follow-ups, then run `bmad-code-review` again.
- Stop after `{workflow.max_review_cycles}` review attempts and HALT with the remaining review summary.

Apply the Soft Cleanup Rule after every dev or review pass in the loop.

### 6. Finalize

Verify story status and sprint status agree. Summarize:

- story file and final status
- changed files
- validations actually run
- review result
- unresolved findings or deferred work

If `{workflow.auto_commit}` is true, create one git commit after required validation using only files directly related to this workflow. If required validation cannot be run, do not claim it ran; record what was skipped, why, and the risk. If unrelated dirty changes prevent safe staging, HALT and ask the user how to proceed.

Run `{workflow.on_complete}` if non-empty. Update `{handoff_file}` with `phase: complete`.
