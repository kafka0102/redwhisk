## ADDED Requirements

### Requirement: Global Preferences notification reminder
Global Preferences SHALL render a Notification reminder preference row directly below the Content font size preference, allowing the user to toggle whether a sound is played when an issue transitions from `running` to `review`. The preference SHALL default to off (`No`).

#### Scenario: Notification reminder row placement
- **WHEN** the user opens Global Settings Preferences
- **THEN** the Notification reminder preference row is rendered directly below the Content font size preference row
- **AND** the row uses the same label/control layout as the Content font size preference

#### Scenario: Help tooltip
- **WHEN** the Notification reminder row is rendered
- **THEN** a help icon is displayed next to the preference label
- **AND** hovering or focusing the help icon shows a tooltip with the text `当 agent session 完成或需要用户确认时，发出声音提醒` (localized per active locale)
- **AND** the help icon exposes an accessible name pointing to the same tooltip text

#### Scenario: Default value
- **WHEN** the application starts without a saved notification reminder preference
- **THEN** the preference defaults to `No` (off)
- **AND** the Notification reminder control shows `No` selected

#### Scenario: Control options
- **WHEN** the Notification reminder control is rendered
- **THEN** it offers exactly two options labeled `是`/`否` (`Yes`/`No`) under the active locale
- **AND** the underlying stored values are `true` and `false` respectively

#### Scenario: Persisting the preference
- **WHEN** the user changes the Notification reminder selection
- **THEN** the preference is persisted under the `redwhisk.notification-reminder` storage key
- **AND** on next launch the persisted value is restored
- **AND** persistence failures do not break the runtime toggle

#### Scenario: Returning user keeps preference
- **WHEN** the application starts
- **AND** a `redwhisk.notification-reminder` value is present
- **THEN** the Notification reminder control reflects the persisted value
- **AND** an invalid or missing persisted value falls back to `No`
