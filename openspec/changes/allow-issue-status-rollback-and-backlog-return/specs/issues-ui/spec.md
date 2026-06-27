## ADDED Requirements

### Requirement: Issue status change confirmation rules
The Issues page SHALL allow direct forward status changes, require confirmation for every backward status change, and gate completion confirmation on whether the linked session is still running.

#### Scenario: Moving an issue forward
- **WHEN** the user selects a later status in the Issue status menu
- **THEN** the app applies the status change without an extra confirmation step

#### Scenario: Rolling an issue back to an earlier status
- **WHEN** the user selects an earlier status in the Issue status menu
- **THEN** the app shows a confirmation dialog before changing the status

#### Scenario: Returning a running issue to backlog
- **WHEN** the current issue is still being executed by a running session
- **AND** the user changes its status to `backlog`
- **THEN** the app asks whether it should terminate the current execution and return the issue to `backlog`
- **AND** after confirmation the runtime stops the running session and the issue becomes runnable from `backlog` again

#### Scenario: Returning an inactive issue to backlog
- **WHEN** the user changes an issue to `backlog`
- **AND** the issue does not have a running session
- **THEN** the app asks for a normal backlog return confirmation

#### Scenario: Marking a running issue as completed
- **WHEN** the user changes the issue status to `completed`
- **AND** the linked session is still running
- **THEN** the app warns that the current issue is still executing and asks whether to mark it as completed
- **AND** after confirmation the app continues the existing completion flow

#### Scenario: Marking an inactive issue as completed
- **WHEN** the user changes the issue status to `completed`
- **AND** the issue does not have a running session
- **THEN** the app changes the status without the extra running-session confirmation
