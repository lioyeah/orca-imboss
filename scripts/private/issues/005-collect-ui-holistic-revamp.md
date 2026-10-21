# 005 — 从 Collect UI 汲取灵感的整体界面优化：现代、层次丰富、柔和、呼吸感

- 状态：`fixed-verified`
- 报告人：Boss
- 负责人：AI Assistant
- 严重程度：enhancement
- 组件/区域：全应用私有视觉层（`src/renderer/private/`：`theme.css`、`overrides.css`、`states.css`）
- 相关提交：`mine` @ `9e836e2`

## 环境

- 分支：`mine`
- 构建：`pnpm run build`
- 运行：`scripts/private/run-live.sh`
- 主机/后端：Linux + Wayland

## 报告描述

Boss：“从 https://collectui.com/ 这个地方汲取灵感，将 imboss 的界面先进行一轮优化和迭代，我希望它现代、层次丰富、柔和、呼吸感强”。

## 设计基准与落地细节

1. **层次丰富（Surface Elevation Stacking）**：
   - 浅色模式：底层画布（`#f3f3f1`）→ 中栏列表（`color-mix` 柔和对比）→ 消息工作区 → 纯白卡片（`#ffffff`）与多层漫反射环境阴影；
   - 深色模式：底层画布（`#121413`）→ 中栏列表（`#181a19`）→ 主内容区（`#1e201f`）→ 气泡/卡片（`#252827`）；
2. **柔和发丝线（Hairline Borders）**：
   - 全局边框转为半透明 `rgba(20, 28, 24, 0.08)`（浅色）/ `rgba(255, 255, 255, 0.07)`（深色），消除生硬割裂感；
3. **空气与呼吸感（Breathing Room & Rhythm）**：
   - 对话流消息垂直间隙拉开至 `var(--imb-space-5)`，消息气泡内边距增至 `13px 18px`，文字行高 `1.62`；
   - 会话列表卡片项增设 `2px 8px` 舒适边距，配合高亮左侧指示条与轻盈悬停浮动；
   - 顶部 Header 加入平滑毛玻璃背景与细腻标题微间距；
4. **交互控件精细化（Tactile Cards & Frosted Glass）**：
   - 提问卡片选项升级为独立触觉选项盒，点击与悬停带阻尼微动效；
   - 下拉面板、右键菜单、附件弹窗全量接入 `backdrop-filter: blur(16px)` 真实毛玻璃质感。

## 验收标准

- [x] **高程层次**：浅色与深色模式下形成清晰的 4 级景深梯度，告别单调纯灰。
- [x] **漫反射光影**：卡片、输入框与浮层采用多停点柔和环境投影（Multi-stop Ambient Shadows）。
- [x] **空气与呼吸感**：消息流排版更开阔，气泡与卡片不再紧贴拥挤。
- [x] **触觉与微交互**：按钮与卡片悬停轻微位移、平滑渐显，无突兀跳变。
- [x] **上游零侵入**：100% 规则收敛在 `src/renderer/private/`，上游文件 0 修改，18 项测试全量 PASS。

## 处理记录

| 日期 | 状态 | 操作人 | 说明 |
| --- | --- | --- | --- |
| 2026-10-21 | verified | AI Assistant | 收到设计需求，拆解 Collect UI 视觉模型，立案建档准备实施 |
| 2026-10-21 | fixed-verified | AI Assistant | 实施完成，通过 18 项自动化测试与类型检查，构建通过并落账提交 |
