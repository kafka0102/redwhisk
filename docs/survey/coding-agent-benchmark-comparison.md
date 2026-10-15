# Codex / Claude Code / Grok Build 权威评测对比调研

调研日期：2026-10-15。数据来源分两类，全文严格区分：

- **自报**：厂商自己跑并公布的数字（官方新闻页、System Card）。
- **独立**：第三方机构自行复跑或托管榜单（Artificial Analysis、Vals AI、METR、Epoch AI、Snorkel、Laude Institute）。

凡未找到一手来源的结论，本文直接写「未找到」，不做推测。

---

## 0. 三个产品的口径定义

榜单的评分单位是 **agent = harness + 模型 + 执行设置**，不是模型。三者是产品级对比，必须写明 harness 版本与模型型号。

| 产品 | 厂商 | harness | 当前主推模型（2026-10） |
| --- | --- | --- | --- |
| Codex | OpenAI | Codex CLI / IDE / cloud / 桌面 App | GPT-6.1 Sol、GPT-6 Astra、GPT-6 Luna |
| Claude Code | Anthropic | Claude Code CLI | Opus 5.5、Sonnet 5.5、Fable 5.1、Haiku 5.5 |
| Grok Build | xAI（2026-02 并入 SpaceX） | `grok` 终端 agent（Apache-2.0，2026-07 开源） | Grok 4.7（2026-09-21） |

易混淆项：

- `grok-build-0.1` 是**模型 ID**（2026-05-29 发布），不是 harness。
- Grok Build 早期对外叫 Grok CLI，Epoch AI 归档里 harness 名写作 `Grok CLI` / `grok-cli`。
- 来源：https://x.ai/build 、https://docs.x.ai/build/overview 、https://github.com/xai-org/grok-build 、https://x.ai/news/grok-build-0-1 、https://developers.openai.com/codex/models

---

## 1. 结论速览

1. **质量上限：Claude Code 第一，Codex 紧随，Grok Build 落后一档。** 在现役 Terminal-Bench 4.0 官方榜与独立复跑的 Artificial Analysis Coding Agent Index 上，两者排名一致（Claude Code > Codex > Grok Build）。
2. **综合工程效率：Codex 明显最优。** 独立复跑中 Codex + GPT-6.1 Sol 每题 $1.04 / 15.5 分钟 / 3.2M token，Claude Code + Opus 5.5 是 $13.04 / 64.5 分钟 / 15.6M，Grok Build + Grok 4.7 是 $8.82 / 39.2 分钟 / 14.3M。Codex 以约 1/13 的成本拿到约 92% 的综合分。
3. **任务类型分化明显。** 终端/CI 类任务 Claude Code 领先（TB 4.0：63% vs Codex 55% vs Grok Build 33%）；仓库级修复任务三家接近（DeepSWE v1.1：Codex 73%、Grok Build 73%、Claude Code 68%）；长时程自主性按 METR 是 Anthropic 领先（Opus 4.6 约 12 小时 vs GPT-5.3-Codex 约 5.8 小时）。
4. **Grok 模型在 Grok Build 上是否优于在 Codex 上：未找到一手数据，无法判定。** 逐榜排查 tbench.ai、Epoch AI、Vals AI、swebench.com、Artificial Analysis 后确认：**Grok 模型从未与 Codex harness 组合上报过**。相邻证据见 §6。

---

## 2. Terminal-Bench 4.0（现役版本，官方榜 + 独立复跑）

### 2.1 官方榜（tbench.ai，Laude Institute 托管，提交制）

