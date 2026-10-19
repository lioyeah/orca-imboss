# 002 · 中栏「新对话 / 招募」底部大按钮应改为标题右侧 + 号

- **状态**: `fixed-verified`（@3 独立复测通过；修复实现位于工作区未暂存改动，尚未提交，固化待 Boss 决策）
- **报告人**: Boss（chat 10）
- **负责人**: UI 修复负责人（@4）
- **严重程度**: 中（视觉噪声，与 quiet 设计语言冲突）
- **组件/区域**: ListPane（中栏）＋ chat-module ＋ employees-module
- **相关提交**: 当前 `mine` HEAD `3da025f`（含 Boss 暂存 WIP）
- **环境**:
  - 分支 `mine`，commit `3da025f`（含 21 个暂存 WIP 文件）
  - 构建：`scripts/private/run-test-env.sh` 默认模式（`pnpm run build`）
  - 启动：`HOME=~/.imboss-ui-test`、`CDP 9224`、`--no-sandbox --ozone-platform=wayland`
  - 视口 1262×1030；中栏宽 300px
  - 宿主：Wayland

## 报告描述

Boss：新建对话 / 新招募员工不应在底部占一个巨大按钮，只需中栏右侧一个 + 号（如对话界面已有实现）。
实测：当前工作区构建里，**两个模块的 + 号都已被暂存 WIP 删掉**，只剩底部大按钮。因此本 issue 的修复 = 把 `040ae10` 里的实现恢复出来，并同样应用到员工模块。

## 复现步骤

1. 启动隔离测试实例（`scripts/private/run-test-env.sh`，HOME `~/.imboss-ui-test`，CDP 9224）。
2. 点击左侧导航「对话」→ 中栏底部可见整宽绿色大按钮「新对话」；标题栏右侧无任何操作按钮。
3. 点击左侧导航「员工」→ 中栏底部可见整宽绿色大按钮「招募」；标题栏右侧同样无任何操作按钮。

## 证据

- `evidence/002-chat-bottom-newchat-button.png` — 对话模块：中栏 300px 宽，底部 267×42 整宽主色按钮「新对话」，标题行右侧空白。
- `evidence/002-employees-bottom-recruit-button.png` — 员工模块：同样形态的底部按钮「招募」。

CDP 实测（`CDP_PORT=9224`，`scripts/private/cdp-eval.mjs`）：

| 模块 | 中栏 pane | 底部按钮 | 标题栏 actions |
| --- | --- | --- | --- |
| 对话 | x=76 w=300 h=1030 | `imb-btn imb-btn-primary imb-btn-block`「新对话」267×42 | `null`（无 `.imb-pane-actions`） |
| 员工 | x=76 w=300 h=1030 | 同上「招募」267×42 | `null` |

## 根因分析 / 现状定位

`040ae10` 本来就有 Boss 说的「对话界面已有实现」：
- `src/renderer/components/list-pane/index.tsx`：`040ae10` 有可选 `actions?: ReactNode`，渲染在 `.imb-pane-header-top`（标题左、actions 右，高度 `var(--imb-header-h, 52px)`）；
- `src/renderer/components/modules/chat/chat-module/index.tsx`：`040ae10` 传了一个 `+` 图标按钮，class `imb-icon-btn imb-btn-ghost imb-pane-action-btn`，内联 plus path `M8 3v10M3 8h10`，`Tooltip` + `aria-label={t("New Chat")}`。

**暂存 WIP 把这两处都删了**（`git diff --cached --stat`：`list-pane/index.tsx` −9、`chat-module/index.tsx` −22），所以当前工作区既没有 + 号、也没有 `.imb-pane-actions` 样式。同时两个模块的底部大按钮仍在：
- 对话：`src/renderer/components/modules/chat/chat-module/index.tsx:796-800`（footer Button「New Chat」）
- 员工：`src/renderer/components/modules/employees/employees-module/index.tsx:238-242`（footer Button「Recruit」）

图标组件：`src/renderer/components/icons/index.tsx:137`（`IconPlus`）。
`040ae10` 的 CSS 里 `.imb-pane-action-btn` 有 7 处命中（见 AppImage asar 取证），当前工作区 CSS 已 0 命中。

## 验收标准

1. 对话、员工两个模块的中栏**标题右侧**各有一个 + 图标按钮；底部整宽大按钮**移除**。
2. 点击行为不变：对话 = `newChat()`；员工 = 打开招募弹窗（原「招募」按钮的行为）。
3. 按钮带 `Tooltip` 与 `aria-label`，复用现有 i18n key（`New Chat` / 招募对应 key），不新增重复文案。
4. 中栏窄宽度（≈300px）下不挤压标题与搜索框；36px 级别控件、发丝线边框，符合当前 quiet 视觉语言。
5. settings / settings-providers / mcp / skills / cron / spend 等其他 ListPane 使用者**无回归**（`actions` 为可选 prop，不传即不渲染）。
6. 键盘可达：Tab 能聚焦该 + 号，Enter/Space 可触发。

