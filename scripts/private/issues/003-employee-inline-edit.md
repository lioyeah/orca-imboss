# 003 · 员工卡片 Name/Role 输入区与头像右侧显示重复，应改为 hover 铅笔原地编辑

- **状态**: `fixed-verified`（@5 实现 `fd52679` + 证据 `809a755`；@3 于 2026-10-19 在实例 PID 572874 / 构建 `index-CjJNZ0tY.css` 上按 9+1 条口径独立复测，**10/10 全过**，待 @0 关案）
- **报告人**: Boss（chat 10，含 m00146 / m00211 两条追加口径）
- **负责人**: UI 修复工程师（@5）
- **严重程度**: 中（信息重复、编辑路径不直观）
- **组件/区域**: 员工详情（employee-detail）
- **相关提交**: 修复 `fd52679 feat(ui): merge employee name/role into inline header edit`（2 文件 +194/−44，仅 `employee-detail`）；证据 `809a755 docs(issues): 003 verification evidence`
- **环境**:
  - 分支 `mine`，commit `3da025f`
  - 构建：`scripts/private/run-test-env.sh` 默认模式（复测时实例 PID 572874、构建产物 `index-CjJNZ0tY.css`，与 `fd52679` 源码状态一致；复测未重启、未重新构建）
  - 启动：`HOME=~/.imboss-ui-test`、`CDP 9224`、`--no-sandbox --ozone-platform=wayland`
  - 视口 1262×1030；宿主 Wayland
  - 数据状态：隔离 HOME；为取证在测试实例内新建了 1 名员工「UI复现测试员 / 验证编辑」（不影响 live 实例）

## 报告描述

Boss 第一条（m00146）：除内置 0 号员工外，去掉员工卡片里独立的 Name / Role 输入区（与头像右侧显示重复），改为 hover 名字 / 角色出现铅笔编辑图标，点击原地编辑，Enter / 失焦提交（走原 `scheduleSave` / `onPatch`），Esc 取消。

Boss 第二条（m00211）：「这样在员工浏览界面就有且仅有一组员工名称和角色显示了」。

**口径裁定（@0，m00096 转述）**：m00211 **取代** m00146 的「除内置 0 号员工外」 carve-out。即**全部员工（含内置 0 号）统一走同一套**：头像移到顶部名字/角色左侧、hover 铅笔原地编辑、输入区全部移除。本 issue 依据 m00211 推定编写；若 Boss 纠正，回滚 0 号部分即可（改动量极小）。

实测确认重复：头像右侧 `.imb-detail-avatar-info` 已显示 `h2` 名字 + `.imb-sub` 角色；紧接着下方 `imb-field-row` 又是「名字」「角色」两个 input，内容完全相同。

## 复现步骤

1. 启动隔离测试实例（CDP 9224）。
2. 点击左侧导航「员工」。
3. 选中内置 Assistant（#0）：详情页头像右侧显示 `Assistant / Assistant`，下方仅一个「名字」输入框（内容同为 `Assistant`）——**无角色输入框**（0 号员工按 `isAssistant` 分支不渲染角色输入框；按 m00211 口径，该输入框也应移除并改为 hover 编辑）。
4. 选中任意非内置员工（本次取证临时新建 #1「UI复现测试员 / 验证编辑」）：头像右侧显示 `UI复现测试员 / 验证编辑`，下方 `imb-field-row` 并列「名字」「角色」两个 input，值与显示完全一致。

## 证据

- `evidence/003-verify-employee0-header.png` — 复测：0 号员工终态。头像 72×72 在左，右侧仅一组 `Assistant / Assistant`（角色为纯 `.imb-sub` 无铅笔），无 Name/Role 输入区，无「移除」按钮（内置保护保留）。
- `evidence/003-verify-employee1-header.png` — 复测：非内置员工终态（静止态）。头像在左，`UI复现测试员 / 验证编辑` 一组显示，铅笔 opacity 0（静止隐藏），下方依次为系统提示词 / 关联 MCP / 技能集 / 使用的模型 / 思考强度，无 Name/Role 输入区，「移除」按钮保留。
- `evidence/003-verify-employee1-hover-pencil.png` — 复测：hover 角色行 → 铅笔 opacity 1 且 Tooltip「编辑」浮现。
- `evidence/003-verify-inline-edit-open.png` — 复测：点击铅笔后原地编辑器（输入框带聚焦环，替换名字文本，不弹窗不跳转）。
- `evidence/003-verify-avatar-crop-modal-open.png` — 复测：换头像流程不受影响，裁切模态（canvas 裁切区 + 缩放滑块 + 预览 + 取消/完成）正常打开。

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

按 @0 m00157 派工单的 9 条口径（与上文「口径说明」一致，复测逐条对照）：

