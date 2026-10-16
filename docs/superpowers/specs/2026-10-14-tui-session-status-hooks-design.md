# TUI Session 用 Hook 驱动左侧 running

日期：2026-10-14。事实来源见 [TUI Session 用 Agent Hook 补 running 状态](../../survey/tui-session-status-via-agent-hooks.md)。本文只定方案，不改代码。

## 问题

Agents 左侧 card 的绿色 running 来自 `isTurnRunning`，不是「PTY 还活着」。json 会话由 `TurnStarted` / `TurnCompleted` 维护这列；Codex 与 Grok 的 TUI 不发这些事件，`is_turn_running` 停在默认 0。关联 Issue 仍是 `running` 时，`getSessionStatusTone` 返回 `in-progress`，圆点是 `#4d84ff`。

Codex CLI 与 Grok Build 都已提供 lifecycle hook。Open Island 用 `UserPromptSubmit` → running、Stop 族 → idle，证明这条边沿足够点亮「正在跑一轮」，而不必解析终端。

## 目标

- Codex TUI、Grok Build TUI 在用户提交一轮之后，左侧 card 与 json 会话一样显示绿色点并转圈；该轮结束、被打断或进程退出后回到现在的蓝点 / 终态点。
- 事实仍只写 SQLite `agent_sessions.is_turn_running`。前端继续只读 `list_agent_sessions`。
- hook 命令 fail-open：写失败、应用没开、对不上 session，都不阻断 agent，不回 deny。
- 用户能看见 RedWhisk 是否已把自己的 hook 注册进这两个 CLI，并能安装 / 卸载。卸载只移除 RedWhisk 自己的条目。

## 非目标

- 不改变 `AgentSessionStatus`（仍是 `running | closed | crashed | stopped`）。
- 不把 hook 接到 json 会话，不伪造 `AgentStreamEvent`，不做消息流、权限卡、token、timeline。
- 不解析 PTY，不用「进程活着」置 `is_turn_running=1`。
- 不覆盖 Claude / OpenCode / DeepSeek Harness。
- 不代用户完成 Codex `/hooks` 信任，不使用 `--dangerously-bypass-hook-trust`。
- 不替换 `~/.codex/hooks.json` 或 `~/.grok/hooks/` 里已有的 Open Island、orca 或用户自己的 command。
- 不把 Grok 的 hook 写进 `~/.claude/settings.json`。
- 不改 Issue 状态机，不驱动完成流或自动评论。

## 方案

新增一条旁路：TUI 子进程触发 CLI hook → 本机小命令把事件交给 RedWhisk → Rust 按 provider 规则改 `is_turn_running` → 沿用 `agent-session-list-changed` 让列表重绘。

不新建 HTTP 服务。hook 进程与 Tauri 后端用本机 Unix 数据报或短连接 stream socket，socket 路径放在应用数据目录（与 SQLite 同级，具体文件名实现时再定）。协议是一行 JSON。后端不在时，hook 读完 stdin 后以 0 退出。

### 关联

`PtySpawnRequest` 增加可选环境。只有 Codex / Grok 的 TUI spawn 与 TUI resume 注入：

- `REDWHISK_SESSION_ID`：RedWhisk 的 `agent_sessions.id`（十进制）。
- `REDWHISK_AGENT_KIND`：`codex` 或 `grok`。

`spawn_pending` 今天会继承父进程环境并额外写入 `TERM` / `COLORTERM` / `COLORFGBG` / `PATH`。这两个键只加在 Agent TUI 的 spawn 上，不加在项目终端上。子进程里用户再开的 shell 可能继承它们；hook 命令只在 CLI 把事件交给它时才读，继承本身不写库。

查找顺序：

1. 环境变量 `REDWHISK_SESSION_ID` 命中一条 `status=running` 且 `display_mode=tui` 的行，并且该行的 `agent_type` 与 `REDWHISK_AGENT_KIND` 一致。这是主路径，启动瞬间就可用。
2. 否则用 payload 的 provider session id 匹配 `provider_session_id`（Codex 字段 `session_id`，Grok 字段 `sessionId`，兼容另一侧的别名）。TUI resume 或 session log 已经回填后，晚到的事件仍能对上。
3. 两步都失败：丢弃并计数，不按 CWD 猜测。同一仓库可以有多条 TUI。

