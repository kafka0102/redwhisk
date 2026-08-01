# TUI / 终端渲染架构

> 适用范围：项目终端（`src/features/terminals`）与 Agent Session **tui** 展示形式共用的 PTY → xterm 渲染链路。  
> 相关契约：`docs/architecture-design/agent-provider-protocol.md`、`docs/architecture-design/tauri-contract.md`。  
> 竞品对照样本：Orca（`coding-tool-analysis/docs/analyses/orca`，以及本机 `Orca.app` asar 中的 shared 模块）。

## 1. 问题陈述

用户在 Codex TUI（以及项目终端中启动的同类交互式 TUI）中经常看到：

1. **历史输出无法上滚 / 只剩最近一屏**；过一会或再次刷新后又能滚。
2. **底部输入框、状态行短暂乱码**（半截颜色码、错位边框），随后被完整重绘“治好”。

这两类症状都来自 **TUI 的屏幕模型** 与 **我们的日志回放模型** 之间的错位，而不是单纯“xterm 坏了”。

## 2. 数据路径（RedWhisk）

```
Agent/Shell 子进程
  └─ portable-pty (src-tauri/src/agent/pty_session_manager.rs)
       ├─ 追加写磁盘 log（runtime session-logs / project-terminal-logs）
       ├─ 内存 restore ring（约 1 MiB，仅供 sequence 对齐）
       └─ 可见订阅时 emit `agent-session-terminal-output` / project terminal output
            └─ TerminalLivePipeline (src/features/terminals/terminal-live-pipeline.ts)
                 ├─ catchingUp：readSnapshot(tail) → writeTerminalHistory
                 └─ live：rAF 合并 write → xterm.js (@xterm/xterm 6)
```

前端入口统一为 `TerminalSurface`（项目终端与 Agent TUI 会话共用）。

关键常量：

| 位置 | 常量 | 含义 |
| --- | --- | --- |
| `pty_session_manager.rs` | `LOG_MAX_BYTES` = 32 MiB | 磁盘 log 上限 |
| `pty_session_manager.rs` | `RESTORE_BUFFER_MAX_BYTES` = 1 MiB | 内存 ring，只服务 sequence / 极短热恢复 |
| `terminal-live-pipeline.ts` | `TERMINAL_HISTORY_MAX_BYTES` = 2 MiB | 可见时从磁盘 tail 回放的上限 |
| `Terminal` options | `scrollback: 10_000` | xterm 行缓冲 |
| `Terminal` options | `scrollOnEraseInDisplay: true` | `CSI 2J` 时尽量保留 scrollback |

## 3. Codex / 现代 TUI 实际画屏方式

以本仓库诊断样本  
`~/.redwhisk/session-logs/runtime/project-2/issue-228-profile-6-1784597512955.log` 为例（约 5.4 MiB raw ANSI）：

| 序列 | 次数级 | 含义 |
| --- | ---: | --- |
| `CSI H`（CUP） | ~2e5 | 绝对光标定位，原地重绘 |
| `CSI K`（EL） | ~1.7e5 | 擦行尾 |
| `CSI r`（DECSTBM） | ~3e2 | **滚动区域**，分区刷新 header/body/footer |
| `CSI ?2026 h/l` | ~2e4 | synchronized update（原子帧） |
| `ESC M`（RI） | ~3e2 | 反向索引，在区域内“上推” |
| `CSI ?1049 h/l` | **0** | **未使用 alternate screen** |

结论：

- Codex TUI **不**靠 alternate buffer 做全屏；它在 **normal buffer** 上用 **CUP + 滚动区域 + 擦行** 做 in-place 重绘。
- 因此“能滚动的历史”并不是应用主动写入 scrollback 的结果，而是：
  - 早期 **line-mode** 输出（启动横幅、shell）自然滚上去的行；
  - 以及 xterm 对 `CSI 2J` 等在 `scrollOnEraseInDisplay` 下的保留行为。
