export interface TerminalOutputChunk {
  sequence: number;
  data: number[];
}

export interface TerminalSnapshotResult {
  snapshot: string;
  isActive: boolean;
}

export interface TerminalRestoreResult {
  sequence: number;
  chunks: number[][];
  isComplete: boolean;
  isActive: boolean;
}

export interface TerminalTransport {
  readSnapshot: (maxBytes: number) => Promise<TerminalSnapshotResult>;
  resize: (rows: number, cols: number) => Promise<void>;
  restore: () => Promise<TerminalRestoreResult>;
  subscribeOutput: (
    handler: (event: TerminalOutputChunk) => void,
  ) => Promise<() => void>;
  write: (data: string) => Promise<void>;
}
