# 012 — 图谱顶部工具栏与底部推演控制器的高级视觉重塑

- 状态：fixed-verified
- 报告人：老板
- 负责人：Antigravity
- 严重程度：major
- 组件/区域：graph-module / metro-canvas / private styles
- 相关提交：88a2a8e（工作流协创与推演初版）

## 环境

- 分支：`mine` @ `88a2a8e`
- 构建：`pnpm run build`（electron-vite build，产物 `out/`）
- 启动：`scripts/private/run-test-env.sh`（HOME `~/.imboss-ui-test`，CDP 端口 `9224`）
- 主机/后端：Linux + Wayland
- 数据状态：已有工作流与任务图谱

## 报告描述

老板确认功能达到预期，但指出两个工具栏视觉粗糙：
1. **顶部主工具栏**（见证据 01）：控件换行折叠为 3 行，样式杂乱（紫色、绿色、灰色混合，原生 select 边框生硬），缺乏成熟商业产品（如 Linear / Figma / Raycast）的整体感与呼吸感；
2. **底部推演浮动栏（Simulation Ticker）**（见证据 02）：中文文字在小按钮内发生纵向折行换行（「继/续」、「步/进」、「重/播」、「退出/推演」），胶囊阴影与比例生硬。

## 证据文件

- `evidence/012-toolbar-visual-refinement/01-before-topbar.png`: 老板截图的原有顶部工具栏折行杂乱状态。
- `evidence/012-toolbar-visual-refinement/02-before-ticker.png`: 老板截图的原有底部推演栏按钮文字折行截断。
- `evidence/012-toolbar-visual-refinement/03-after-topbar.png`: 重塑后的成熟单行流线型顶部工具栏（CDP 测量高度精准 48px，绝无折行）。
- `evidence/012-toolbar-visual-refinement/04-after-ticker.png`: 重塑后的 Dynamic Island 拟真推演播放控制器（STEP 进度芯片、无折行、媒体播放器交互）。

## 架构方案与验收标准

### 验收标准（Hard Assertions）

- [x] **顶部主工具栏重塑（Linear / Collect UI 级质感）**：
  - [x] 严格单行固定高度（48px），绝不允许折行或堆叠（CDP 实际测量高度：48px，width: 1186px）。
  - [x] 左侧：触觉级分段胶囊（Segmented Pill），平滑高亮切换。
  - [x] 方案选择器：弃用生硬的表单 select，改为成熟的文档标题下拉框（Document Title Dropdown）风格，带悬浮微反馈。
  - [x] 中间：轻量统计指示胶囊（步骤 / 完成 / 运行中），数字与状态圆点对齐。
  - [x] 右侧：统一设计语言的动作群（AI 协创柔和光晕、保存/新建 Ghost 按钮、高对比 Accent 运行按钮、属性抽屉切换）。
- [x] **底部推演胶囊重塑（Dynamic Island 拟真播放控制器）**：
  - [x] 彻底杜绝文字折行（`white-space: nowrap`），控件改为拟真媒体播放器图标控制（播放/暂停、单步步进、循环重放、关闭）。
  - [x] 左侧时间状态标：`STEP 1/8` 紧凑等宽数字胶囊与呼吸脉冲光点。
  - [x] 20px 毛玻璃高斯模糊（`backdrop-filter: blur(20px)`）与柔和环境阴影，高度贴合灵动岛美学。

## 处理记录

| 日期 | 状态 | 操作人 | 说明 |
| --- | --- | --- | --- |
| 2026-10-21 | open | 老板 | 反馈顶部工具栏与底部推演控制器需按成熟/美观设计改进 |
| 2026-10-21 | verified | Antigravity | 立案建档，确立 Linear/Dynamic Island 级视觉重塑方案 |
| 2026-10-21 | fixing | Antigravity | 实现全新单行工具栏与播放器级推演栏 |
| 2026-10-21 | fixed-verified | Antigravity | CDP 硬核复验通过，完成双端视觉重塑与证据归档 |