- 一旦 TUI 进入稳态 in-place 刷新，**viewport 内的旧行会被覆盖**；`baseY` 可能长时间不变或只缓慢增长。这与用户感知的“刚才那几屏过程没了”一致，并不总是我们的 bug。

已用 headless `@xterm/headless@6` 回放该 log 验证：在 80×24 / 120×32 / 160×44 等尺寸下，完整流解析后 `buffer.type === "normal"` 且最终 `baseY > 0`、composer 行可读。  
**稳态 xterm 解析本身可正确渲染**；乱码与“丢历史”的高发点在 **回放截断** 与 **尺寸/可见性** 路径。

## 4. 根因分解

### 4.1 高优先级：日志 tail 切在 CSI/UTF-8 中间（已修）

`read_terminal_snapshot` / `trim_log_file` 曾使用：

```text
start = len - max_bytes
```

TUI 日志几乎没有“按行文本”，`max_bytes` 经常落在：

- `ESC [ 38;2;231;…` 参数中间  
- 或多字节 UTF-8 中部  

后果：

1. catch-up 写入 xterm 时，半截 CSI 被当成普通字符 → **底部输入框/边框乱码**；
2. 随后 live 帧带来完整 `CSI H` + 重绘 → **看起来又好了**；
3. 用户描述与样本完全吻合：“过一会又好了”。

修复：

- 新模块 `src-tauri/src/agent/terminal_log_tail.rs`
- `safe_terminal_log_tail_start`：UTF-8 对齐 + 未闭合 ESC 序列回退/跳过
- `read_terminal_snapshot`、`trim_log_file`、超大 restore chunk 截断均走该路径

### 4.2 WebGL 字形纹理损坏（画面乱码、复制正常）

用户症状：

- 长 Codex / SSH 远程 TUI 或静态 `cat` 中文后，**偶发**正文花字、缺字；
- **鼠标划过 / 框选后局部恢复，复制内容正常**（xterm buffer 内码点正确）；
- **同一项目下其它终端 tab 跟着一起花屏**；切 tab 回来又可能再花；
- headless / 纯 buffer 回放同一份 log **无** `U+FFFD`、中文可读。

这与「半截 CSI 写进 buffer」不同：后者复制也会脏。根因有两层：

1. **WebGL texture atlas 损坏**（GPU / 休眠 / `display:none` 后纹理失效）；xterm 文档用 `Terminal.clearTextureAtlas()` 自愈。
2. **`@xterm/addon-webgl` 的 `CharAtlasCache` 按字体/主题/DPR 跨 Terminal 共享同一 atlas**。项目终端与 Session 终端 Activity 均为 keep-alive + `hidden` 切换，若隐藏实例仍挂着 WebGL，任一实例清 atlas 或 GPU 写坏页，**同配置的所有终端一起花屏**——这就是「一个乱、全家乱」的机制。

修复（当前）：

- **仅 layout + 文档可见时挂载 WebGL**（`terminal-webgl-session.setActive`）；隐藏 / 切走 / 休眠时 dispose addon，回退 canvas，**退出共享 atlas**。
- 休眠恢复：`recreate()` 整实例重建 WebGL，而不仅 `clearTextureAtlas`。
- `healTerminalViewport`：`clearTextureAtlas` + `refresh`；history 写完 / live ready / 累计 live 约 512 KiB / `pointerenter` 时调用。
- context loss 后仅在仍 active 时有限次重建；耗尽则留在 canvas。

### 4.3 产品层：in-place 刷新本身不产生 scrollback


短 shell 后立刻进入 TUI 时，`baseY === 0`，CUP 首页重绘会覆盖当前屏（测试已锁定：`terminal-scrollback-sequences.test.ts`）。  
**这是协议语义，不是渲染崩溃。** 系统不伪造 pure in-place 被覆盖内容为可滚聊天历史。

已拆除原先顶部 in-place「无法上滚」提示链路（CUP 追踪 / statusSource `inplace` / i18n 文案）：提示存在误报与漏报，干扰判断。  
可修路径聚焦 host 可靠性，而非 UI 文案掩盖。