| 排名 | 模型（档位） | Agent（harness） | 分数 | 评测日期 | 全量 tokens | 全量成本 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Opus 5.5 (max) | Claude Code | 64.85% ±3.1 | 2026-09-22 | 8.0B | $4.7k |
| 2 | Sonnet 5.5 (max) | Claude Code | 61.82% ±2.9 | 2026-09-28 | 19.4B | $7.3k |
| 3 | GPT-6 Astra (max) | Codex | 58.18% ±2.8 | 2026-09-03 | 1.5B | $3.3k |
| 3 | GPT-6.1 Sol (max) | Codex | 58.18% ±3.1 | 2026-09-29 | 1.5B | $0.6k |
| 5 | Fable 5.1 (max) | Claude Code | 57.88% ±3.8 | 2026-09-01 | 2.7B | $6.2k |
| 6 | Opus 5 (xhigh) | Claude Code | 53.94% ±3.2 | 2026-07-24 | 6.9B | $6.1k |
| 7 | GPT-6 Sol (max) | Codex | 49.39% ±3.2 | 2026-09-22 | 5.0B | $1.5k |
| 10 | **Grok 4.7 (xhigh)** | **Grok Build** | **37.58% ±3.5** | 2026-09-21 | 5.5B | $3.7k |
| 16 | Grok 4.6 (high) | Grok Build | 20.30% ±3.1 | 2026-08-12 | 4.0B | $3.6k |
| 21 | Grok 4.5 (high) | Grok Build | 12.42% ±2.6 | 2026-07-16 | 3.4B | $2.1k |

来源：https://www.tbench.ai/leaderboard （抓取 2026-10-15；`/leaderboard/terminal-bench/2.0` 与 `/terminal-bench/4.0` 均渲染同一份现役视图，版本经 Snorkel 镜像 https://snorkel.ai/leaderboard/terminal-bench-4-0/ 确认为 4.0，66 题）

**可交叉验证**：xAI 自报的 Grok 4.7 Terminal-Bench 4.0 = 37.6%、Grok 4.6 = 20.3%，与榜单 37.58% / 20.30% 吻合，说明 Grok Build 的数字不是虚高。
来源：https://x.ai/news/grok-4-7 （自报，2026-09-21）

**厂商自报 vs 独立复跑的典型落差**：Anthropic 自报 Opus 5.5 = 66.36%（Claude Code `--bare`、xhigh、5 trials/题），官方榜为 64.85%（max 档）；OpenAI 自报 GPT-6 Astra = 57.9%，榜单为 58.18%。这些属噪声内。真正的大落差在 harness 不同的场合，见 §6.2。
来源：https://www-cdn.anthropic.com/fc1b44717c85dc068bc6ba5024219938094694bd/Claude%20Opus%205.5%20System%20Card.pdf （第 177–178 页）、https://openai.com/index/gpt-6-astra/

### 2.2 版本不可比警告

Terminal-Bench 迭代很快，同一模型跨版本分数不连续：GPT-5.6 Sol 在 2.1 上 88.8%（自报），在 4.0 上 37.3%。引用时必须写版本。
版本线：1.0（2025-05，80 题）→ 2.0（2025-11，89 题）→ 2.1（2026-05，修订 28 题）→ 3.0（2026-07，74 题）→ 4.0（2026-08，66 题）。
来源：https://www.tbench.ai/news 、https://snorkel.ai/leaderboard/terminal-bench-3-0/ 、https://snorkel.ai/leaderboard/terminal-bench-4-0/

---

## 3. Artificial Analysis Coding Agent Index v1.5（最能直接对比三家产品）

独立复跑，Index = DeepSWE v1.1（113 题，Datacurve）+ Terminal-Bench 4.0（66 题，Laude）+ SWE-Atlas-QnA（124 题，Scale）三等权，每项 pass@1 取 3 次尝试平均。评测时间 2026-10。

