# 003 · 员工卡片 Name/Role 输入区与头像右侧显示重复，应改为 hover 铅笔原地编辑

- **状态**: `verified`（已核实，等待修复）
- **报告人**: Boss（chat 10）
- **负责人**: UI 修复负责人（@4）
- **严重程度**: 中（信息重复、编辑路径不直观）
- **组件/区域**: 员工详情（employee-detail）
- **相关提交**: 当前 `mine` HEAD `3da025f`（含 Boss 暂存 WIP）
- **环境**:
  - 分支 `mine`，commit `3da025f`
  - 构建：`scripts/private/run-test-env.sh` 默认模式
  - 启动：`HOME=~/.imboss-ui-test`、`CDP 9224`、`--no-sandbox --ozone-platform=wayland`
  - 视口 1262×1030；宿主 Wayland
  - 数据状态：隔离 HOME；为取证在测试实例内新建了 1 名员工「UI复现测试员 / 验证编辑」（不影响 live 实例）

## 报告描述

Boss：除内置 0 号员工外，去掉员工卡片里独立的 Name / Role 输入区（与头像右侧显示重复），改为 hover 名字 / 角色出现铅笔编辑图标，点击原地编辑，Enter / 失焦提交（走原 `scheduleSave` / `onPatch`），Esc 取消。

实测确认重复：头像右侧 `.imb-detail-avatar-info` 已显示 `h2` 名字 + `.imb-sub` 角色；紧接着下方 `imb-field-row` 又是「名字」「角色」两个 input，内容完全相同。

## 复现步骤

1. 启动隔离测试实例（CDP 9224）。
2. 点击左侧导航「员工」。
3. 选中内置 Assistant（#0）：详情页头像右侧显示 `Assistant / Assistant`，下方仅一个「名字」输入框（内容同为 `Assistant`）——**无角色输入框**（0 号员工按设计不显示角色）。
4. 选中任意非内置员工（本次取证临时新建 #1「UI复现测试员 / 验证编辑」）：头像右侧显示 `UI复现测试员 / 验证编辑`，下方 `imb-field-row` 并列「名字」「角色」两个 input，值与显示完全一致。

## 证据

- `evidence/003-employee-detail-assistant.png` — 0 号员工：头像右侧 `Assistant / Assistant`，下方「名字」输入框重复同一值（无角色输入框）。
- `evidence/003-employee-detail-non-assistant.png` — 非内置员工：头像右侧 `UI复现测试员 / 验证编辑`，下方并列「名字」「角色」两个 input，与显示重复。

CDP 实测（`CDP_PORT=9224`）：

| 项 | 0 号员工（Assistant） | 非内置员工（#1） |
| --- | --- | --- |
| `.imb-detail-avatar-info` | `<h2>Assistant</h2><div class="imb-sub">Assistant</div>`（x=527 y=150 w=90 h=55） | `<h2>UI复现测试员</h2><div class="imb-sub">验证编辑</div>`（x=620 y=150 w=120 h=55） |
| `imb-field-row` | 1 个，仅「名字」input `#emp-name-0` | 1 个，含「名字」`#emp-name-1` + 「角色」`#emp-role-1`（row x=532 y=233 w=706 h=85） |
| 字段 id 序列 | `emp-name-0` | `emp-name-1`、`emp-role-1`、`emp-prompt-1`、`emp-model-1`、`emp-thinking-1` |

## 根因分析 / 现状定位

`src/renderer/components/modules/employees/employee-detail/index.tsx`（374 行）：
- `const isAssistant = employee.id === 0;`（第 50 行）→ 0 号员工走特殊分支，不渲染「角色」输入框；
- 头部 ~165-196：头像 + `.imb-detail-avatar-info`（`h2` = `displayName`，第 136 行；`.imb-sub` = `displayRole`，第 139 行）；
- `imb-field-row` ~211-235：`Field "Name" → Input`（始终渲染），`Field "Role" → Input`（仅 `!isAssistant`），两个 input 的 `onValueCommit` 都走 `scheduleSave({ ...form, name/role })`。

即：**同一份数据在两处各有一个可编辑入口**，显示区只读、字段区可编辑，视觉与心智都不一致。

## 验收标准

1. 非内置员工的「名字」「角色」两个独立输入框从详情卡中移除；0 号员工保持现状（字面读法：0 号仍保留其「名字」输入框，不获得 hover 编辑入口）。→ 若 Boss 希望 0 号也改成 hover 铅笔，请在开工前确认（见下方「待确认」）。
2. 头像右侧的 `h2` 名字 / `.imb-sub` 角色在 hover 时出现铅笔编辑图标（36px 级别、发丝线边框、quiet 语言）。
3. 点击铅笔 → 原地变成输入框（不打开弹窗、不跳转），Enter 或失焦提交，走原有 `scheduleSave({ ...form, name/role })` / `onPatch` 路径，保存后回到只读显示。
4. Esc 取消编辑并还原原值；空值提交时保持与现有 Input 相同的 `placeholder` 行为（「未命名」/ 角色占位）。
5. 编辑中状态有可感知的视觉反馈（聚焦环 / 边框态与现有 `.imb-input` 一致）。
6. 其他字段（系统提示词、关联 MCP、技能集、使用的模型、思考强度）布局与行为无回归；移除输入框后详情卡不出现明显空隙。
7. 键盘可达：铅笔可 Tab 聚焦、Enter/Space 进入编辑。

## 待确认（需 Boss 拍板）

内置 0 号员工是否也要获得 hover 铅笔原地编辑？字面读法「除内置 0 号员工外」= 否，0 号保持现状（保留「名字」输入框）。本 issue 按字面读法编写；若 Boss 本意是「0 号也不该有底部输入框」，只需把 0 号也纳入同一交互，改动量很小。

## 处理记录

| 日期 | 操作 | 结果 |
| --- | --- | --- |
| 2026-10-18 | 实测 0 号与非内置员工的详情页 DOM | 确认头像右侧显示与 `imb-field-row` 输入框内容完全重复 |
| 2026-10-18 | 为取证在测试实例新建 1 名员工并截图 | 拿到非内置员工分支的证据（`003-employee-detail-non-assistant.png`） |