这不是解析错误，而是 **TUI 协议语义**。要“永远能上滚看过程”，需要 **应用层历史**（见 §6），不能只靠 xterm buffer。

### 4.4 尺寸与可见性

- 初始 spawn 默认 `rows=32, cols=120`，真实尺寸靠 `FitAddon` + `resize` 纠正。
- 隐藏 pane（`display:none` / 0×0）时 **禁止 fit**，否则会出现 `cols=2/rows=1` 的 SIGWINCH 风暴（`terminal-surface.tsx` 已处理）。
- 尺寸长期不一致会导致 DECSTBM 区域与真实 rows 错位 → 边框/输入行错位；下一次正确 resize 重绘后恢复。

### 4.5 历史上限

catch-up 只回放 tail（现 2 MiB）。超长 session 更早的过程在磁盘可能仍在（log 上限 32 MiB），但 UI 不会一次灌入全部。  
Orca 也明确区分：

- daemon/local history 为权威冷恢复来源；
- renderer 捕获的 `buffersByLeafId` 只在 remote/runtime 场景保留；
- serialize 快照与 raw PTY backlog 是两条线。

## 5. Orca 对照（可借鉴点）

来源：Orca asar `out/shared/*` 与竞品分析文档。

| 能力 | Orca | RedWhisk 现状 | 建议 |
| --- | --- | --- | --- |
| 渲染 | `@xterm/xterm` + webgl/fit/serialize | 同栈（clipboard/fit/webgl，无 serialize） | 保持；serialize 仅在需要“状态快照”时引入 |
| scrollback 策略 | 行数预设 5k–50k + backlog 按行扩 cap | 固定 10k 行 + 字节 tail | 可配置化（非必须） |
| 恢复 | `SerializeAddon` + **绝对光标** 修正 + alt/normal 分路径 | 磁盘 raw log 回放 + sequence 对齐 | 对 TUI 长期运行，raw log 是正确主路径；serialize 可作加速缓存 |
| 截断 | UTF-8 byte clamp 工具 | 现已有 ESC/UTF-8 安全 tail | 保持单测锁住 |
| 零尺寸 | 显式 diagnostic 文案 | 静默 skip fit | 可观测性可补 |
| 状态检测 | OSC/title/hook 双轨 | 产品状态以进程存活为主 | 另文；勿与 scrollback 混修 |

Orca **没有魔法让 in-place TUI 自动变成可滚动聊天记录**。它同样 host 黑盒 TUI；优势在 snapshot 工程化（serialize 绝对光标、alt 屏区分、backlog cap 与 scrollback 联动）。

## 6. 修复策略分层

### P0（本次）

1. **安全 tail 截断**（防乱码）— 已实现。  
2. **文档化机制** — 本文。  
3. **回归测试** — `terminal_log_tail` 单测 + 既有 `terminal-scrollback-sequences` 锁定 in-place 语义。  
4. **拆除误导性 in-place 顶部提示** — 已实现；不以提示掩盖协议边界。  
5. **mouse reporting 下 Shift+滚轮访问 scrollback** — 已实现（`terminal-shift-wheel-scroll.ts`）。

### P1（推荐后续）

1. **resize 稳定化**：spawn 前尽量用上次窗口尺寸；首帧 fit 完成前延迟注入 prompt（降低 DECSTBM 错位窗口）。  
2. **catch-up 与 live 的“半帧”对齐**：若 tail 起点不是 synchronized update 边界，可向前扩到最近的 `CSI ?2026 h`（进一步减少首帧花屏）。  
3. **可见性/订阅**：保持“隐藏不 fit、隐藏不写 xterm”；**sequence 未变时跳过 rewrite**（已实现，见 `TerminalLivePipeline.becomeVisible`），仅在隐藏期间有新输出时整段 catch-up。终端 Activity 与终端卡片均常驻挂载 + `hidden` 切换，避免切 Tab 卸载 xterm。  
4. **WebGL 仅可见挂载 + 纹理自愈**：hidden 终端卸 WebGL 避免共享 atlas 串扰；history / re-visible / pointerenter / 长会话累计输出 heal；休眠恢复 `recreate`；context loss 有限次重建（已实现）。

