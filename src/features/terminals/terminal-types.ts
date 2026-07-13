export interface TerminalOutputChunk {
  sequence: number;
  /** base64-encoded terminal bytes */
  data: string;
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
  /**
   * 后端可见订阅 refcount。可见时 true，隐藏时 false。
   * 无订阅时后端不推 live IPC。
   */
  setLiveSubscription: (active: boolean) => Promise<void>;
  subscribeOutput: (
    handler: (event: TerminalOutputChunk) => void,
  ) => Promise<() => void>;
  write: (data: string) => Promise<void>;
}