Grok 还会把 Claude 配置里的 hook 当 Claude hook 跑。那些进程没有这对环境变量，也没有 Grok 的 `GROK_SESSION_ID` 时，RedWhisk 的命令根本不会被写进 Claude 配置，因此不会误收。

### 注册进 CLI 的形态

RedWhisk 注册观察事件，外加 `PreToolUse` / `PostToolUse` 作为长 turn 的保活。这些命令仍是 fail-open：stdout 为空、退出码 0，不回 deny。timeout 5 秒，避免拖住工具。

Codex，合并进 `~/.codex/hooks.json` 的 `hooks` 对象（官方格式，事件名在 `hooks` 下）。每个事件追加一个 matcher 组，不删除其它组：

| 事件 | matcher | timeout |
| --- | --- | --- |
| `UserPromptSubmit` | 省略 | 5 |
| `PreToolUse` | 省略 | 5 |
| `PostToolUse` | 省略 | 5 |
| `Stop` | 省略 | 5 |
| `Interrupt` | 省略 | 不写；官方默认 1 秒，上限 3 秒 |

`SessionStart` 不注册。它对绿点没有帮助（提交前应保持 idle），少一个需要信任的定义。

Grok，独占文件 `~/.grok/hooks/redwhisk.json`。官方发现规则是该目录全部 `*.json`，与现有 `open-island.json` 互不覆盖。timeout 显式写 5（Grok 默认也是 5；不沿用 Open Island 的 45，避免拖住 turn）：

| 事件 | matcher |
| --- | --- |
| `UserPromptSubmit` | 省略 |
| `PreToolUse` | `*` |
| `PostToolUse` | `*` |
| `PostToolUseFailure` | `*` |
| `Stop` | 省略 |
| `StopFailure` | 省略 |
| `StopCancelled` | 省略 |
| `Notification` | `*` |

`StopCancelled` 以本机 Grok 1.0.41 与 Open Island 的已观察行为为准，官方 2026-07-02 的事件表没有这一名。若未来版本不再投递，`Interrupt` 不存在于 Grok 表，收口靠 `Notification` 的 `idle_prompt`、进程退出和下面的空闲超时。

command 是 RedWhisk 安装目录里的小二进制（或 `redwhisk` CLI 的子命令，实现时二选一），参数只有 `--source codex` 或 `--source grok`。识别「这是不是我们的条目」只看 command 路径包含该二进制且 source 匹配，不看 timeout。卸载按这个判定删除；Grok 再删整个 `redwhisk.json`（文件里若被用户改进别的 command，则只删我们的条目，文件空了才删文件）。

Codex 的 feature flag：安装前读 `codex features list`。`hooks` 已是 stable 且默认开启时，不改 `config.toml`。仅当有效值为 false 且用户在设置里再次确认，才写 `[features] hooks = true`。不写已弃用的 `codex_hooks`。不在 `requirements.toml` 或托管层写任何东西。

### 事件到 turn 标志

只允许改 `display_mode=tui`、`status=running`、`agent_type` 为 codex 或 grok 的行。命中 0 行则忽略。

| 输入 | `is_turn_running` |
| --- | --- |
| Codex / Grok `UserPromptSubmit` | 1，并清空 `turn_ended_at` |
| Codex / Grok `PreToolUse`，当前为 0 | 1，并清空 `turn_ended_at` |
| Codex / Grok `PreToolUse`，当前为 1 | 不改行，只刷新 3 分钟静默墙钟 |
| Codex / Grok `PostToolUse` / `PostToolUseFailure`，当前为 1 | 不改行，只刷新静默墙钟 |
| 上述 Post 事件，当前为 0 | 不改，避免 Stop 之后被补发的工具收尾重新点亮 |
| Codex `Stop` | 0 |
| Codex `Interrupt` | 0 |
| Grok `Stop`，且 `reason` 缺省或等于 `end_turn` | 0 |
| Grok `Stop`，`reason` 为其它值 | 不改 |
| Grok `StopFailure`、`StopCancelled` | 0 |
| Grok `Notification` 且类型为 `idle_prompt`，当前为 1 | 0 |
| 同事件但当前已是 0 | 不改 |
| 进程退出（现有 `mark_terminated_*`） | 已会写 0 |

