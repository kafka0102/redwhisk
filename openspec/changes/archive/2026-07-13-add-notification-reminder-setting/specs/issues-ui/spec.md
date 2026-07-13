## ADDED Requirements

### Requirement: Issue running state exit hook
The Issues page SHALL encapsulate side effects of transitioning an issue out of the `running` state into an asynchronous exit-hook mechanism, invoked after the status change has succeeded, so that additional running-exit behaviors can be added without modifying the status-change call site.

#### Scenario: Hook fires on every running exit
- **WHEN** the user advances an issue whose current status is `running` to any other status (`review`, `completed`, or `backlog`)
- **AND** the status change succeeds
- **THEN** the app invokes the running-exit hook with the issue id, project id, `fromStatus` = `running`, and the `targetStatus`
- **AND** the hook is invoked asynchronously without blocking the UI or the post-transition flow

#### Scenario: Hook does not block on failures
- **WHEN** an individual hook side effect throws
- **THEN** the failure is swallowed
- **AND** other side effects in the hook still execute
- **AND** the already-succeeded status change is not rolled back

#### Scenario: Hook is skipped for non-running sources
- **WHEN** the user advances an issue whose current status is not `running`
- **THEN** the running-exit hook is not invoked

### Requirement: Issue review transition notification sound
When the running-exit hook runs for a `running` -> `review` transition, the app SHALL play a notification sound if and only if the global Notification reminder preference is enabled. The sound SHALL be synthesized via the Web Audio API at a moderate, clearly audible volume, and playback failures SHALL be silent.

#### Scenario: Sound plays when reminder enabled on running to review
- **WHEN** an issue transitions from `running` to `review`
- **AND** the Notification reminder preference is enabled (`Yes`)
- **THEN** the app plays a synthesized notification sound via the Web Audio API
- **AND** the sound plays at a moderate volume that is clearly audible

#### Scenario: No sound when reminder disabled
- **WHEN** an issue transitions from `running` to `review`
- **AND** the Notification reminder preference is disabled (`No`)
- **THEN** no notification sound is played

#### Scenario: No sound for other running exits
- **WHEN** an issue transitions from `running` to `completed` or `backlog`
- **THEN** no notification sound is played regardless of the preference value

#### Scenario: Silent on audio failure
- **WHEN** the Web Audio API is unavailable or playback throws
- **THEN** the failure is silent
- **AND** the status change and the rest of the hook are unaffected
