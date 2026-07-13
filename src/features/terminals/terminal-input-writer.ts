/**
 * 终端输入写入器：保证按键顺序，并在上一次 IPC 未完成时合并后续输入，
 * 避免每个字符各打一次并发 invoke 造成卡顿与乱序风险。
 */
export function createTerminalInputWriter(
  write: (data: string) => Promise<void>,
  onError: (error: unknown) => void,
): { push: (data: string) => void; dispose: () => void } {
  let buffer = "";
  let flushing = false;
  let disposed = false;

  const flush = async (): Promise<void> => {
    if (disposed || flushing) {
      return;
    }

    flushing = true;
    try {
      while (buffer.length > 0 && !disposed) {
        const chunk = buffer;
        buffer = "";
        try {
          await write(chunk);
        } catch (error) {
          onError(error);
        }
      }
    } finally {
      flushing = false;
      if (!disposed && buffer.length > 0) {
        void flush();
      }
    }
  };

  return {
    push(data: string): void {
      if (disposed || data.length === 0) {
        return;
      }
      buffer += data;
      void flush();
    },
    dispose(): void {
      disposed = true;
      buffer = "";
    },
  };
}