1. 名字/角色在**整个员工浏览界面只有一处显示**（顶部），field-row 的 Name / Role 输入区移除。
2. **头像位于顶部名字/角色显示左侧**（m00211 的显式要求；原先头像在上方一行、名字/角色在下一行）。
3. field-row 的「名字」输入框（始终渲染）与「角色」输入框（仅 `!isAssistant`）全部移除。
4. hover 名字/角色出现铅笔编辑图标提示；点击进入**原地编辑**（不打开弹窗、不跳转）。
5. Enter 或失焦提交、Esc 取消；保存走既有 `scheduleSave({ ...form, name/role })` / `onPatch` 链路，**不新造保存逻辑**；空值提交保持与现有 Input 相同的 `placeholder` 行为（「未命名」）。
6. 内置 0 号员工：**名字可 hover 编辑、角色维持只读**（无编辑入口；与上游 `isAssistant` 保护一致，这是唯一残余特殊点）。
7. 换头像浮层流程不受影响（头像仍可点击、浮层选项照旧）。
8. quiet 视觉语言：发丝线边框、36px 级控件、muted 色；编辑态视觉反馈（聚焦环/边框）与现有 `.imb-input` 一致。铅笔视觉尺寸 14×14（inline 提示图标，非独立控件），**可点击命中区域 ≥24×24**（@0 依 id 177 裁定：视觉保持 14px、用 padding 扩命中区，WCAG 2.5.8 AA）。
9. 测试环境（HOME ~/.imboss-ui-test / CDP 9224）自验通过 + 证据图；键盘可达（铅笔可 Tab 聚焦，Enter/Space 进入编辑）。

> 复测补充项（原第 6 条，@0 9 条口径未单列，复测照查）：其他字段（系统提示词、关联 MCP、技能集、使用的模型、思考强度）布局与行为无回归；移除输入框后详情卡不出现明显空隙。

## 独立复测记录（@3，2026-10-19）

- 被测：`fd52679` + `809a755`；实例 PID 572874、CDP 9224、HOME `~/.imboss-ui-test`、视口 1262×1030、探针 `/tmp/verify-003.mjs`（`Emulation.setDeviceMetricsOverride` 设视口 + 合成事件）。
- 安全：复测前后 Boss live PID 261970 与 `~/.imboss` mtime `2026-10-18 10:46:48` 均未变；测试实例未重启、未重新构建；测试产生的名字/角色改动已逐项还原（#1 恢复 `UI复现测试员 / 验证编辑`）。

| # | 口径 | 实测值 | 判定 |
| --- | --- | --- | --- |
| ① | 名字/角色全界面只有一处显示，field-row 输入区移除 | 0 号：`.imb-field-row`=0、name/role input=0；#1：`.imb-field-row`=0、name/role input=0（仅剩 `#emp-prompt-1` 系统提示词 textarea） | ✅ |
| ② | 头像位于名字/角色左侧 | avatar-wrap 72×72 @ x=439..511，info @ x=527（头像右缘 511 < 名字左缘 527），两名员工一致 | ✅ |
| ③ | field-row 的 Name/Role 输入全部移除 | 同 ①；剩余输入/选择控件仅为系统提示词、关联 MCP、技能集、使用的模型、思考强度 | ✅ |
| ④ | hover 出铅笔 + 点击原地编辑 | hover name 行 @(596,62)：name 铅笔 opacity 1 / role 铅笔 0；hover role 行 @(596,94)：role 铅笔 1 / name 铅笔 0（互斥）。点击铅笔 → activeElement=`INPUT.imb-input.imb-employee-name-input`，aria-label「名字」，value 预填当前值且全选，box 265×44 @(527,40)，原地替换 h2 文本；Tooltip「编辑」 | ✅ |
| ⑤ | Enter/失焦提交、Esc 取消，走既有保存链路 | Enter：名字→`STEWARD-COMMIT`，h2 同步、stillEditing=false、active=BODY、中栏列表行同步 `["Assistant","STEWARD-COMMIT"]`；blur：角色→`复测角色A` 同步；Esc：编辑器已输入时取消，名字保持 `UI复现测试员`、无保存。源码仍走 `scheduleSave`（`beginEdit/commitEdit/cancelEdit` + `fieldDoneRef` 防重复提交），未新造保存逻辑 | ✅ |
| ⑥ | 0 号：名字可编辑、角色只读 | 0 号 `editLineCount`=1（仅 name 行有 `.imb-employee-edit-line`），角色为纯 `.imb-sub` 无铅笔；「移除」按钮不显示（内置保护保留） | ✅ |
| ⑦ | 换头像浮层不受影响 | `.imb-detail-avatar-wrap` 72×72 @(439,39)、aria-label「更换头像」；`DOM.setFileInputFiles` 喂测试图后 `.imb-modal` 580×521 @(341,254) 打开：标题「裁切头像」、canvas 裁切区、缩放 range×1、预览、取消/完成；点「取消」→ modalOpen=false、名字/角色不变、imgSrc=null（未误保存） | ✅ |
| ⑧ | quiet 视觉 + 命中区 ≥24×24 | 铅笔 `.imb-employee-edit-icon`=24×24 border-box + padding 5px（SVG 视觉仍 14px，layout 足迹仍 14×14）。`elementFromPoint` ±48px/2px 实测命中区：#1 name 98×32 @(596,62)、role 98×24 @(596,94)，min(w,h)≥24。**布局守恒**：h2 32 / 角色行 21 / info 59 / avatar-row 72 / head padding-bottom 16，与 @5 自验值逐项一致。**二阶修复**：#1 角色行 `overflow:visible`（构建 CSS 已生效），同时 `.imb-employee-edit-text` 保有 nowrap/hidden/ellipsis，文本换 300 个 A 实测 `scrollWidth 4333 > clientWidth 654`（省略号仍生效）。`overflowX`=false | ✅ |
| ⑨ | 测试环境自验 + 键盘可达 + 证据图 | 铅笔为原生 `<button type="button">`（tag=BUTTON）可 Tab 聚焦，Enter/Space 由按钮默认行为触发 click；证据 5 张（见上） | ✅ |
| ⑩ | 命中区按元素打点实测（@0 id 190 收紧项） | 见 ⑧；`elementFromPoint` 网格打点而非 rect（全局 `* { box-sizing: border-box }` 下 padding 不会放大命中盒） | ✅ |

