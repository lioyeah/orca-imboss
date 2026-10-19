# 001 · 图谱画布只占内容区一小块（常规尺寸与最大化一致）

- **状态**: `fixed-verified`（@4 工作区验证 + @3 独立复测 + mini-app 补证；**修复已由 Boss 固化为提交 `3e5fcee`**，@3 已在已提交 HEAD 上完成最终复测，定案关闭）
- **报告人**: Boss（chat 10）
- **负责人**: UI 修复负责人（@4）
- **严重程度**: 高（核心视图不可用）
- **组件/区域**: 图谱模块（Knowledge Graph）+ 应用外壳网格布局
- **相关提交**: `040ae10`（引入 bug：`overrides.css` 的 `310px 1fr !important`）；`9d42c25`（本 issue 落档）。**注意**：`mine` 最新 HEAD `87cb86c` 的 `src/renderer/private/overrides.css:487-488` 仍含该覆盖；修复只存在于 Boss 的暂存 WIP 工作区（该文件已 `M`，0 处命中 310px），待 WIP 提交后固化。
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

@4 工作区修复验证截图（测试环境，seed 47 节点富数据）：

- `evidence/001-graph-worktree-normal-45nodes.png` — 工作区构建、47 节点 / 45 连线、铺满内容区（折叠导航）。
- `evidence/001-graph-worktree-fill-900.png` — 视口 900×680，图谱铺满 824px（单列，无 310px 陷阱）。
- `evidence/001-graph-worktree-fill-1262.png` — 视口 1262×1030，铺满 1186px。
- `evidence/001-graph-worktree-fill-1920.png` — 视口 1920×1080（≈最大化宽），铺满 1844px。

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

## 修复验证（@4，工作区构建）

验证环境：`scripts/private/run-test-env.sh`（`HOME=~/.imboss-ui-test`、CDP 端口 9224、PID 278022、视口 1262×1030），`pnpm run build` 从**当前工作区**（含 Boss 暂存 WIP）构建——被测对象已含「删除 310px 覆盖块」的修复。用 `imb.chats.create()`（与「新对话」按钮同一 IPC 路径）在隔离 HOME 内 seed 了 47 节点 / 45 连线（对齐 Boss ~42/52 场景）。

视口 × 导航矩阵（`Emulation.setDeviceMetricsOverride` 触发与真实缩放一致的 reflow；本 Electron 构建的 CDP 未暴露 `Browser.setWindowBounds`，故以视口覆盖等效验证「最大化 / 缩放」）：

| 视口 | 导航 | `.imb-shell-content` grid | contentpane/stage 宽 | 结果 |
| --- | --- | --- | --- | --- |
| 900×680 | 折叠 76 | `824px`（单列） | 824 | 铺满 ✓ |
| 1262×1030 | 折叠 76 | `1186px`（单列） | 1186 | 铺满 ✓ |
| 1500×950 | 折叠 76 | `1424px`（单列） | 1424 | 铺满 ✓ |
| 1920×1080 | 折叠 76 | `1844px`（单列） | 1844 | 铺满 ✓（≈最大化宽） |
| 900×680 | 展开 208 | `692px`（单列） | 692 | 铺满 ✓ |
| 1920×1080 | 展开 208 | `1712px`（单列） | 1712 | 铺满 ✓ |

所有组合：grid 均为**单列**（绝非 `310px 1fr`），`.imb-contentpane` 宽 == 视口宽 − 导航宽，stage 铺满，图谱保持挂载（47 节点），节点横向铺开；缩放后加载 reflow 正确。

list-detail 无回归：对话 / 员工 / 定时任务 / 统计 / 设置 5 个 `list-detail` 模块 grid 均 `300px 754px`（中栏回到基础 300px，310px 覆盖已消失）、`.imb-contentpane` 隐藏、双列结构完好。

single 布局机制：图谱与 miniapp / group-chat / agent-session 共用 `.imb-layout-single → .imb-contentpane` 同一填充路径，图谱通过即覆盖该机制。（设置 settings 实为 `list-detail`，非 single。）

**miniapp 实测补证（@3，独立复测）**：live `~/.imboss/mini-apps/` 只有一个空 `index.json`（`{"order": []}`，无实际 mini-app），复制路线无效，改为在隔离 HOME **自造最小 mini-app**（只写 `~/.imboss-ui-test/.imboss/mini-apps/steward-probe/`：`metadata.json` = `{"name":"UI 验证探针","entry":"http://127.0.0.1:5178/index.html"}` + `index.html`；`index.json` = `{"order":["steward-probe"]}`；entry 走 `python3 -m http.server 5178 --bind 127.0.0.1`，我自己的进程 PID 309127，验证完只杀它）。`run-test-env.sh --stop` 重启后 nav 出现「UI 验证探针」项，点击进入后 `.imb-miniapp-host` iframe 正常加载。

| 视口 | 导航 | shell grid | `.imb-contentpane` 宽 | `.imb-miniapp-host` 宽 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 1262×1030 | 展开 208 | `1054px`（单列） | 1054 | 1054 | 铺满 ✓ |
| 1262×1030 | 折叠 64 | `1186px`（单列） | 1186 | 1186 | 铺满 ✓ |
| 1920×1080 | 展开 208 | `1712px`（单列） | 1712 | 1712 | 铺满 ✓ |
| 1920×1080 | 折叠 64 | `1844px`（单列） | 1844 | 1844 | 铺满 ✓ |

