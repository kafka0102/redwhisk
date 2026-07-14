import type { TerminalOutputChunk, TerminalTransport } from "./terminal-types";

export type TerminalLivePhase = "idle" | "catchingUp" | "live";

const TERMINAL_HISTORY_MAX_BYTES = 1024 * 1024;
const TERMINAL_PENDING_OUTPUT_MAX_BYTES = 64 * 1024;

export interface TerminalLivePipelineCallbacks {
  writeBytes: (bytes: Uint8Array) => void;
  writeHistory: (text: string) => void | Promise<void>;
  onRestoreIncomplete: () => void;
  onRestoreError: (error: unknown) => void;
  onInactive: () => void;
  onLiveReady: () => void;
  onPendingDropped: () => void;
}

/**
 * 终端 live 输出状态机：
 * - idle：不可见，不写 xterm，不依赖 IPC 队列
 * - catchingUp：已订阅后端，live 只入队，禁止写 xterm
 * - live：log 回放与 sequence 对齐完成后，rAF 合并写入
 */
export class TerminalLivePipeline {
  private phase: TerminalLivePhase = "idle";
  private latestSequence = 0;
  private disposed = false;
  private generation = 0;
  private readonly pendingEvents: TerminalOutputChunk[] = [];
  private pendingBytes = 0;
  private rafId: number | null = null;
  private readonly rafChunks: Uint8Array[] = [];
  private rafBytes = 0;

  constructor(
    private readonly transport: TerminalTransport,
    private readonly callbacks: TerminalLivePipelineCallbacks,
  ) {}

  getPhase(): TerminalLivePhase {
    return this.phase;
  }

  handleOutput(event: TerminalOutputChunk): void {
    if (this.disposed) {
      return;
    }

    if (this.phase === "idle") {
      // 全局 event 在无本实例订阅时仍可能到达（其它窗口订阅同一 session）。
      // 本实例不可见时丢弃；再次可见走 log catch-up。
      return;
    }

    if (this.phase === "catchingUp") {
      this.enqueue(event);
      return;
    }

    this.writeLiveEvent(event);
  }

  async becomeVisible(): Promise<void> {
    if (this.disposed || this.phase !== "idle") {
      return;
    }

    this.phase = "catchingUp";
    const generation = ++this.generation;

    try {
      await this.transport.setLiveSubscription(true);
      if (!this.isCurrentGeneration(generation)) {
        return;
      }

      const restoreResult = await this.transport.restore();
      if (!this.isCurrentGeneration(generation)) {
        return;
      }

      const snapshotResult = await this.transport.readSnapshot(
        TERMINAL_HISTORY_MAX_BYTES,
      );
      if (!this.isCurrentGeneration(generation)) {
        return;
      }

      if (snapshotResult.snapshot) {
        await this.callbacks.writeHistory(snapshotResult.snapshot);
        if (!this.isCurrentGeneration(generation)) {
          return;
        }
      }

      if (!restoreResult.isActive) {
        this.clearPendingEvents();
        this.phase = "idle";
        this.callbacks.onInactive();
        await this.safeSetLiveSubscription(false);
        return;
      }

      this.latestSequence = restoreResult.sequence;
      if (!restoreResult.isComplete) {
        this.callbacks.onRestoreIncomplete();
      } else {
        this.callbacks.onLiveReady();
      }

      this.phase = "live";
      this.flushPendingEvents();
    } catch (error) {
      if (!this.isCurrentGeneration(generation)) {
        return;
      }
      this.callbacks.onRestoreError(error);
      // 失败时仍进入 live，避免永久卡在 catchingUp；已入队事件按 sequence 过滤后写出。
      this.phase = "live";
      this.flushPendingEvents();
    }
  }

  async becomeHidden(): Promise<void> {
    if (this.disposed) {
      return;
    }

    const wasSubscribed = this.phase !== "idle";
    this.phase = "idle";
    this.generation += 1;
    this.clearPendingEvents();
    this.clearRafBuffer();
    if (wasSubscribed) {
      await this.safeSetLiveSubscription(false);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.generation += 1;
    const wasSubscribed = this.phase !== "idle";
    this.phase = "idle";
    this.clearPendingEvents();
    this.clearRafBuffer();
    if (wasSubscribed) {
      void this.safeSetLiveSubscription(false);
    }
  }

  private writeLiveEvent(event: TerminalOutputChunk): void {
    if (event.sequence <= this.latestSequence) {
      return;
    }

    const bytes = decodeBase64ToUint8Array(event.data);
    if (!bytes) {
      return;
    }

    this.latestSequence = event.sequence;
    this.scheduleRafWrite(bytes);
  }

  private enqueue(event: TerminalOutputChunk): void {
    this.pendingEvents.push(event);
    this.pendingBytes += estimateBase64DecodedLength(event.data);

    while (
      this.pendingBytes > TERMINAL_PENDING_OUTPUT_MAX_BYTES &&
      this.pendingEvents.length > 0
    ) {
      const dropped = this.pendingEvents.shift();
      if (!dropped) {
        break;
      }
      this.pendingBytes = Math.max(
        0,
        this.pendingBytes - estimateBase64DecodedLength(dropped.data),
      );
      this.callbacks.onPendingDropped();
    }
  }

  private flushPendingEvents(): void {
    for (const event of this.pendingEvents.splice(0)) {
      this.pendingBytes = Math.max(
        0,
        this.pendingBytes - estimateBase64DecodedLength(event.data),
      );
      this.writeLiveEvent(event);
    }
    this.pendingBytes = 0;
  }

  private clearPendingEvents(): void {
    this.pendingEvents.length = 0;
    this.pendingBytes = 0;
  }

  private scheduleRafWrite(bytes: Uint8Array): void {
    if (bytes.length === 0) {
      return;
    }
    this.rafChunks.push(bytes);
    this.rafBytes += bytes.length;
    if (this.rafId === null && typeof window !== "undefined") {
      this.rafId = window.requestAnimationFrame(() => {
        this.flushRafWrites();
      });
    }
  }

  private flushRafWrites(): void {
    this.rafId = null;
    if (this.disposed || this.phase !== "live" || this.rafChunks.length === 0) {
      this.rafChunks.length = 0;
      this.rafBytes = 0;
      return;
    }

    const merged = new Uint8Array(this.rafBytes);
    let offset = 0;
    for (const chunk of this.rafChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.rafChunks.length = 0;
    this.rafBytes = 0;
    this.callbacks.writeBytes(merged);
  }

  private clearRafBuffer(): void {
    if (this.rafId !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.rafChunks.length = 0;
    this.rafBytes = 0;
  }

  private isCurrentGeneration(generation: number): boolean {
    return !this.disposed && this.generation === generation;
  }

  private async safeSetLiveSubscription(active: boolean): Promise<void> {
    try {
      await this.transport.setLiveSubscription(active);
    } catch {
      // 订阅失败不拆毁 surface。
    }
  }
}

export function decodeBase64ToUint8Array(data: string): Uint8Array | null {
  try {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

export function estimateBase64DecodedLength(data: string): number {
  if (data.length === 0) {
    return 0;
  }
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

export function encodeBytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary);
}
