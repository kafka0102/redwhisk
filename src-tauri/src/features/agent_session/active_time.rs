//! 「活跃时长」判定：判断相邻两次心跳采样之间的间隔是否可信。
//!
//! 心跳按固定间隔采样墙钟与单调时钟。两次采样的墙钟增量与单调时钟增量本应
//! 大致相等：进程被系统挂起（睡眠 / 关机）时单调时钟不推进而墙钟继续走，系统
//! 时钟被 NTP 校正时墙钟会跳变。任一种情形都让该间隔不可信，整段丢弃。
//! 口径见 `docs/adr/0043-session-duration-active-time.md`。

use std::time::Instant;

/// 墙钟增量与单调时钟增量之间允许的最大偏差。
const MAX_WALL_CLOCK_DRIFT_MS: i64 = 2_000;
/// 单次间隔的墙钟增量上限，超过即认定进程被挂起。
/// 取心跳间隔（5 秒）的 3 倍：正常的 tick 抖动不会被误判为挂起。
const MAX_WALL_CLOCK_INTERVAL_MS: i64 = 15_000;

/// 一次心跳采样：墙钟（Unix epoch 毫秒）与单调时钟。
#[derive(Debug, Clone, Copy)]
pub struct ActiveTimeSample {
    pub wall_clock_ms: i64,
    pub monotonic: Instant,
}

/// 相邻两次采样之间应累加的活跃毫秒数；间隔不可信时返回 0。
pub fn active_ms_between(previous: ActiveTimeSample, current: ActiveTimeSample) -> i64 {
    let wall_clock_delta_ms = current.wall_clock_ms - previous.wall_clock_ms;
    if wall_clock_delta_ms <= 0 || wall_clock_delta_ms > MAX_WALL_CLOCK_INTERVAL_MS {
        return 0;
    }
    let monotonic_delta_ms = current
        .monotonic
        .saturating_duration_since(previous.monotonic)
        .as_millis() as i64;
    if (wall_clock_delta_ms - monotonic_delta_ms).abs() > MAX_WALL_CLOCK_DRIFT_MS {
        return 0;
    }
    wall_clock_delta_ms
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    const SAMPLE_WALL_CLOCK_MS: i64 = 1_700_000_000_000;

    /// 采样对：墙钟增量与单调时钟增量由参数独立给出，便于构造墙钟跳变 / 挂起。
    fn samples(
        wall_clock_delta_ms: i64,
        monotonic_delta_ms: i64,
    ) -> (ActiveTimeSample, ActiveTimeSample) {
        // 基准点往前留足余量，负增量也能安全回退到真实的早期 Instant。
        let base = Instant::now() + Duration::from_secs(60);
        let previous = ActiveTimeSample {
            wall_clock_ms: SAMPLE_WALL_CLOCK_MS,
            monotonic: base,
        };
        let monotonic_delta = Duration::from_millis(monotonic_delta_ms.unsigned_abs());
        let monotonic = if monotonic_delta_ms >= 0 {
            base + monotonic_delta
        } else {
            base - monotonic_delta
        };
        let current = ActiveTimeSample {
            wall_clock_ms: SAMPLE_WALL_CLOCK_MS + wall_clock_delta_ms,
            monotonic,
        };
        (previous, current)
    }

    #[test]
    fn normal_interval_accumulates_its_wall_clock_delta() {
        let (previous, current) = samples(5_000, 5_000);
        assert_eq!(active_ms_between(previous, current), 5_000);
    }

    #[test]
    fn suspended_interval_discards_time_when_only_the_wall_clock_advances() {
        // 系统睡眠：墙钟走过 5 分钟，单调时钟在挂起期间不推进。
        let (previous, current) = samples(300_000, 0);
        assert_eq!(active_ms_between(previous, current), 0);
    }

    #[test]
    fn wall_clock_jump_beyond_the_interval_limit_is_discarded() {
        // NTP 校时 / 唤醒后墙钟一次性前进 60 秒，单调时钟只推进 5 秒。
        let (previous, current) = samples(60_000, 5_000);
        assert_eq!(active_ms_between(previous, current), 0);
    }

    #[test]
    fn drift_beyond_the_tolerance_is_discarded() {
        let (previous, current) = samples(5_000, 2_900);
        assert_eq!(active_ms_between(previous, current), 0);
    }

    #[test]
    fn drift_at_the_tolerance_boundary_is_still_active_time() {
        let (previous, current) = samples(5_000, 3_000);
        assert_eq!(active_ms_between(previous, current), 5_000);
    }

    #[test]
    fn wall_clock_delta_at_the_interval_limit_is_still_active_time() {
        let (previous, current) = samples(15_000, 15_000);
        assert_eq!(active_ms_between(previous, current), 15_000);
    }

    #[test]
    fn wall_clock_delta_beyond_the_interval_limit_is_discarded() {
        let (previous, current) = samples(15_001, 15_001);
        assert_eq!(active_ms_between(previous, current), 0);
    }

    #[test]
    fn negative_wall_clock_delta_accumulates_nothing() {
        let (previous, current) = samples(-5_000, -5_000);
        assert_eq!(active_ms_between(previous, current), 0);
    }

    #[test]
    fn zero_wall_clock_delta_accumulates_nothing() {
        let (previous, current) = samples(0, 0);
        assert_eq!(active_ms_between(previous, current), 0);
    }
}