| Agent（harness） | 模型（档位） | Index | DeepSWE v1.1 | TB 4.0 | SWE-Atlas-QnA | 每任务成本 | 每任务耗时 | tokens/任务 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | Sonnet 5.5 (max) | **68.4** | 72% | 66% | 67% | $14.19 | 87.4 min | 27.7M |
| Claude Code | Opus 5.5 (max) | 66.0 | 68% | 63% | 66% | $13.04 | 64.5 min | 15.6M |
| Codex | GPT-6.1 Sol (xhigh) | **62.9** | 73% | 55% | 61% | **$1.04** | **15.5 min** | **3.2M** |
| Codex | GPT-6 Astra (max) | 61.7 | 68% | 56% | 62% | $7.47 | 29.4 min | 3.3M |
| Claude Code | Opus 5 (max) | 59.7 | 63% | 55% | 62% | $10.79 | 41.9 min | — |
| **Grok Build** | **Grok 4.7 (xhigh)** | **56.3** | **73%** | **33%** | 63% | $8.82 | 39.2 min | 14.3M |
| Codex | GPT-6 Sol (max) | 56.7 | 69% | 43% | 58% | $2.99 | 22.3 min | 9.8M |
| Codex | DeepSeek V4 Pro 0813 (max) | 43.1 | 57% | 10% | 62% | $0.24 | 40.3 min | 24.2M |
| Grok Build | Grok 4.6 (xhigh) | 47.0 | 65% | 18% | 58% | $3.57 | 19.5 min | 5.5M |

来源：https://artificialanalysis.ai/agents/coding-agents （抓取 2026-10-15）

要点：

- AA 官方文章的表述是「Among models in their native harnesses, Grok 4.7 + Grok Build now ranks 4th, behind only Claude Fable 5.1, GPT-6 Astra, and Claude Opus 5」——即**按各自原生 harness 排名，Grok Build 处在第二梯队前列**。
- Codex 在 DeepSWE（仓库级修复）上以 1/13 成本与 Claude Code 顶配同档；在终端任务上落后约 11pp。
- Grok Build 的短板非常集中：终端任务 33% vs Claude Code 66%。
- AA 页面上的 **Harness Comparison 区块状态为 "Coming soon"**，即 AA 自己还没发布同模型跨 harness 的对照数据。
- 来源：https://artificialanalysis.ai/articles/benchmarking-grok-4-7 （2026-09-21）

---

## 4. SWE-bench 系列

### 4.1 SWE-bench Verified（已饱和，2026 年逐步停更）

Anthropic 自报 Opus 4.5 = 80.9%（2025-11-24）、Opus 4.7 = 87.6%（2026-04-16）；OpenAI 自报 GPT-5.1-Codex-Max = 77.9%（n=500，2025-11-17），此后两家都改报 SWE-bench Pro。
第三方独立复跑（Vals AI，Mini-SWE-agent harness，已归档）：Claude Opus 5 = 97.00%、DeepSeek V4 Pro = 96.40%、GPT-5.6 Sol = 96.20%、**Grok 4.6 = 95.60%**、Grok 4.5 = 86.60%。
swebench.com 官方榜**完全没有 Grok 条目**（180 条记录，最后更新 2026-02-17）。

**当心误传**：流传的「Grok Build 在 SWE-bench Verified 得 70.8%」是误挂。70.8% 属于 `grok-code-fast-1`，原文是「using our own internal harness」，与 Grok Build 无关。
来源：https://www.vals.ai/benchmarks/swebench 、https://www.anthropic.com/news/claude-opus-4-7 、https://openai.com/index/gpt-5-1-codex-max/ 、https://www.swebench.com/ 、https://x.ai/news/grok-code-fast-1

### 4.2 SWE-bench Pro（当前区分度更高的替代项）

- Anthropic 自报（Opus 5.5 System Card，2026-09-22，5 trials 平均）：Opus 5.5 **89.9%**、Fable 5.1 81.2%、Opus 5 79.2%。
- OpenAI 自报（GPT-5.6 发布页，2026-07-09）：GPT-5.6 Sol 64.6%、Terra 63.4%、Luna 62.7%。
- 同一基准下 Scale AI 统一 scaffold 的 GPT-5 只有 23.3%（原论文口径）——**划分与 scaffold 必须写明，否则数字不可比**。
来源：https://www-cdn.anthropic.com/fc1b44717c85dc068bc6ba5024219938094694bd/Claude%20Opus%205.5%20System%20Card.pdf 、https://openai.com/index/gpt-5-6/ 、https://scale.com/leaderboard/swe_bench_pro_public

