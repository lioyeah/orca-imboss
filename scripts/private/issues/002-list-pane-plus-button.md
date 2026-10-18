# 002 · 中栏「新对话 / 招募」底部大按钮应改为标题右侧 + 号

- **状态**: `verified`（已核实，等待修复）
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