证据：`evidence/001-verify-miniapp-1262-expanded.png`、`001-verify-miniapp-1920-expanded.png`。**mini-app 证据格已补齐，无 310px 陷阱。**

**最终复测（2026-10-19，Boss 已提交 WIP：`3e5fcee` 提交私有层 WIP、`9aaf0a9` 提交 #002 实现，工作区干净）**：`git grep -c "310px 1fr !important" HEAD -- src/renderer/private/` → 0，`git show HEAD:src/renderer/private/overrides.css` 中 `grid-template-columns` 0 命中，**修复已固化**。在已提交 HEAD 的同一构建上重测：图谱 `.imb-graph` = 1186px == `.imb-contentpane`（导航折叠态）；mini-app `.imb-miniapp-host` = 1186px == 内容区宽，iframe 正常加载 `http://127.0.0.1:5178/index.html`（证据 `evidence/001-verify-miniapp-committed-HEAD.png`）。**#001 定案关闭。**

固化状态（需 Boss 决策）：修复 = 暂存 WIP 删除 `src/renderer/private/overrides.css` 的 `.imb-shell-content { grid-template-columns: 310px 1fr !important }`；`mine` HEAD `87cb86c` 的 `overrides.css:487-488` 仍含该行，故修复**仅存在于工作区**，待 Boss 提交 WIP 后固化。@4 未提交该 WIP 文件（红线：绝不碰 Boss 暂存 WIP）。310px 未回加：310px 属 040ae10 实验值，WIP 已按验收标准 #5 建议的「整体删除该块」把中栏退回基础 300px；若日后想要更宽中栏，应走 `.imb-shell-content:not(.imb-layout-single)` 这类**限定 list-detail** 的作用域，而非曾破坏 single 布局的全局 `!important`。

## 处理记录

| 日期 | 操作 | 结果 |
| --- | --- | --- |
| 2026-10-18 | 对 Boss 报告截图做像素取证，测得内容面板宽正好 310px | 与 `310px 1fr !important` 精确吻合 |
| 2026-10-18 | 解析 Boss AppImage 的 `app.asar`，在其 CSS 中定位到该规则（rel 212132-212554） | AppImage = `040ae10` + 私有层，不含暂存 WIP |
| 2026-10-18 | 以 `040ae10` 为基准在 `/tmp/repro` 独立构建 + 独立 HOME 启动，CDP 实测 `.imb-graph` = 310px | **复现成功**，与 Boss 截图一致 |
| 2026-10-18 | 折叠/展开导航栏复测 | 仍 310px，排除导航栏因素 |
| 2026-10-18 | 加回 `.imb-layout-single { grid-template-columns: 1fr !important }` 模拟修复 | 图谱立即铺满 1198px，修复方向验证有效 |
| 2026-10-18 | @4 测试环境（工作区构建）验证：seed 47 节点，视口 900/1262/1500/1920 × 导航折叠/展开矩阵，grid 均单列、contentpane 铺满、无 310px 陷阱 | **fixed-verified** |
| 2026-10-18 | @4 复测 list-detail 无回归：chat/employees/cron/spend/settings 均 `300px 754px`、contentpane 隐藏 | 通过 |
| 2026-10-18 | @4 确认修复仅在暂存 WIP（HEAD `87cb86c` 仍含 310px 覆盖），未提交 WIP 文件；310px 未回加，固化待 Boss 提交 WIP | 已记录，待 Boss 拍板固化 |
| 2026-10-18 | **@3 独立复测**（不依赖 @4 证据，另写 `/tmp/cdp-metrics.mjs` 用 `Emulation.setDeviceMetricsOverride` 直接设视口）：`grep -rn 'grid-template-columns.*!important' src/renderer/private/` → 0 命中，私有层已无该覆盖；基础 `.imb-layout-single` 规则完好 | 修复成立，未引入 `!important` 军备竞赛 |
| 2026-10-18 | @3 复测图谱铺满：视口 900×700 / 1262×1030 / 1920×1080 三档，`.imb-graph` 与 `.imb-contentpane` 宽度逐一相等（824 / 1186 / 1844）；导航展开 208px 时 1054px、折叠 64px 时 1186px，均铺满 | 通过（证据 `evidence/001-verify-steward-1262-expanded.png`，47 节点 / 45 连线富数据） |
| 2026-10-18 | @3 复测 list-detail 无回归：对话 / 员工 / 定时任务 / 统计 / 设置 均 `300px 754px`，中栏 pane 300px、内容区 754px | 通过 |
| 2026-10-18 | @3 记录环境限制：miniapp 也是 single 布局，但该表面只在存在 mini-app 时由 nav 动态渲染，隔离测试实例内未安装任何 mini-app，**本次无法实测**；需 @4 或有 mini-app 的环境补一份证据 | 待补证据（不影响 #001 结论，根因与修复均为同一网格规则） |
| 2026-10-19 | Boss 提交 WIP（`3e5fcee`），工作区干净；@3 在已提交 HEAD 上最终复测：`git grep` 确认私有层无 310px 覆盖，图谱 1186px 铺满、mini-app 1186px 铺满且 iframe 正常加载 | **定案关闭** |
