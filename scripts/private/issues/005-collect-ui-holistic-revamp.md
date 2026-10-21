# 005 — 从 Collect UI 汲取灵感的整体界面优化：现代、层次丰富、柔和、呼吸感

- 状态：`verified`
- 报告人：Boss
- 负责人：AI Assistant
- 严重程度：enhancement
- 组件/区域：全应用私有视觉层（`src/renderer/private/`：`theme.css`、`overrides.css`、`states.css`）
- 相关提交：`mine` @ `2e785fe`

## 环境

- 分支：`mine`
- 构建：`pnpm run build`
- 运行：`scripts/private/run-live.sh`
- 主机/后端：Linux + Wayland

## 报告描述

Boss：“从 https://collectui.com/ 这个地方汲取灵感，将 imboss 的界面先进行一轮优化和迭代，我希望它现代、层次丰富、柔和、呼吸感强”。

## 设计基准与分析

1. **现状不足**：
   - 目前部分面板（如中栏与主内容区）色阶对比略平，深色模式下层级景深偏扁平；
   - 消息流之间的垂直空隙偏小，缺乏呼吸留白；
   - 卡片边界与投影偏硬，缺少 Collect UI 标杆设计中常见的多层漫反射光影（Ambient Diffuse Shadows）和半透明高光边缘（Specular Rim）；
   - 输入框与浮动面板与背景缺乏柔和融合。
2. **Collect UI 核心设计语言映射**：
   - **层次丰富（Progressive Elevation Stacking）**：
     - 浅色模式：底层画布（`#f2f2f0`）→ 中栏列表（`#f7f7f5`）→ 详情内容面（`#fbfbfa`）→ 卡片/浮动层（`#ffffff`）；
     - 深色模式：底层画布（`#121413`）→ 中栏列表（`#181a19`）→ 详情内容面（`#1e201f`）→ 卡片/气泡（`#252827`）；
   - **柔和发丝线（Hairline Borders & Micro-Glow）**：
     - 使用半透明色阶（如 `rgba(255,255,255,0.06)` / `rgba(0,0,0,0.06)`）替代生硬的实色灰线；
     - 关键操作项和卡片加入极微弱的顶部高光线（`inset 0 1px 0 0 rgba(255,255,255,0.08)`）；
   - **呼吸感与空间韵律（Breathing Room & Rhythm）**：
     - 消息气泡之间增加微空隙（12px → 16px），气泡内边距更加充裕；
     - 会话列表卡片项增加轻量垂直间距，外廓浮动；
     - 底部输入区加入悬浮胶囊感与柔光环；
   - **质感动效（Tactile Easing）**：
     - 统一采用苹果/Linear 级减速贝塞尔曲线（`cubic-bezier(0.16, 1, 0.3, 1)`），交互反馈柔和不生硬。

## 验收标准

- [ ] **高程层次**：浅色与深色模式下形成清晰的 4 级景深梯度，告别单调纯灰。
- [ ] **漫反射光影**：卡片、输入框与浮层采用多停点柔和环境投影（Multi-stop Ambient Shadows）。
- [ ] **空气与呼吸感**：消息流排版更开阔，气泡与卡片不再紧贴拥挤。
- [ ] **触觉与微交互**：按钮与卡片悬停轻微位移、平滑渐显，无突兀跳变。
- [ ] **上游零侵入**：100% 规则收敛在 `src/renderer/private/`，上游文件 0 修改，18 项测试全量 PASS。

## 处理记录

| 日期 | 状态 | 操作人 | 说明 |
| --- | --- | --- | --- |
| 2026-10-21 | verified | AI Assistant | 收到设计需求，拆解 Collect UI 视觉模型，立案建档准备实施 |
