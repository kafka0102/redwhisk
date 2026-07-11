## ADDED Requirements

### Requirement: Internationalization runtime
The frontend SHALL use `i18next` with `react-i18next` as the internationalization runtime, exposing localized strings through `useTranslation() / t()` with declarative `{{name}}` interpolation.

#### Scenario: Resources are JSON namespaces
- **WHEN** the i18n runtime is initialized
- **THEN** localized strings are sourced from JSON resources organized by locale (`en`, `zh`) and namespace
- **AND** parameterized messages are authored as `{{name}}` template strings rather than closure functions

#### Scenario: Locale persistence
- **WHEN** the user changes the UI language at runtime
- **THEN** the runtime switches the active locale immediately without an application restart
- **AND** the selected locale is persisted under the existing `redwhisk.locale` storage key
- **AND** on next launch the persisted locale is restored

#### Scenario: Fallback behavior
- **WHEN** a translation key is missing for the active locale
- **THEN** the runtime falls back to the fallback locale deterministically
- **AND** the user is not shown a raw key or a template placeholder

### Requirement: Default UI locale
The application SHALL default the UI locale to Simplified Chinese (`zh`) when no locale preference has been persisted.

#### Scenario: First launch without preference
- **WHEN** the application starts for the first time
- **AND** no `redwhisk.locale` value is present
- **THEN** the active UI locale is `zh`

#### Scenario: Returning user keeps preference
- **WHEN** the application starts
- **AND** a `redwhisk.locale` value is present
- **THEN** the active UI locale matches the persisted value regardless of the default

### Requirement: Localized terminology
The Simplified Chinese (`zh`) resources SHALL use consistent terminology: `agent` as `智能体`, `session` as `会话`, and `Issues` as `任务`, including their common derivations.

#### Scenario: Chinese terminology consistency
- **WHEN** any user-visible Simplified Chinese text references an agent, session, or issues concept
- **THEN** the term is rendered as `智能体`, `会话`, or `任务` respectively
- **AND** the text does not mix in alternative translations such as `代理`, raw `Agent`, raw `Session`, or `问题` for the issues concept

#### Scenario: Identifiers are unchanged
- **WHEN** terminology unification is applied
- **THEN** source identifiers, file names, and route keys are not renamed
- **AND** only user-visible `zh` message values are affected

### Requirement: Backend error localization boundary
The frontend SHALL localize backend errors by mapping known error codes or types to localized templates; the Rust backend SHALL remain free of user-facing display text and SHALL not be aware of the UI locale.

#### Scenario: Known backend error is localized
- **WHEN** the frontend receives a backend error whose code or type matches a known mapping
- **THEN** the user-visible error is rendered from a localized template with interpolated parameters

#### Scenario: Unknown backend error falls back to backend message
- **WHEN** the frontend receives a backend error with no known mapping
- **THEN** the user-visible error shows the backend-provided English message
- **AND** the rendered error does not mix Chinese characters into an English-locale context

#### Scenario: Backend remains locale-agnostic
- **WHEN** any backend error is produced
- **THEN** the Rust source contains no user-facing display text and no locale awareness
- **AND** localization is performed exclusively on the frontend
