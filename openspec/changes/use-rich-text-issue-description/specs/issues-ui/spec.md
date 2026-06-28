## MODIFIED Requirements

### Requirement: Attachment insertion in issue editor
The issue create and edit flows SHALL allow users to insert image and file attachment embeds directly from the description rich text editor toolbar.

#### Scenario: Selecting a file from the editor toolbar
- **WHEN** the user clicks the file upload control inside the description editor toolbar
- **THEN** the app opens a file picker
- **AND** after the user selects a file, the app inserts the selected file into the editor content
- **AND** the dialog footer does not show a separate attachment upload icon

#### Scenario: Rendering attachment type icons
- **WHEN** a non-image attachment embed is shown in the editor
- **THEN** PDF files show a PDF-specific icon
- **AND** Word files show a Word-specific icon
- **AND** text files show a text-specific icon
- **AND** other files show a generic file icon

#### Scenario: Rendering image attachments inline
- **WHEN** an image attachment is inserted into the editor
- **THEN** the editor displays the image inline in the description content

### Requirement: Attachment actions and preview rules
The issue editor SHALL expose preview, download, and delete actions from attachment embeds inside the rich text editor according to attachment type.

#### Scenario: Previewing an image attachment
- **WHEN** the attachment embed is an image
- **THEN** the embed exposes a `查看` action
- **AND** clicking it opens an image preview dialog

#### Scenario: Previewing a text attachment
- **WHEN** the attachment embed is a non-binary text file such as `md` or `json`
- **THEN** the embed exposes a `查看` action
- **AND** clicking it opens a text preview dialog

#### Scenario: Binary attachment without preview
- **WHEN** the attachment embed is a binary file that is not previewable
- **THEN** the embed does not show a `查看` action
- **AND** the embed still shows download and delete actions

#### Scenario: Downloading an attachment
- **WHEN** the user clicks the download action on an attachment embed
- **THEN** the app exports the attachment file to a user-selected location

#### Scenario: Deleting an attachment
- **WHEN** the user clicks the delete action on an attachment embed
- **THEN** the attachment is removed from the editor content and from the issue attachment list submitted to the backend

## ADDED Requirements

### Requirement: Rich text issue description editor
The Issues page SHALL use a reusable rich text editor component for backlog issue creation and editing descriptions.

#### Scenario: Formatting issue description text
- **WHEN** the user edits an issue description
- **THEN** the editor supports normal rich text editing
- **AND** the editor supports heading styles, bold text, ordered lists, and unordered lists

#### Scenario: Using Markdown shortcuts
- **WHEN** the user types a supported Markdown shortcut such as `# `, `## `, `- `, `1. `, or `**bold**`
- **THEN** the editor applies the corresponding rich text formatting

#### Scenario: Persisting description text
- **WHEN** the issue is created or saved
- **THEN** the app persists the description as Markdown-compatible text for existing run prompt behavior
