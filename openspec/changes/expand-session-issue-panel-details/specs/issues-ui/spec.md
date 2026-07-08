# issues-ui Specification Delta

## ADDED Requirements

### Requirement: Issue detail preserves session return context

The Issues page SHALL preserve the caller context when a read-only Issue detail page is opened from an Agent Session side panel.

#### Scenario: Returning to a Session-origin Issue detail

- **WHEN** the user opens an Issue detail page from an Agent Session side panel
- **AND** the Issue detail page renders the read-only back action
- **THEN** clicking the back action returns to the originating Session instead of the Issues kanban
- **AND** the originating Session is re-selected
- **AND** the right Session side panel is restored to its previous open state

#### Scenario: Returning to a normal Issue detail

- **WHEN** the user opens an Issue detail page directly from the Issues Activity
- **THEN** clicking the back action keeps the existing behavior and returns to the Issues surface
