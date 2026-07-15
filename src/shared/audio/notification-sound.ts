// 用 Web Audio API 合成两音上行短促提示音（880Hz -> 1175Hz）。
// 纯前端、无音频资源；AudioContext 不可用或播放失败时静默，不阻断调用方。

const NOTIFICATION_GAIN = 0.5;
const FIRST_TONE_FREQUENCY = 880;
const SECOND_TONE_FREQUENCY = 1175;
const TONE_DURATION_MS = 120;
const RAMP_MS = 10;
// 两音串行播放的总时长；AudioContext.close() 必须在此之后再执行，
// 否则会停止正在播放的 oscillator，导致用户听不到提示音。
const NOTIFICATION_TOTAL_DURATION_MS = TONE_DURATION_MS * 2;

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

  // [notify] 诊断：报告 AudioContext 状态。session 完成由轮询触发（非用户手势），
  // autoplay 策略下若停在 suspended，oscillator 调度不发声（用户听不到提示音）。
  console.info(
    `[notify] playNotificationSound AudioContext state=${audioContext.state}`,
  );

  // 部分 webview 需用户手势后 resume；resume 失败仍尝试调度，不阻断播放。
  void audioContext.resume().catch(() => {});

  try {
    scheduleTwoToneBeep(audioContext);
  } catch {
    // 节点连接或调度异常静默，不向上抛出；调度失败时无音频需立即释放资源。
    void audioContext.close().catch(() => {});
    return;
  }

  // 提示音调度成功后仍在播放，close() 必须延迟到播放结束之后，
  // 否则 AudioContext.close() 会停止正在播放的 oscillator，用户听不到声音。
  window.setTimeout(() => {
    void audioContext.close().catch(() => {});
  }, NOTIFICATION_TOTAL_DURATION_MS);
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