### P2（产品增强，非 bugfix）

1. **会话过程侧栏**：从 log 解析纯文本/工具事件做“可滚动 transcript”，与 TUI canvas 并列（structured 路径已有 message stream；TUI 路径需只读观测）。  
2. **Serialize 快照缓存**：周期性 `SerializeAddon` 存盘，冷启动先灌 snapshot 再追 raw delta（对齐 Orca），降低超大 log 回放成本。  
3. **用户可配 scrollback 行数 / history 字节**。

## 7. 诊断清单（以后再出现时）

1. 取 runtime log：`~/.redwhisk/session-logs/runtime/.../*.log`。  
2. 统计序列：`CSI H` / `CSI r` / `?1049` / `?2026` 次数；若 `?1049=0` 且 `CUP` 极高 → in-place normal buffer。  
3. 用 `@xterm/headless` 或 jsdom xterm 整文件回放：若 buffer 正常（复制也正常）而 UI 花屏 → 查 **WebGL atlas / context loss / 休眠后未 heal**；若 buffer 也脏 → 查 **截断 / resize / 双写 / restore suppress**。  
4. 查 catch-up `max_bytes` 起点是否落在 `ESC` 参数中（`safe_terminal_log_tail_start` 应保证不会）。  
5. 查隐藏 tab 是否触发了 0×0 fit（应被 `offsetWidth/Height === 0` 挡住）。  
6. 区分：  
   - **乱码后自愈** → 半截 CSI / 尺寸瞬态；  
   - **永远滚不动且 baseY=0** → in-place 协议语义（不伪造历史），不是截断 bug。  
   - **baseY>0 但滚轮无效** → 检查是否 mouse reporting 吞滚轮；Shift+滚轮应能滚动 buffer。

## 8. 相关代码索引

| 主题 | 路径 |
| --- | --- |
| xterm 宿主 | `src/features/terminals/terminal-surface.tsx` |
| live 状态机 | `src/features/terminals/terminal-live-pipeline.ts` |
| 历史写入 / 滚动位置 | `src/features/terminals/terminal-history-writer.ts` |
| Shift+滚轮 scrollback | `src/features/terminals/terminal-shift-wheel-scroll.ts` |
| 序列行为锁定 | `src/features/terminals/terminal-scrollback-sequences.test.ts` |
| PTY / log | `src-tauri/src/agent/pty_session_manager.rs` |
| 安全 tail | `src-tauri/src/agent/terminal_log_tail.rs` |
| Agent TUI command | `src-tauri/src/features/agent_session/tui_terminal.rs` |
| Project terminal | `src-tauri/src/features/project_terminal/service.rs` |

## 9. 验收标准

- 长 Codex TUI session：catch-up 后底部 composer **无半截 CSI 乱码**。
- 长 session 偶发「画面花字但复制正常」：hide/show 后仅可见终端挂 WebGL，不应再拖累其它 tab；休眠恢复 `recreate` 或 pointerenter heal 后画面恢复；headless 回放同 log 不应出现 `U+FFFD`。  
- 同一 log 连续切 tab 隐藏/显示：不应因 0×0 fit 丢最后一行。  
- `cargo test terminal_log_tail` / `pnpm test` 中 scrollback 相关用例通过。  
- 对“过程滚不到”：若 `baseY=0` 且为 pure in-place CUP 覆盖，属协议边界（无提示、不伪造历史）；若 `baseY>0` 的已有 scrollback，用户应能上滚（含 TUI 开启 mouse reporting 时用 Shift+滚轮访问 buffer）。
- 运行时不再出现 in-place「无法上滚」顶部提示。
