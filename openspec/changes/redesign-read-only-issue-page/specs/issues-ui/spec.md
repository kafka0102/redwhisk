## MODIFIED Requirements

### Requirement: Read-only issue detail actions
The read-only Issue detail page SHALL expose low-risk primary actions in the header and move secondary or destructive actions into a more menu.

#### Scenario: Opening the more menu
- **WHEN** the user views a read-only Issue detail page
- **THEN** the header shows back and status transition actions
- **AND** the header shows a horizontal three-dot more button
- **AND** the header does not show a standalone delete button

#### Scenario: Selecting a menu action
- **WHEN** the user opens the more menu
- **THEN** the menu contains edit issue, view session, view summary, and delete issue actions
- **AND** edit issue opens the existing edit flow
- **AND** view session navigates to the existing session page
- **AND** view summary opens the existing summary dialog
- **AND** delete issue opens the existing delete confirmation before deleting

### Requirement: Read-only issue detail layout
The read-only Issue detail page SHALL use a single-column detail layout consistent with the Issue edit page while preserving the existing visual style.

#### Scenario: Rendering issue metadata
- **WHEN** the user opens the read-only Issue detail page
- **THEN** the page renders the title, status, description, and related metadata in one column
- **AND** the previous right-side detail column is not rendered

#### Scenario: Rendering labels below description
- **WHEN** the issue has labels
- **THEN** the page renders a divider below the description
- **AND** the labels are shown inline using the existing label badge style

### Requirement: Read-only issue description attachments
The read-only Issue detail page SHALL render Markdown attachment tokens as visible attachments inside the description.

#### Scenario: Rendering an image attachment token
- **WHEN** the description contains an image attachment token with a local file path
- **THEN** the page resolves the token to an absolute renderable path
- **AND** the image is displayed inline instead of only showing the file name

#### Scenario: Rendering a non-image attachment token
- **WHEN** the description contains a non-image attachment token
- **THEN** the page displays an attachment item in the description
- **AND** the item supports downloading the file
- **AND** the item supports preview when the file type is previewable

#### Scenario: Handling missing attachment files
- **WHEN** an attachment token cannot be resolved to an existing file
- **THEN** the page keeps a readable attachment name
- **AND** the page does not render a broken image
