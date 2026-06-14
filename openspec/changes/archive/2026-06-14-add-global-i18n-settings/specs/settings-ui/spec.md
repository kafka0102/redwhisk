## MODIFIED Requirements

### Requirement: Settings right content layout
The Settings page SHALL render every selected settings module inside a centered right-content container whose width is 80% of the available right pane.

#### Scenario: General settings is selected
- **WHEN** the user selects `General`
- **THEN** the General form card is horizontally centered in the right pane
- **AND** the card uses 80% of the right pane width without a fixed height

#### Scenario: Agents settings is selected
- **WHEN** the user selects `Agents`
- **THEN** the Agents content uses the same centered 80% right-content container as General

#### Scenario: Global preferences is selected
- **WHEN** the user opens Global Settings and selects `Preferences`
- **THEN** the Preferences form uses the same centered 80% right-content container as Project Settings modules
- **AND** the Preferences page does not render Project Settings fields such as Project Name, Completion Policy, or Agent Profiles

#### Scenario: Future settings modules are added
- **WHEN** a new Settings menu item renders right-pane content
- **THEN** it uses the shared Settings right-content container instead of defining a module-specific page width

## ADDED Requirements

### Requirement: Global Settings entry
The application shell SHALL provide a global Settings icon at the bottom of the left navigation that opens application-level Preferences.

#### Scenario: Global Settings icon is rendered
- **WHEN** a project workbench is visible
- **THEN** the left navigation shows the project activity buttons for Issues, Agents, and Project Settings in the primary group
- **AND** a Settings icon is rendered at the bottom of the navigation without visible text
- **AND** the icon exposes an accessible name for Global Settings

#### Scenario: Opening Global Settings
- **WHEN** the user clicks the bottom Settings icon
- **THEN** the main content area shows Global Settings
- **AND** the Global Settings layout uses a left menu and right content area consistent with Project Settings
- **AND** the left menu contains `Preferences`

#### Scenario: Returning to project activity
- **WHEN** the user opens Global Settings and then selects Issues, Agents, or Project Settings
- **THEN** the application returns to the selected project activity
- **AND** previously selected project activity state is not reset solely because Global Settings was opened

### Requirement: Global Preferences language
Global Preferences SHALL allow the user to switch the UI language between English and Chinese.

#### Scenario: Default language
- **WHEN** the application starts without a saved language preference
- **THEN** the UI language defaults to English
- **AND** the Preferences Language section shows `English` selected

#### Scenario: Switching to Chinese
- **WHEN** the user opens Global Settings Preferences
- **AND** selects `中文` in the Language section
- **THEN** visible UI text managed by the i18n runtime changes to Chinese without restarting the app
- **AND** the selected language is persisted for the next app launch

#### Scenario: Switching back to English
- **WHEN** the current language is Chinese
- **AND** the user selects `English`
- **THEN** visible UI text managed by the i18n runtime changes to English without restarting the app
- **AND** the selected language is persisted for the next app launch

### Requirement: Global Preferences theme
Global Preferences SHALL present a Theme setting whose MVP behavior supports Light mode only.

#### Scenario: Default theme
- **WHEN** the application starts
- **THEN** the theme preference defaults to `Light`
- **AND** the Preferences Theme section shows Light selected

#### Scenario: Unimplemented themes are not selectable
- **WHEN** Dark or System theme options are visible
- **THEN** they are disabled or otherwise non-selectable
- **AND** selecting them does not change the current theme away from Light

#### Scenario: Light-only rendering
- **WHEN** the MVP chooses not to show unavailable themes
- **THEN** the Theme section may show only the Light option
- **AND** the UI must not imply that Dark or System mode is currently supported
