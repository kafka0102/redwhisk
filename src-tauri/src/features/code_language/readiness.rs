//! 语言服务「语义项目加载」就绪状态。
//!
//! `initialize` 只代表语法服务就绪：语义项目（tsconfig、模块解析、依赖源码）是异步加载的，
//! 加载期间返回的定义/引用可能是本文件 import 子句。请求路径因此要等到加载完成后再发请求。

use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// 就绪等待参数。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReadinessConfig {
    /// 单次请求等待项目加载完成的上限；超过上限按未就绪兜底返回，不挂死。
    pub wait_limit: Duration,
    /// didOpen 之后、加载 begin 到达之前的宽限窗：覆盖「刚打开就点击」的竞态。
    pub grace_window: Duration,
}

impl Default for ReadinessConfig {
    fn default() -> Self {
        Self {
            wait_limit: Duration::from_secs(15),
            grace_window: Duration::from_millis(500),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// 未观察到项目加载。
    Idle,
    /// 已 didOpen，但加载 begin 尚未到达。
    AwaitingLoadStart,
    /// 语言服务正在加载语义项目。
    Loading,
    Stopped,
}

#[derive(Debug)]
struct State {
    phase: Phase,
    grace_deadline: Option<Instant>,
}

/// 由 reader 线程推进、请求路径等待的就绪状态。
#[derive(Debug)]
pub struct Readiness {
    config: ReadinessConfig,
    state: Mutex<State>,
    wake: Condvar,
}

impl Readiness {
    pub fn new(config: ReadinessConfig) -> Self {
        Self {
            config,
            state: Mutex::new(State {
                phase: Phase::Idle,
                grace_deadline: None,
            }),
            wake: Condvar::new(),
        }
    }

    /// didOpen：可能触发项目加载，开启宽限窗等待加载 begin。
    pub fn document_opened(&self) {
        let Some(mut state) = self.lock() else {
            return;
        };
        if state.phase == Phase::Idle {
            state.phase = Phase::AwaitingLoadStart;
            state.grace_deadline = Some(Instant::now() + self.config.grace_window);
        }
    }

    /// `$/progress` begin：确认语言服务正在加载项目。
    pub fn loading_started(&self) {
        self.transition(Phase::Loading);
    }

    /// `$/progress` end：项目加载完成，语言智能就绪。
    pub fn loading_finished(&self) {
        self.transition(Phase::Idle);
    }

    /// 宿主停止或语言服务退出：唤醒全部等待者。
    pub fn host_stopped(&self) {
        self.transition(Phase::Stopped);
    }

    /// 等待语言智能就绪；只有确知在加载（或处于 didOpen 宽限窗）时才阻塞。
    ///
    /// 返回 `false` 表示未就绪（宿主已停止，或等待触及上限）：调用方按未就绪返回，
    /// 不要再发请求，避免拿到加载期的假结果。
    pub fn await_ready(&self) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        let limit_deadline = Instant::now() + self.config.wait_limit;
        loop {
            let now = Instant::now();
            match state.phase {
                Phase::Stopped => return false,
                Phase::Idle => return true,
                Phase::Loading => {
                    if now >= limit_deadline {
                        return false;
                    }
                    state = match self.wake.wait_timeout(state, limit_deadline - now) {
                        Ok((guard, _)) => guard,
                        Err(_) => return false,
                    };
                }
                Phase::AwaitingLoadStart => {
                    let grace_deadline = state.grace_deadline.unwrap_or(now);
                    if now >= grace_deadline {
                        // 宽限窗内始终没有 begin：判定本次 didOpen 不触发项目加载。
                        state.phase = Phase::Idle;
                        state.grace_deadline = None;
                        return true;
                    }
                    if now >= limit_deadline {
                        return false;
                    }
                    let wake_at = grace_deadline.min(limit_deadline);
                    state = match self.wake.wait_timeout(state, wake_at - now) {
                        Ok((guard, _)) => guard,
                        Err(_) => return false,
                    };
                }
            }
        }
    }

    fn transition(&self, phase: Phase) {
        let Some(mut state) = self.lock() else {
            return;
        };
        if state.phase == Phase::Stopped {
            return;
        }
        state.phase = phase;
        state.grace_deadline = None;
        drop(state);
        self.wake.notify_all();
    }

    fn lock(&self) -> Option<MutexGuard<'_, State>> {
        self.state.lock().ok()
    }
}