### 4.3 SWE-Lancer

只有 GPT 系与 Claude 3.5 Sonnet 的一手数字（Claude 3.5 Sonnet IC Diamond 26.2%，2025-02）。没有 Grok 数据，也没有 Claude 4.x/5.x 的新版复跑。
来源：https://arxiv.org/pdf/2502.12115 、https://openai.com/index/swe-lancer/

---

## 5. 长时程自主性与「跑分 ≠ 可合并」

### 5.1 METR 时间视界（独立，50% 视界 = 一半任务能做完的人类专家耗时尺度）

| 模型 | 50% 时间视界 | 95% CI | 发布日期 |
| --- | --- | --- | --- |
| Claude Opus 4.6 | 718.8 min（约 12 h） | [316.7, 3633.8] | 2026-02-05 |
| Claude Opus 4.5 | 293.0 min | [161.7, 623.7] | 2025-11-24 |
| GPT-5.3-Codex | 349.5 min | [194.9, 816.4] | 2026-02-05 |
| GPT-5.4 | 341.7 min | [186.6, 768.8] | 2026-03-05 |
| GPT-5.1-Codex-Max | 223.7 min | [134.3, 396.2] | 2025-11-19 |
| Gemini 3 Pro | 224.3 min | [139.6, 379.2] | 2025-11-18 |

来源：https://metr.org/assets/benchmark_results_1_1.yaml 、https://metr.org/time-horizons/
注：数据集未含 Opus 5.5 / Fable 5.1 / Grok 4.7；METR 自述 >16 h 的测量不可靠。

### 5.2 harness 对长时程有没有增益？METR 的结论是否定的（关键反直觉证据）

METR 直接对照（2026-02-13）：Claude Code 与 Codex 在其时间视界指标上**未显著优于** METR 自研 scaffold（ReAct / Triframe）——Opus 4.5 + Claude Code 仅在 50.7% 的 bootstrap 样本中优于 ReAct，GPT-5 + Codex 仅在 14.5% 样本中优于 Triframe；把 token 预算放大 4 倍后结论不变。
来源：https://metr.org/notes/2026-02-13-measuring-time-horizon-using-claude-code-and-codex/

### 5.3 跑分通过 ≠ 可合并（独立）

METR 让 4 名在职维护者评审 296 个 AI 生成 PR：维护者合并决定平均比自动评分低 **24.2 个百分点**（SE 2.7，按 golden baseline 归一化）。即基准分数会系统性高估真实可用性。
来源：https://metr.org/notes/2026-03-10-many-swe-bench-passing-prs-would-not-be-merged-into-main/

---

## 6. 核心问题：Grok 模型在 Grok Build 上是否优于在 Codex 上？

### 6.1 直接答案：未找到一手数据，无法判定

逐榜核对结果（抓取日 2026-10-15）：

| 来源 | 有 Grok 条目 | Grok 用的 harness | 有 Grok + Codex 吗 |
| --- | --- | --- | --- |
| tbench.ai Terminal-Bench 4.0 官方榜 | 有（4.5/4.6/4.7） | 全部 Grok Build | **无** |
| Epoch AI Terminal-Bench 归档（204 行 model×agent） | 有（grok-4.20、grok-4-0709、grok-code-fast-1） | Grok CLI / OpenHands / Mini-SWE-Agent / Terminus 2 | **无**（`Codex CLI` 的 14 行全是 OpenAI 模型） |
| Vals AI SWE-bench Verified（88 systems，带 Harness 列） | 有（7 个 Grok 型号） | 全部 Mini-SWE-agent | **无** |
| swebench.com 官方 Verified 榜 | **无任何 Grok** | — | **无** |
| Artificial Analysis Coding Agent Index | 有（4.6 / 4.7） | 全部 Grok Build | **无**（Codex 行出现第三方模型 DeepSeek，但没有 Grok） |
| xAI 官方新闻页（Grok 4.5/4.6/4.7、Grok Build 发布） | 有 | 未逐项标注 harness | **无** |