置 1 时同时写 `turn_started_at=now` 并清 `turn_ended_at`（与 broadcaster 处理 `TurnStarted` 的三步一致：`update_turn_running(true)`、`clear_turn_ended_at`、`update_turn_started_at`）。只复用 `ensure_turn_running` 不够，它不写 `turn_started_at`。置 0 时复用立即结束的语义：`is_turn_running=0` 且 `turn_ended_at=NULL`，不走 json 的 grace。hook 的 Stop 已经是 turn 边界，grace 会让绿点多留一轮心跳。不写 `current_turn_id`，也不触发 `TurnCompleted` handler。

每次实际变更都发已有的 `agent-session-list-changed`。没有新的 Tauri event。前端 `getSessionStatusTone`、`shouldShowRunningSpinner`、`isAgentTurnActivelyRunning` 不改。

`attention=requested` 仍然压过绿点。本方案不因为 `UserPromptSubmit` 去清 attention，也不因为 Stop 去设 attention。权限等待仍是另一条事实。

### 漏事件

只清、不置的兜底，挂在现有 5 秒心跳循环旁，不新增定时器产品：

- 记录该 TUI 行最后一次「hook 置为 running」的墙钟（内存即可，不必新列；进程重启后本来就不知道半截 turn）。
- 若标志仍为 1，且之后 3 分钟没有任何会维持 running 的 hook（新的 `UserPromptSubmit`，或 `PreToolUse` / `PostToolUse` / `PostToolUseFailure`），就写 0。3 分钟只为吞掉丢失的 Stop，不表示 turn 的合法时长。工具事件只在已经是 1 时刷新墙钟，因此一次持续数分钟的工具循环不会在中途被清成蓝点。
- 若产品验证发现 Codex / Grok 在长 turn 中完全静默、Stop 又经常丢，再把窗口调大；默认先短，避免死绿。

进程退出路径保持权威：退出即 0，不受这个窗口影响。

### 活跃时长

`accumulate_active_time_ms` 的 WHERE 必须加上 `display_mode='json'`。该语句按 `turn_started_at` 夹取墙钟；hook 置 1 时又必须写 `turn_started_at`，否则 json 心跳的夹取语义不完整。两件事一起发生时，若不收紧 WHERE，TUI 会开始按墙钟累加 `processing_ms`，和 ADR-0046 的 Codex TUI session log 覆盖打架。Grok TUI 今天没有 session log 时长同步，收紧之后 Grok TUI 的 `processing_ms` 维持现状（不开始用 turn 墙钟计时）。那是单独的度量问题，不塞进这次。

## 数据流

```text
Codex / Grok TUI（PTY 子进程，带 REDWHISK_SESSION_ID）
  │ 生命周期到达：stdin JSON
  ▼
redwhisk hook 命令
  │ 本机 socket 一行 JSON；失败则 exit 0
  ▼
src-tauri hook listener（app 启动时监听，退出时关闭）
  │ 解析 + 关联 + 上表
  ▼
agent_sessions.is_turn_running
  │ agent-session-list-changed
  ▼
list_agent_sessions → Agents 左侧 card
```

hook 命令不做业务判断。payload 原样带上 `source`、原始 JSON、以及进程环境里的 `REDWHISK_SESSION_ID` / `REDWHISK_AGENT_KIND`。规则只在 Rust。

监听器收到无法解析的 JSON：丢弃。应用未运行：命令 exit 0。两条都不得向 stdout 写 deny，不得 exit 2。

## 配置

设置放在 Project Settings 的 Agents 模块内，不新增左侧菜单项。外层仍是 [Settings 页面布局](../../architecture-design/settings-page-layout.md)：左菜单、右内容 80% 居中。Agents 面板里增加一张 card，标题和正文全部走 `src/shared/i18n/**`，zh 与 en 同时给齐。

card 展示两行，Codex 与 Grok 各一行：

- 未注册 / 已注册 / 注册后 CLI 仍可能要求信任。
- Codex 行若 `codex features list` 看到 `hooks` 为 false，说明绿点不会出现，并给出单独的「允许写入 `[features] hooks = true`」动作，不跟「安装 hook」合成一个无法撤销的点击。
- 动作只有安装、卸载、重新检测。检测只读 `hooks.json` 或 `redwhisk.json`，不 spawn agent。

安装与卸载是 Tauri command，后端执行文件修改。前端不直接写 `~/.codex` 或 `~/.grok`。SQLite 只记录用户偏好「允许为这个机器注册」，不把 hook 文件内容当业务状态复制一份。偏好是应用级的（CLI 配置在用户主目录，不在项目里），可以落在现有应用设置库；若现有库没有合适的键值表，再加一张单行表。不要放进 `agent_profiles`：display mode 仍是 profile 的事，hook 开关不是某个 profile 的字段。

