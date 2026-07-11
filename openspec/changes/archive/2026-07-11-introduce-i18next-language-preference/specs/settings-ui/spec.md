## MODIFIED Requirements

### Requirement: Global Preferences language
Global Preferences SHALL render a Language preference row directly below the Theme preference, allowing the user to switch the UI language between Simplified Chinese and English, with Simplified Chinese as the default for first launch.

#### Scenario: Language preference row placement
- **WHEN** the user opens Global Settings Preferences
- **THEN** the Language preference row is rendered directly below the Theme preference row
- **AND** the Language preference appears above the Content font size preference

#### Scenario: Default language
- **WHEN** the application starts without a saved language preference
- **THEN** the UI language defaults to Simplified Chinese
- **AND** the Preferences Language control shows `简体中文` selected

#### Scenario: Switching to English
- **WHEN** the user selects `English` in the Language preference
- **THEN** visible UI text managed by the i18n runtime changes to English without restarting the app
- **AND** the selected language is persisted for the next app launch

#### Scenario: Switching back to Simplified Chinese
- **WHEN** the current language is English
- **AND** the user selects `简体中文`
- **THEN** visible UI text managed by the i18n runtime changes to Simplified Chinese without restarting the app
- **AND** the selected language is persisted for the next app launch

#### Scenario: Language control options
- **WHEN** the Language preference control is rendered
- **THEN** it offers exactly two options labeled `简体中文` and `English`
- **AND** the underlying stored values are `zh` and `en` respectively
