# 006 — 统一分支轨道任务图谱基础设施：自动任务监控与自主工作流编排

- 状态：fixed-verified
- 报告人：老板
- 负责人：Antigravity
- 严重程度：major
- 组件/区域：graph view / workflow engine / shared types
- 相关提交：3e5fcee（剥离原有 token 浪费的图后端）

## 环境

- 分支：`mine` @ `b6ecd42`
- 构建：`pnpm run build`（electron-vite build，产物 `out/`）
- 启动：`scripts/private/run-test-env.sh`（HOME `~/.imboss-ui-test`，CDP 端口 `9224`）
- 主机/后端：Linux + Wayland
- 数据状态：已有测试数据库与任务群会话数据

## 报告描述

老板确认原有图后端（在 Prompt 中注入拓扑因果与让 Agent 调工具查图）造成严重 token 浪费，决定放弃图后端。但希望以图的形式实现两个核心功能：
1. 显示 imboss 自动生成的任务之间的关系和当前进展/完成情况；
2. 允许用户自主规划任务流（类似 ComfyUI），并自己决定某个员工何时接入或离开工作；
3. 这两个功能依赖同一个统一基础设施；
4. 图的呈现风格严格参考附图（垂直多轨道分支树、圆角道岔折线、悬浮胶囊卡片、产物缩略图、Badge 标识）。

## 证据文件

- `evidence/006-metro-task-workflow-graph/00-reference-style.png`: 老板提供的参考风格截图（垂直轨道分支树与胶囊卡片）。
- `evidence/006-metro-task-workflow-graph/01-live-mode.png`: 监控态（Live Tasks）界面，点阵网格与自动任务关系树。
- `evidence/006-metro-task-workflow-graph/02-studio-mode.png`: 编排态（Workflow Studio）界面，展示圆角正交轨道曲线、多员工分支（Alice/Bob）、呼吸光圈、红点 Badge 与审批卡点。
- `evidence/006-metro-task-workflow-graph/03-inspector-drawer.png`: 属性抽屉开启初态。
- `evidence/006-metro-task-workflow-graph/04-inspector-fixed.png`: 节点属性详情抽屉完善，支持编辑步骤、切换员工、Prompt 模板、人工卡点及删除控制。

## 架构方案与验收标准

### 验收标准（Hard Assertions）

- [x] **视觉风格（附图还原度）**：
  - [x] 彻底移除旧有乱晃的力导向物理引擎（Force-Directed Simulation）。
  - [x] 采用垂直多轨道布局（Metro-Rail Branching Tree）：主干在左侧，子任务/多员工分支向右平滑道岔转折（圆角正交曲线，R=16px）。
  - [x] 节点卡片采用附图一致的悬浮胶囊卡片风格：白色/暗色卡片、1px 细微发丝边框、微投影、左侧缩略图（图片/产物/员工头像）、中段任务名、右侧状态或 Badge。
  - [x] 支持平滑的缩放（Zoom）与平移（Pan），支持高亮主干路径，非聚焦路径浅色微显。
- [x] **功能 1：自动任务监控（Zero-Token Task Observability）**：
  - [x] 从现有 SQLite（`chats.from_chat_id` + `messages.steps` + 消息产物/图片）直接纯读取投影为分支轨道图。
  - [x] 零 Prompt 注入、零 Agent 工具调用，Token 消耗严格为 0。
  - [x] 真实显示步骤状态（pending、running、completed、interrupted）。
  - [x] 点击任务卡片可直接定位跳转到对应会话与消息。
- [x] **功能 2：ComfyUI 风格自主任务流编排（Workflow Studio）**：
  - [x] 画布支持双模式切换：【任务监控态（Live Tasks）】与【工作流编排态（Workflow Studio）】。
  - [x] 编排态下支持添加节点：任务步骤（Task）、员工介入（Employee Join）、员工退出（Employee Leave）、人工确认审批（Approval Gate）。
  - [x] 支持自定义连线编排前后依赖。
  - [x] 支持保存工作流并在当前工作区执行调度。
  - [x] 支持将自动生成的任务树一键“另存为工作流模板”。

## 处理记录

| 日期 | 状态 | 操作人 | 说明 |
| --- | --- | --- | --- |
| 2026-10-21 | open | 老板 | 提出需求，明确放弃图后端，转向统一分支轨道图基础设施 |
| 2026-10-21 | verified | Antigravity | 立案建档，确立 Metro-Rail 分支轨道图架构与 ComfyUI 编排规范 |
| 2026-10-21 | fixing | Antigravity | 实现 MetroCanvas 渲染器、TaskGraph 数据库投影器与 WorkflowStudio |
| 2026-10-21 | fixed-verified | Antigravity | 通过测试环境验证并截取硬核证据，双模式与附图风格完全一致，验收项全部通过 |