文案必须写明：

- 只影响本机 RedWhisk 拉起的 Codex / Grok TUI 的左侧 running。
- Codex 安装后若 CLI 提示 review hooks，需要在 Codex 里执行 `/hooks` 并信任 RedWhisk 那几条，否则事件不会来。
- 不会删除其它产品写在同一文件里的 hook。

不提供「编辑 hook 脚本」「自定义事件列表」「http hook」。

## 状态机影响

对齐 [领域状态机](../../domain/state-machine.md)：

- Issue 状态、Session 四态、attention 两态都不变。
- `is_turn_running` 的写入方仍是 Rust。新增的写入者是 hook listener，与 broadcaster 并列，不把写入权交给前端或 hook 命令。
- json 行的写入者仍只有 broadcaster。listener 的 SQL 带 `display_mode='tui'`，避免双写。
- TUI 行不再使用 grace。json 的 grace 逻辑不改。
- 心跳累加改为只命中 json，使「TUI 无结构化 Turn 事件所以不计墙钟」在 hook 把标志打成 1 之后仍然成立。

`docs/architecture-design/agent-provider-protocol.md` 里「tui 的产品状态以进程存活为准（`isTurnRunning` 不依赖易碎启发）」在实现时要改成：进程存活仍决定 Session 四态；Codex / Grok TUI 的 `is_turn_running` 由已注册 hook 的 turn 边沿决定；未注册时保持今天的蓝点。TTY 启发式仍然不做。

## 验收

- Codex TUI、hook 已注册且已信任：提交 prompt 后该 card 变为 `status-dot--running` 并出现 spinner；Stop 后恢复 `in-progress` 蓝点；`attention=requested` 时仍是 attention 色，不转圈。
- Grok TUI：`UserPromptSubmit` 变绿；工具循环中的 `PreToolUse` 保持绿，若静默兜底已清掉则下一次 `PreToolUse` 再变绿；`Stop`（无 reason 或 `end_turn`）变蓝；`reason=shutdown` 不变；`StopCancelled` 与 `StopFailure` 变蓝；`idle_prompt` 只在当前为绿时变蓝。
- 同一 `~/.codex/hooks.json` 里原有 Open Island command 还在；卸载后只少 RedWhisk 自己的事件组。`~/.grok/hooks/open-island.json` 字节不变；卸载后没有 `redwhisk.json`。
- hook 命令在 socket 拒绝连接时 exit 0，stdout 为空。
- 不带 `REDWHISK_SESSION_ID`、且 `provider_session_id` 也对不上的事件不改任何行。
- 项目终端的 PTY 环境里没有这两个变量。
- json 会话的 turn 标志与 grace 行为与改动前一致。
- 一条 Codex TUI 在 turn 中停留超过一次心跳后，`processing_ms` 仍只由 session log 同步改写，不被 `accumulate_active_time_ms` 增加。
- 杀掉 TUI 进程后标志为 0，session 状态仍按现有 exit / crash / stopped 规则，不因为 hook 没来得及发 Stop 而停在绿点。
- 设置 card 的全部可见字符串在 zh 与 en 都有条目。

## 风险

- Codex 信任门会让「已安装」不等于「会收到事件」。设置文案和检测状态必须把这件事说成 CLI 侧状态，而不是 RedWhisk 故障。检测做不到「已信任」时，就不要显示成已生效。
- 官方事件表会变。Grok 的 `StopCancelled` 已经比 2026-07-02 文档多一项。实现时把事件名集中在一个匹配表，未知事件忽略。
- 长 turn 加 3 分钟静默兜底可能误清：一次工具本身超过 3 分钟、且中间没有新的工具 hook 时，绿点仍会变回蓝点。下一次 `PreToolUse` 会再点亮。不要改回「进程活着即绿」；若单条工具经常超过窗口，再调大窗口。
- 用户主目录里的 hook 是全局的。其它途径启动的 Codex / Grok 也会执行这条 command。没有 `REDWHISK_SESSION_ID` 且对不上 `provider_session_id` 时必须无操作，这样额外启动只多一次失败的本机连接。
- 多 RedWhisk 实例若同时听一个 socket，后启动的会失败。listener 绑定失败时应在设置 card 显示「本机状态通道不可用」，而不是安装一个必然丢事件的 hook。
