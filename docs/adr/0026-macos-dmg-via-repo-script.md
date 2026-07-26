# ADR 0026：macOS DMG 由仓库脚本基于 .app 生成

## 状态

采纳（已执行）。

## 背景

RedWhisk 需要在本地与 CI 分发 **Universal** macOS 安装包（同一份同时支持 Apple Silicon 与 Intel）。历史上曾使用 Tauri 原生 `dmg` bundler，后因以下原因从流程中移除：

1. 在较新的 macOS（含 macOS 26 构建环境）上，Tauri/原生路径依赖的 `hdiutil -srcfolder` 等行为出现只读或失败回归，导致 DMG 打包不稳定。
2. 仅产出 `.app` / `.app.zip` 可规避上述问题，但用户缺少「打开 DMG → 拖到应用程序」的常见安装路径。

当前 `src-tauri/tauri.conf.json` 的 `bundle.targets` 仅配置 `app`。需要在不默认启用 Tauri `--bundles dmg` 的前提下，可控地恢复 Universal DMG。

## 决定

1. **Tauri 只负责 `.app`**：`pnpm tauri build --target universal-apple-darwin --bundles app`（或配置中的 `bundle.targets = ["app"]`）产出 Universal `RedWhisk.app`。
2. **DMG 由仓库脚本生成**：`scripts/build-dmg.sh` 基于已生成的 `.app` 创建可写 HFS+ 临时镜像、拷贝 app、添加 `/Applications` 符号链接，再压缩为 UDZO DMG。默认输出：
   - `src-tauri/target/universal-apple-darwin/release/bundle/dmg/RedWhisk_<version>_universal.dmg`
3. **完整包入口统一**：`scripts/build-macos.sh`（`pnpm build:macos`）在构建 `.app` 后调用 `build-dmg.sh`。日常 `pnpm tauri build` 仍可不打 DMG，避免默认路径踩原生 bundler 问题。
4. **分发形态**：GitHub Release 附件同时提供 **DMG** 与现有 **`.app.zip`**；用户侧优先引导 DMG 安装。
5. **签名与公证不在本决策范围**：当前无 Apple 开发者账号配置时，产物为未签名 / 未公证；安装与首次打开说明见 README，不由 DMG 脚本解决 Gatekeeper。

## 后果

- 本地与 CI 可通过 `pnpm build:macos` 稳定得到 `.app` + DMG，不依赖 Tauri 原生 dmg bundler。
- 维护者需同时维护 `build-dmg.sh` 与（可选）挂载验收测试；改 DMG 布局或命名时须同步 README 与 [发布与打包规范](../standards/release-workflow.md)。
- 未来若 Apple / Tauri 原生 dmg 路径在目标构建 macOS 上恢复可靠，可评估切回 bundler，但须以本 ADR 的稳定性前提为回归门禁，不得在不知情下默认改回。
- 未签名限制仍在：Release 与 README 须持续提示右键打开 / 隐私与安全性 / `xattr` 清理 quarantine。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 重新启用 Tauri `--bundles dmg` / `bundle.targets` 含 `dmg` | 在 macOS 26 等环境上曾因 hdiutil 回归失败；会打断日常与 CI 构建 |
| 仅分发 `.app.zip`、不恢复 DMG | 缺少常见拖拽安装体验；与「同时提供 DMG」的产品诉求不符 |
| 第三方 DMG 工具链（如 create-dmg 等）作为硬依赖 | 增加外置依赖与 CI 安装面；仓库脚本仅用系统 `hdiutil` / `diskutil` 即可控 |
| 分架构各打一份 DMG | 违背 Universal 单包目标；增加用户选择成本 |

## 事实来源

- 编排：`scripts/build-macos.sh`、`package.json` 的 `build:macos`
- DMG 生成：`scripts/build-dmg.sh`
- 配置：`src-tauri/tauri.conf.json`（`bundle.targets` 仅 `app`）
- 发布说明：`docs/standards/release-workflow.md`、根目录 `README.md`「安装与首次打开」
- 相关历史决策：应用更新仍走 GitHub Release 外链（[ADR 0004](./0004-app-update-check-via-github-release.md)），与本 ADR 的 DMG 分发互补
