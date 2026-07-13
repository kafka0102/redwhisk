import { afterEach, describe, expect, it, vi } from "vitest";

import { playNotificationSound } from "./notification-sound";

interface FakeAudioParam {
  setValueAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
}

interface FakeOscillator {
  frequency: { setValueAtTime: ReturnType<typeof vi.fn> };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

interface FakeGain {
  gain: FakeAudioParam;
  connect: ReturnType<typeof vi.fn>;
}

function createFakeAudioContext() {
  const oscillators: FakeOscillator[] = [];
  const gains: FakeGain[] = [];
  const ctx = {
    currentTime: 0,
    destination: Symbol("destination"),
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createOscillator: vi.fn(() => {
      const oscillator: FakeOscillator = {
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(oscillator);
      return oscillator;
    }),
    createGain: vi.fn(() => {
      const gain: FakeGain = {
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      };
      gains.push(gain);
      return gain;
    }),
  };
  return { ctx: ctx as unknown as AudioContext, oscillators, gains };
}

describe("playNotificationSound", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("合成两音上行 beep 并以适中音量调度", () => {
    const { ctx, oscillators, gains } = createFakeAudioContext();
    vi.stubGlobal(
      "AudioContext",
      // 用 function（非箭头）以便 `new AudioContextCtor()` 返回 fake ctx。
      vi.fn(function () {
        return ctx;
      }),
    );

    playNotificationSound();

    expect(oscillators).toHaveLength(2);
    expect(gains).toHaveLength(2);

    for (const oscillator of oscillators) {
      expect(oscillator.start).toHaveBeenCalledTimes(1);
      expect(oscillator.stop).toHaveBeenCalledTimes(1);
    }

    expect(oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(
      880,
      0,
    );
    expect(oscillators[1].frequency.setValueAtTime).toHaveBeenCalledWith(
      1175,
      expect.any(Number),
    );

    const rampValues = gains.flatMap(
      (gain) => gain.gain.linearRampToValueAtTime.mock.calls,
    );
    expect(rampValues.some(([value]) => value === 0.18)).toBe(true);
  });

  it("AudioContext 不可用时静默返回", () => {
    vi.stubGlobal("AudioContext", undefined);
    expect(() => playNotificationSound()).not.toThrow();
  });

  it("AudioContext 构造抛错时静默", () => {
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function () {
        throw new Error("boom");
      }),
    );
    expect(() => playNotificationSound()).not.toThrow();
  });

  // 提示音调度后仍在播放（两音各 120ms，共约 240ms）；若同步立即 close()，
  // AudioContext.close() 会停止正在播放的 oscillator，用户听不到提示音。
  // close 必须延迟到播放结束之后。
  it("调度提示音后不同步关闭 AudioContext，避免中断正在播放的提示音", () => {
    const { ctx } = createFakeAudioContext();
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function () {
        return ctx;
      }),
    );

    playNotificationSound();

    expect(ctx.close).not.toHaveBeenCalled();
  });
});
