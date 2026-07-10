## MODIFIED Requirements

### Requirement: Read-only issue detail layout
The read-only Issue detail page SHALL use a two-column detail layout: the left column shows Issue content, and the right column shows linked session context with the same default width as the Agents session side panel.

#### Scenario: Rendering two-column layout
- **WHEN** the user opens the read-only Issue detail page
- **THEN** the page renders a left content column and a right session context column
- **AND** the left and right content areas each have 10px horizontal inset from the page edges
- **AND** the right column width matches the default session side panel width (400px)

#### Scenario: Header keeps full-width divider with 10px content inset
- **WHEN** the user views the read-only Issue detail header
- **THEN** the header bottom border spans the full page width
- **AND** the Issue ID is left-aligned with 10px left inset
- **AND** the header action buttons are right-aligned with 10px right inset

#### Scenario: Left column keeps Issue content presentation
- **WHEN** the user opens the read-only Issue detail page
- **THEN** the left column renders the title, description, and labels using the existing presentation
- **AND** when the issue has labels, a divider still appears below the description before the labels

#### Scenario: Right column shows session info above run parameters
- **WHEN** the read-only Issue detail page has a linked session
- **THEN** the right column shows a session information card titled with the session-info label above a run-parameters card
- **AND** the session information card header includes a “查看会话” action button styled like the session issue panel “查看 issue” button
- **AND** clicking “查看会话” navigates to the existing session page for the linked session
- **AND** the run-parameters card shows agent, workflow skill, and development mode from the linked session

#### Scenario: Right column empty without linked session
- **WHEN** the read-only Issue detail page has no linked session
- **THEN** the right column still occupies the reserved width
- **AND** the page shows an empty state instead of session info and run parameters
