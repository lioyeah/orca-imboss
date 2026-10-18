# 001 · 图谱画布只占内容区一小块（常规尺寸与最大化一致）

- **状态**: `verified`（已复现，等待修复）
- **报告人**: Boss（chat 10）
- **负责人**: UI 修复负责人（@4）
- **严重程度**: 高（核心视图不可用）
- **组件/区域**: 图谱模块（Knowledge Graph）+ 应用外壳网格布局
- **相关提交**: `040ae10`（引入）／当前 `mine` HEAD `3da025f`（已被 WIP 顺带修复）
- **环境**:
  - 分支 `mine`，复现基准 `040ae10`（= Boss AppImage 的源码状态）
  - 构建：`git archive 040ae10` → 独立目录 `/tmp/repro` → `pnpm run build`（typecheck + electron-vite build 全绿）
  - 启动：`HOME=/home/ilio/.imboss-repro-040ae10`、`--remote-debugging-port=9226`、`--no-sandbox --ozone-platform=wayland`
  - 视口 1262×1030（与 Boss 报告截图同尺寸）
  - 宿主：Wayland（`WAYLAND_DISPLAY=wayland-1`）
  - 数据状态：独立 HOME，首次运行（图谱仅 1 节点 / 0 连线，与 Boss 报告时数据量无关——缺陷与节点数无关）

## 报告描述

Boss 报告：进入「图谱」后，图谱画布只占内容区一小块，把窗口拉大 / 最大化都没有变化，右侧大片空白。
Boss 报告截图：`/home/ilio/.imboss/attachments/10/pasted-20261018-110721.png`（只读证据，1273×1032）。

像素取证（该截图，PIL 逐列扫描）：
- 导航栏 → 内容区的分界在 **x=221**；
- 内容面板底色（surface）连续区间 **221…530**，宽度 **正好 310px**；
- x≈534 起直到 x=1267 是应用背景色（空的 `1fr` 列），即约 740px 被浪费。

## 复现步骤

1. 以 `040ae10` 为基准构建（`git archive 040ae10 | tar -x -C /tmp/repro/`，`pnpm run build`）。
2. 用独立 HOME 启动：`HOME=/home/ilio/.imboss-repro-040ae10` + `--remote-debugging-port=9226 --no-sandbox --ozone-platform=wayland`。
3. 等待窗口就绪，点击左侧导航第 5 项「图谱」。
4. 观察内容区宽度。

## 证据

- `evidence/001-graph-narrow-040ae10.png` — 复现截图：图谱模块整体只有 310px 宽，右侧大片空白。
- `evidence/001-graph-narrow-040ae10-collapsed.png` — 折叠导航栏后仍为 310px（证明与导航栏宽度无关）。
- `evidence/001-graph-fixed-simulation.png` — 修复模拟：加回 `.imb-shell-content.imb-layout-single` 的 `!important` 声明后图谱立即铺满 1198px（视口 1262 − 导航 64）。

CDP 实测（`scripts/private/cdp-eval.mjs`，`CDP_PORT=9226`）：

| 测量项 | 复现值 | 期望值 |
| --- | --- | --- |
| `.imb-shell-content` 的 `grid-template-columns` | `310px 736px` | `1198px`（折叠导航）/ `1046px`（展开导航） |
| `.imb-graph` 宽度 | **310px** | 内容区全宽 |
| 窗口最大化 / 缩放后 | 仍 310px | 跟随内容区 |

## 根因分析

`src/renderer/components/app-shell/index.css:13-22` 的基础样式：

```css
.imb-shell-content { display: grid; grid-template-columns: 300px 1fr; min-width: 0; min-height: 0; }
.imb-shell-content.imb-layout-single { grid-template-columns: 1fr; }
```

`040ae10` 的私有层 `src/renderer/private/overrides.css`（对应构建产物 `out/renderer/assets/index-WS0GX2m4.css:8386-8388`）新增：

```css
.imb-shell-content { grid-template-columns: 310px 1fr !important; }
```

图谱模块**不在** `LIST_DETAIL_MODULES` 中（`shellLayoutFor()` 见 `src/renderer/components/app-shell/index.tsx:145-147` 返回 `"single"`），因此 `.imb-contentpane` 是 `imb-shell-content` 里**唯一**的网格项，被自动放入**第一列 310px**，右侧 `1fr` 空置。
`!important` 又压过了特异性更高的 `.imb-layout-single { grid-template-columns: 1fr; }`，所以模块内无法自救，只能被钉死在 310px——与窗口尺寸完全无关，与 Boss 描述「常规尺寸和最大化都一样」完全吻合。

补充确认：
- 折叠导航栏后 `.imb-app` 变成 `64px 1198px`，但 `.imb-shell-content` 仍是 `310px 888px` → 图谱仍 310px，与导航栏宽度无关。
- 该规则是从 `040ae10` 引入的（`git log -S 'grid-template-columns: 310px 1fr !important' -- src/renderer/private/overrides.css` 只有 `040ae10` 一个提交）。
- 当前 `mine` 工作区（含 Boss 的暂存 WIP）已删除 `.imb-app` / `.imb-shell-content` 网格覆盖块（当前 `src/renderer/private/overrides.css` 中 0 处命中），所以在工作区构建上测不出来（`.imb-graph` 实测 1054px）——这也是 Boss 只在 AppImage 里看到该问题的原因。

## 验收标准

1. 在 `mine` 分支上，`single` 布局模块（图谱、以及任何非 `LIST_DETAIL_MODULES` 模块）的 `.imb-contentpane` 铺满 `.imb-shell-content` 的整个宽度，右侧不再有空置的 `1fr` 列。
2. 图谱模块在常规尺寸与最大化下表现一致（都铺满），窗口缩放时跟随内容区宽度。
3. `list-detail` 布局模块（对话、员工等）的中栏宽度保持原有观感，不因修复而改变。
4. 导航栏展开（216px）/ 折叠（64px）两种状态下均正确。
5. 修复不得依赖覆盖 `.imb-layout-single` 的 `!important` 军备竞赛；建议直接把私有层里这条 `.imb-shell-content` 网格覆盖改成只作用于 `list-detail`（例如 `.imb-shell-content:not(.imb-layout-single)`，或整体删除该块——当前 WIP 的做法）。

## 处理记录

| 日期 | 操作 | 结果 |
| --- | --- | --- |
| 2026-10-18 | 对 Boss 报告截图做像素取证，测得内容面板宽正好 310px | 与 `310px 1fr !important` 精确吻合 |
| 2026-10-18 | 解析 Boss AppImage 的 `app.asar`，在其 CSS 中定位到该规则（rel 212132-212554） | AppImage = `040ae10` + 私有层，不含暂存 WIP |
| 2026-10-18 | 以 `040ae10` 为基准在 `/tmp/repro` 独立构建 + 独立 HOME 启动，CDP 实测 `.imb-graph` = 310px | **复现成功**，与 Boss 截图一致 |
| 2026-10-18 | 折叠/展开导航栏复测 | 仍 310px，排除导航栏因素 |
| 2026-10-18 | 加回 `.imb-layout-single { grid-template-columns: 1fr !important }` 模拟修复 | 图谱立即铺满 1198px，修复方向验证有效 |
