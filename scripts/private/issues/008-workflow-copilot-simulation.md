# 008 — 0号员工流优化协创与动态时序推演仿真预览

- 状态：fixed-verified
- 报告人：老板
- 负责人：Antigravity
- 严重程度：major
- 组件/区域：graph view / workflow copilot / metro-canvas simulation
- 相关提交：70cd326（统一分支轨道图谱基础设施完成）

## 环境

- 分支：`mine` @ `70cd326`
- 构建：`pnpm run build`（electron-vite build，产物 `out/`）
- 启动：`scripts/private/run-test-env.sh`（HOME `~/.imboss-ui-test`，CDP 端口 `9224`）
- 主机/后端：Linux + Wayland
- 数据状态：已有测试数据库、员工列表与工作流方案

## 报告描述

老板提出进一步优化需求：
1. 用户自主搭建时往往只有一个模糊框架（甚至只有一句话或粗略卡片）；
2. 这个图可以先经过 0 号员工（助手）浏览，由它优化交付结构化流（按员工技能匹配分工、自动安插介入与离场节点以省 Token、合理安插审批 Gate）；
3. 图组件能够给出动态演示/时序推演（Dry Run / Simulation），让用户在真正消耗 Token 执行前预览流的走向；
4. 预期流采用虚线轨道（Ghost Rails），执行过程实线落轨，支持员工自主衍生分支。

## 证据文件

- `evidence/008-workflow-copilot-simulation/01-copilot-modal.png`: 0 号员工流架构协创器弹窗，支持输入预期目标并读取团队能力规划。
- `evidence/008-workflow-copilot-simulation/02-copilot-generated.png`: 0 号员工自动生成的敏捷流，展示虚线预期轨道（Ghost Rails）、待触发卡片（○ 预期）与合理安插的员工接入/离场/Gate。
- `evidence/008-workflow-copilot-simulation/03-simulation-running.png`: 时序动态推演（Simulation）运行态，展示点亮的实线轨道、呼吸光圈推演中节点（● 推演中）、已达标节点（✓ 达标）及底部悬浮解说横幅（Simulation Ticker）。

## 架构方案与验收标准

### 验收标准（Hard Assertions）

- [x] **0号员工流优化协创（Workflow Copilot）**：
  - [x] 编排器工具栏增加 `[✦ 助手完善流 / Optimize with AI]` 按钮。
  - [x] 点击支持输入模糊意图或基于当前草稿，0 号员工结合现有团队员工清单（技能/角色/工具）一键输出优化后的工作流。
  - [x] 优化结果包含自动分派员工、精确 Prompt 模板、离场节点（节约 Token）及审批 Gate。
- [x] **时序动态推演仿真（Time-Travel Simulation Preview）**：
  - [x] 画布工具栏增加 `[▶ 演示推演 / Simulate]` 播放控制器（支持播放、暂停、重置、步进）。
  - [x] 播放时光斑与高亮沿圆角道岔平滑流动，卡片依次微光点亮。
  - [x] 底部出现拟真推演解说横幅（Simulation Ticker），动态提示当前时序步骤（谁接入、谁交付、谁离场、卡点暂停）。
- [x] **虚线预期与视觉层次（Ghost Rails & States）**：
  - [x] 未执行的待触发节点/轨道显示为柔和的虚线轨道（`stroke-dasharray`）与幽灵半透明卡片。
  - [x] 正在推演或执行的节点转为高亮实线与呼吸光圈。

## 处理记录

| 日期 | 状态 | 操作人 | 说明 |
| --- | --- | --- | --- |
| 2026-10-21 | open | 老板 | 提出 0 号员工完善模糊流与画布时序推演仿真需求 |
| 2026-10-21 | verified | Antigravity | 立案建档，确立 Workflow Copilot 与 Simulation Ticker 方案 |
| 2026-10-21 | fixing | Antigravity | 实现 `workflow-copilot.ts`、IPC 通道与 MetroCanvas 动态推演控制器 |
| 2026-10-21 | fixed-verified | Antigravity | 隔离测试环境完成 CDP 验证并提取 3 份硬核截图存证，全项通过 |
