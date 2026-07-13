// 用 Web Audio API 合成两音上行短促提示音（880Hz -> 1175Hz）。
// 纯前端、无音频资源；AudioContext 不可用或播放失败时静默，不阻断调用方。

const NOTIFICATION_GAIN = 0.18;
const FIRST_TONE_FREQUENCY = 880;
const SECOND_TONE_FREQUENCY = 1175;
const TONE_DURATION_MS = 120;
const RAMP_MS = 10;

type AudioContextConstructor = new () => AudioContext;

export function playNotificationSound(): void {
  const AudioContextCtor = getAudioContextConstructor();
  if (!AudioContextCtor) {
    return;
  }

  let audioContext: AudioContext;
  try {
    audioContext = new AudioContextCtor();
  } catch {
    return;
  }

  // 部分 webview 需用户手势后 resume；resume 失败仍尝试调度，不阻断播放。
  void audioContext.resume().catch(() => {});

  try {
    scheduleTwoToneBeep(audioContext);
  } catch {
    // 节点连接或调度异常静默，不向上抛出。
  } finally {
    void audioContext.close().catch(() => {});
  }
}

function scheduleTwoToneBeep(audioContext: AudioContext): void {
  const toneDurationSeconds = TONE_DURATION_MS / 1000;
  const startTime = audioContext.currentTime;
  scheduleTone(
    audioContext,
    FIRST_TONE_FREQUENCY,
    startTime,
    toneDurationSeconds,
  );
  scheduleTone(
    audioContext,
    SECOND_TONE_FREQUENCY,
    startTime + toneDurationSeconds,
    toneDurationSeconds,
  );
}

function scheduleTone(
  audioContext: AudioContext,
  frequency: number,
  startAt: number,
  durationSeconds: number,
): void {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(
    NOTIFICATION_GAIN,
    startAt + RAMP_MS / 1000,
  );
  gain.gain.linearRampToValueAtTime(0, startAt + durationSeconds);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);

  oscillator.start(startAt);
  oscillator.stop(startAt + durationSeconds);
}

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const windowWithLegacyAudio = window as typeof window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  return (
    windowWithLegacyAudio.AudioContext ??
    windowWithLegacyAudio.webkitAudioContext ??
    null
  );
}
