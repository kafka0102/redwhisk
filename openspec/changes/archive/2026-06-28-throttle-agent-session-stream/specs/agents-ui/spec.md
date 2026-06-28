## MODIFIED Requirements

### Requirement: Agents Session header compact issue bar

Agents Activity SHALL render the selected Session header as a compact, full-width issue bar without Card styling.

#### Scenario: Session stream handles high-frequency assistant output

- **WHEN** a running Agent Session emits many assistant or reasoning deltas within a short time window
- **THEN** the app batches those deltas before rendering the message stream
- **AND** the final assistant or reasoning text is still rendered when the item or turn completes
- **AND** stream persistence avoids per-delta database session lookups and per-delta latest-output writes