**复测补充项**（原第 6 条口径，未单列照查）：其他字段无回归。#1 保留 `#emp-prompt-1` 系统提示词 textarea 760×250 @(439,181) 与 4 个 select（760×38 @ y=681）；0 号保留系统提示词 + 技能集 + 使用的模型 + 思考强度（无「关联 MCP」，与上游 `isAssistant` 一致）；「移除」按钮仅非 0 号显示。

## 口径说明（已裁定，非待确认）

内置 0 号员工**同样**纳入 hover 铅笔原地编辑：依据 Boss 第二条原话（m00211）「这样在员工浏览界面就有且仅有一组员工名称和角色显示了」，该口径取代第一条（m00146）「除内置 0 号员工之外」的 carve-out（@0 于 m00096 转述裁定）。

0 号员工的特殊点仅剩：不显示「角色」编辑入口（`isAssistant` 分支原本就不渲染角色输入框，且 0 号的角色由内置逻辑管理）——即 0 号只获得**名字**的 hover 编辑，角色维持只读显示。若 Boss 要求 0 号也能编辑角色，再单独确认。

## 处理记录

| 日期 | 操作 | 结果 |
| --- | --- | --- |
| 2026-10-18 | 实测 0 号与非内置员工的详情页 DOM | 确认顶部名字/角色显示与 `imb-field-row` 输入框内容完全重复 |
| 2026-10-18 | 依据 Boss m00211 口径修订 0 号员工范围（@0 于 m00096 转述） | 0 号员工也纳入「移除输入框 + hover 原地编辑」，仅名字可编辑、角色只读 |
| 2026-10-18 | 为取证在测试实例新建 1 名员工并截图 | 拿到非内置员工分支的证据（`003-employee-detail-non-assistant.png`） |
| 2026-10-18 | @0 m00157 正式派 @5 实现，口径=全员工统一（含 0 号）+ 头像移到名字/角色左侧 + 0 号仅名字可编辑 | 验收标准改为 9 条版；负责人改为 @5 |
| 2026-10-18 | 观察到工作区 `employee-detail/index.tsx` +168/−44、`index.css` +58，未跟踪 `evidence/003-hover-tooltip.png`、`003-narrow-assistant.png` | @5 已开工，尚未提交；复测待 @0 给提交命令 |
| 2026-10-18 | 读 @5 未提交 diff（只读，未驱动 GUI）：`DetailHead` 改为组件内 `.imb-detail-head`（avatar-row 保留、头像与名字/角色同行）；新增 `beginEdit/commitEdit/cancelEdit` + `fieldDoneRef` 防重复提交；铅笔 `.imb-employee-edit-line` + `IconEdit` `.imb-employee-edit-icon`，Tooltip = `t("Edit")`；0 号角色为纯 `.imb-sub` 只读 | 实现与 9 条口径逐条对得上 |
| 2026-10-19 | @3 独立复测（PID 572874 / `index-CjJNZ0tY.css`，未重启未重建）：10/10 全过，含 @0 id 190 三项收紧（布局守恒、省略号仍生效、命中区打点实测）；证据 5 张；测试改动已还原 | 状态 → `fixed-verified`，待 @0 关案 |