## 处理记录

| 日期 | 操作 | 结果 |
| --- | --- | --- |
| 2026-10-18 | 在 `3da025f` 测试实例上实测两个模块中栏 | 确认均只剩底部整宽大按钮，标题栏无 actions 槽 |
| 2026-10-18 | 比对 `040ae10` 源码 | 确认 `040ae10` 已有 ListPane `actions` 槽 + 对话模块 + 号；暂存 WIP 删除 |

## @3 独立复测记录（2026-10-19）

**被测构建**：测试实例 PID **499924**（CDP 端口 9224，HOME `~/.imboss-ui-test`），产物 `out/renderer/assets/index-CtQnmfFE.css`（07:59:50 构建，晚于源码改动 07:42–07:59:40），即当前工作区（含 #002 实现的未暂存改动）。

### 验收逐条

| # | 验收标准 | 实测 | 结论 |
| --- | --- | --- | --- |
| 1 | 标题右侧 + 号 / 底部大按钮移除 | 对话：`.imb-pane-action-btn` 32×32 @ x=335 y=20（中栏右缘 376，右内缩 9px），radius 10px；`.imb-pane-footer` = null，中栏内 `.imb-btn-primary` = 0。员工：同规格 32×32 @ x=335，footer null、primary 0 | 通过 |
| 2 | 点击行为不变 | 对话：先选中 `Seed chat 45`（activeIdx 7）→ 点 + → active 切到索引 0 的新建空「新对话」，详情标题同步 → `newChat()` 行为一致。员工：点 + → 弹出招募弹窗（含「未命名」名字框 +「如：调研员」角色框）→ `setRecruitOpen(true)` 一致；Esc 可关闭 | 通过 |
| 3 | Tooltip + aria-label 复用现有键 | aria-label 实测「新对话」/「招募」；`t("New Chat")`/`t("Recruit")` 键已存在于 `src/shared/translations/zhCN.json:240,309`，未新增键 | 通过 |
| 4 | 300px 窄宽不挤压 | 视口 1262×1030 / 1024×768 / 900×700 / 800×600 × 导航展开/折叠共 8 组：按钮恒 32×32、右内缩恒 9px、标题右缘到按钮左缘间距恒 211px、搜索区恒 283px 宽（对话 70px 高 = SearchInput + TagSelect 两行完好），`scrollWidth > innerWidth` 恒 false | 通过 |
| 5 | 其他 ListPane 消费者无回归 | `actions` 为可选 prop（`actions?: ReactNode`，仅 `!== undefined` 时渲染）。几何中性证明：把 padding 移回标题模拟修复前，**无 actions 按钮的消费者 header 高度完全不变**——定时任务 85→85、统计 135→135、设置/模型服务商/MCP/技能 53→53；仅对话/员工因 32px 按钮高于 29px 标题行而 +3px（1262×1030 下 123→126）。模型服务商/MCP/技能原有的 footer 主色按钮（添加模型提供商 / 添加 MCP Server / 导入技能）均未被动 | 通过 |
| 6 | 键盘可达 | 原生 `<button type="button">`、无 tabindex 覆盖，`focus()` 后 `activeElement === btn`。用 CDP `Input.dispatchKeyEvent` 发**可信**按键（关键：必须带 `text` 字段，Enter 传 `\r`、Space 传 ` `，否则默认点击动作不触发——这是 CDP 用法问题非应用缺陷，已用注入的裸按钮做对照确认）：Enter 与 Space 均产生真实 `click` 并打开招募弹窗 | 通过 |
| 7 | quiet 视觉 | `.imb-pane-action-btn` 自包含：32×32、`var(--imb-radius-md)`、`var(--imb-muted)`、透明底、hover `--imb-fg-soft`/`--imb-fg`、`:focus-visible` `var(--imb-focus-ring)`；`list-pane/index.css` 内 `!important` 计数 **0** | 通过 |

### 证据

- `evidence/002-verify-steward-chat.png`：对话中栏，标题右侧 + 号、底部无大按钮、搜索 + 标签筛选两行完好
- `evidence/002-verify-steward-employees.png`：员工中栏同规格

### 遗留

- 修复实现**仍未提交**（4 个文件 `MM`/`M` 状态：`list-pane/index.tsx`、`list-pane/index.css`、`chat-module/index.tsx`、`employees-module/index.tsx`）。任何 `stash`/`checkout` 都会静默丢失；提交与否由 Boss 决策（@0 已冻结 agent 代提建议）。提交后我可立即在新 commit 上做最终复测。
- CSS 注释说明 `.imb-pane-action-btn` 必须自包含的原因（`.imb-icon-btn` 基础样式表只在 `IconButton` 组件被 import 时才进 bundle）——实测确认当前 bundle 无该基础表，自包含写法是必要的。