即：**没有任何公开权威评测把同一个 Grok 模型放进 Codex harness 跑过**。因此「Grok Build 上更好还是 Codex 上更好」这个问题当前无公开答案。

### 6.2 相邻证据一：同模型换 harness 确实会改分，且原生 harness 未必更好

- Epoch AI 归档（Terminal-Bench 2.0）中，同一模型跨 harness 的分差可达十几点：`claude-opus-4-6` 在 Claude Code 57.98%、Terminus 2 62.92%、Droid 69.9%、ForgeCode 79.8%。
- **反向案例（关键）**：Vals AI 的 Terminal-Bench 2.1 榜上，GPT-5.5 在 Terminus 2 harness 下 76.40%，在 **Codex harness 下只有 57.30%**（榜第 44 名，每题 $0.65、3m22s）。同一模型，**自家 harness 反而低了约 19pp**。
- 库级分析（BenchLM）给出的对照是：固定 Opus 4.7 时 harness 排序为 Opencode 65 > Cursor CLI 60 > Claude Code 57，harness 单独就能挪动 8 分。

来源：https://epoch.ai/data/external_benchmarks/terminalbench.csv 、https://www.vals.ai/benchmarks/terminal-bench-2-1 、https://benchlm.ai/blog/posts/ai-coding-agents

### 6.3 相邻证据二：Grok 旗舰对 harness 并不敏感（最有参考价值的 A/B）

独立基准 akitaonrails/llm-coding-benchmark v2 做了同模型跨 harness 的受控 A/B（同一个 Rails/RubyLLM 生产化任务）：

| 模型 | opencode harness | 自家 grok CLI harness | Δ | 结论 |
| --- | --- | --- | --- | --- |
| Grok 4.5 | 92 | 91 | −1 | 噪声内，无 harness 效应 |
| Grok 4.6 | 92 | 93 | +1 | 噪声内，无 harness 效应 |
| Grok 4.3 | 18（两次 48 秒空转退出） | 55 | **+37** | 原生 harness 救回了 scaffold 依赖型模型 |

作者结论原文：「**the grok CLI is neutral for the Grok 4.x line** — it neither scaffolds nor breaks these models」。同时该基准测得 harness 效应的最大值：同一模型换 scaffolding 可差 **+69 / −39 分**（MiniMax M3、Gemini 3.1 Pro）。
来源：https://github.com/akitaonrails/llm-coding-benchmark/blob/master/docs/success_report.v2.md （2026-07-30 完成，2026-08 更正）

### 6.4 相邻证据三：厂商侧的「原生适配」主张

xAI 官方称 Grok 4.7「was trained to natively understand the Grok Bot harness, making it better at conversational tasks and general knowledge work」——即厂商主张模型针对自家 harness 做了定向训练。但这是**定性主张，未给出 harness 对照数字**。
来源：https://x.ai/news/grok-4-7 （自报，2026-09-21）

### 6.5 技术上可跑，但没人公开跑分

Codex CLI 支持自定义 provider（`model_provider` + `model_providers.<id>.base_url` / `wire_api`），Grok Build 也支持自定义模型（`~/.grok/config.toml` 的 `[model.xxx]`，官方文档："Grok supports any custom model"）。AA 也确实把 DeepSeek 跑在 Codex harness 上。所以「Grok in Codex」不是做不做得到的问题，而是**当前无人公开发布结果**。
来源：https://developers.openai.com/codex/config-file/config-advanced 、https://docs.x.ai/build/overview

### 6.6 可以确定与不能确定的部分

可以确定（不同模型 + 各自原生 harness，独立数据）：

| 组合 | AA Index | TB 4.0 | DeepSWE v1.1 | 每题成本 |
| --- | --- | --- | --- | --- |
| Codex + GPT-6.1 Sol (xhigh) | 63 | 55% | 73% | $1.04 |
| Grok Build + Grok 4.7 (xhigh) | 56 | 33% | 73% | $8.82 |

