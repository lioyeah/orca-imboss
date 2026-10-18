# Issue 规范（私有分支 UI 问题跟踪）

`scripts/private/issues/` 用来把老板报的每一个 UI 问题变成可复现、可验收、可追踪的 issue。
**不改应用代码**：本目录只做记录与存证；修复由 UI 修复负责人在测试环境里做，改完回这里更新状态。

## 文件与目录约定

- `000-template.md` — 本规范 + 模板，**只读，不要在里面写具体 issue**。
- `NNN-<slug>.md` — 每个 issue 一个文件，编号三位、递增（`001-<slug>.md`），标题即文件名 slug（小写中划线）。
- `evidence/NNN-<slug>/` — 该 issue 的证据目录：截图（`*.png`）、accessibility snapshot（`*.a11y.json`/`*.txt`）、构建/运行日志。
  文件名带序号以保留顺序，例如 `01-before.png`、`02-after.png`。
- 证据文件与 issue 正文一起提交（`git commit --only scripts/private/issues/...`），保证 issue 自包含。

## 状态机

```
open ──▶ verified ──▶ fixing ──▶ fixed-verified ──▶ closed
   │                                                    │
   └────────────── wontfix（附理由）────────────────────┘
```

- `open` — 已收到报告，尚未复现或无法复现（原因写清楚）。
- `verified` — 已在测试环境中稳定复现，截图存证完成，issue 已交给负责人。
- `fixing` — 负责人认领并开始实现。
- `fixed-verified` — 负责人实现完毕，UI 复现管理员在测试环境中复验通过（前后对比证据齐）。
- `closed` — 报告人（老板）确认，或已由上游/其他提交顺带解决（注明 commit）。
- `wontfix` — 结论是不修（设计取舍、上游行为、不可复现等），必须写理由。

## 仓库操作红线（硬规则）

工作树里有老板已暂存的 WIP，因此：

- 只提交自己的文件：`git commit --only scripts/private/issues/<文件>`
- **禁止** `git add -A`、裸 `git commit`、`git stash`、`git checkout`、`git rebase` 会碰到他 WIP 的操作。

## 复现环境红线

- 一切构建/启动都跑在 `scripts/private/run-test-env.sh`（专用 `HOME=~/.imboss-ui-test`，CDP 端口 `9224`）里。
- 老板的运行实例（`/home/ilio/AppImages/imboss.appimage`，数据根 `~/.imboss`，user-data `~/.config/orca-imboss`）是红线：
  不得使用默认 HOME 启动任何构建，不得广谱杀进程（`pkill imboss/orca/electron`），只停自己的 PID / 只清理自己的端口。

## 模板

复制下面整块到 `NNN-<slug>.md`，逐项填写；没有的项写 `N/A` 并说明原因，不要留空。

```markdown
# NNN — <一句话标题：看到什么 + 在哪里>

- 状态：open
- 报告人：<老板 / 其他>
- 负责人：<UI 修复负责人 employee id，或 pending>
- 严重程度：blocker | major | minor | cosmetic
- 组件/区域：<例：nav / list-pane / chat-module / graph view>
- 相关提交：<疑似引入的 commit，若有>

## 环境

- 分支：`mine` @ `<commit>`（`git rev-parse --short HEAD`）
- 构建：`pnpm run build`（electron-vite build，产物 `out/`）
- 启动：`scripts/private/run-test-env.sh`（HOME `~/.imboss-ui-test`，CDP 端口 `9224`）
- 主机/后端：Linux + Wayland（`CUA_DRIVER_RS_ENABLE_WAYLAND=1`）
- 数据状态：<全新数据根 / 已有数据；若需要特定数据说明怎么造的>

## 报告描述

<老板的原话或问题概述，保持原意，不改写范围。>

## 复现步骤

1. <每一步都要可被另一个人照做；涉及点击的写清楚目标元素名，不要只写坐标>
2. …
3. <预期 vs 实际>

## 证据

- 截图：`evidence/NNN-<slug>/01-before.png`（问题状态）
- 截图：`evidence/NNN-<slug>/02-*.png`
- a11y snapshot：`evidence/NNN-<slug>/NN.a11y.txt`
- 日志：`evidence/NNN-<slug>/run.log`

## 根因分析

<若已定位：file:line + 机制说明。若未定位：写「未定位」并列出已排除的可能。>

## 验收标准

- [ ] <可检验的条目，例如「选中行底色使用 --imb-private-tint-current，不再溢出到 wrap 之外」>
- [ ] <回归面：相邻界面/状态未被破坏，列出需要一起看的界面>

## 处理记录

| 日期 | 状态 | 操作人 | 说明 |
| --- | --- | --- | --- |
| YYYY-MM-DD | open | employee 3 | 收到报告，开始复现 |
```

## 复现回路（怎么写「复现步骤」）

1. `scripts/private/run-test-env.sh`（必要时 `--no-build` 复用产物）启动测试实例，记录 PID。
2. cua-driver（Wayland 后端）attach 到窗口：**先 snapshot，再动作**，每个关键状态截图存证。
3. 同一问题至少复现两次都稳定，才写 `verified`；偶发的一律记为「未稳定复现」并记录出现频率与观察到的条件。
4. 环境信息必须写进 issue：分支、commit、构建方式、启动方式——否则修复人无法对齐。