不能确定：**同一个 Grok 模型在 Grok Build 与在 Codex harness 上的相对高低**。现有最接近的证据（§6.3 的受控 A/B）指向「Grok 4.5/4.6 这类旗舰在两套 harness 上成绩基本持平」，但这不等于「与 Codex harness 持平」，更不支持「Grok Build 一定更优」的说法。若需要结论，唯一可靠路径是自行做同模型跨 harness 的 A/B。

---

## 7. 三方对比总表（各原生 harness，独立或托管榜单）

| 维度 | Codex | Claude Code | Grok Build | 数据来源 |
| --- | --- | --- | --- | --- |
| Terminal-Bench 4.0（现役） | 58.18%（GPT-6.1 Sol max） | **64.85%**（Opus 5.5 max） | 37.58%（Grok 4.7 xhigh） | tbench.ai 官方榜 |
| AA Coding Agent Index v1.5 | 62.9（GPT-6.1 Sol xhigh） | **68.4**（Sonnet 5.5 max） | 56.3（Grok 4.7 xhigh） | Artificial Analysis |
| DeepSWE v1.1（仓库级） | **73%** | 68%（Opus 5.5）/ 72%（Sonnet 5.5） | 73% | Artificial Analysis |
| SWE-Atlas-QnA（技术问答） | 61% | **67%** | 63% | Artificial Analysis |
| 每题成本 | **$1.04** | $13–14 | $8.82 | Artificial Analysis |
| 每题耗时 | **15.5 min** | 64–87 min | 39.2 min | Artificial Analysis |
| 长时程（METR 50% 视界） | GPT-5.3-Codex 349 min | **Opus 4.6 719 min** | 未测 | METR |

同一维度上的独立复跑常有小幅分歧（例：TB 4.0 的 Opus 5.5，Anthropic 自报 66.36%、官方榜 64.85%、Vals AI 65.15%、AA 59.6%），引用时建议并列区间而非单点。

---

## 8. 引用该领域数字的三条硬约束

1. **版本写全**：Terminal-Bench 2.0 / 2.1 / 3.0 / 4.0 之间不可比（同一 GPT-5.6 Sol：88.8% / 34.6% / 37.3%）；SWE-bench 要区分 Verified / Pro，以及统一 scaffold 与厂商 harness。
2. **harness 写全**：评分单位是 agent + 模型 + 执行设置。已核验 harness：Codex、Claude Code、Grok Build / Grok CLI、Terminus 2、mini-SWE-agent、OpenHands、Droid、ForgeCode、Cursor CLI、METR default scaffold。
3. **自报与独立分开**：厂商页面均为自报；Vals AI、Artificial Analysis、METR、Snorkel、Epoch AI 为独立。已知落差最大的两处：GPT-5.3-Codex 在 Terminal-Bench 2.0 自报 77.3% vs Vals AI Terminus 2 harness 独立复跑 64.05%；Opus 4.7 SWE-bench Verified 自报 87.6% vs Vals AI 独立 82.00%。

---

## 9. 未找到一手来源的项（不得据此下结论）

1. 任何「Grok 模型 + Codex CLI / Codex harness」的基准数字（TB 2.0/3.0/4.0、SWE-bench Verified/Pro、AA Index、Epoch、Vals 全部覆盖检查过，均为空）。
2. SWE-Lancer 上任何 Grok 数据；Claude 4.x/5.x 的 SWE-Lancer 复跑。
3. Terminal-Bench 2.0 / 3.0 的官方历史榜快照（tbench 现仅挂 4.0）。
4. Epoch AI 对 Codex / Claude Code / Grok 的 SWE-bench Verified 逐项分数（页面为图表渲染，未取到文本值）。
5. Artificial Analysis 的 Harness Comparison 区块（状态 "Coming soon"）。
6. Grok Build 官方自报的 agentic benchmark 数字（发布页与文档均无基准数据）。
