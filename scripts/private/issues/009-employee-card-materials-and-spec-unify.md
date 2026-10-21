# 009 — 员工卡质感演进（纸质/PVC/金属/铂金黑金）、全息流光与算力规格整合

- 状态：verified
- 报告人：Boss
- 负责人：AI Assistant
- 严重程度：enhancement
- 组件/区域：员工模块详情页（`src/renderer/components/modules/employees/employee-detail/`）
- 相关提交：`mine` @ `f64c29a`

## 环境

- 分支：`mine` @ `f64c29a`
- 构建：`pnpm run build`（electron-vite build，产物 `out/`）
- 启动：`scripts/private/run-live.sh --no-build`（守护进程 `app-orca-imboss-live.service`）
- 主机/后端：Linux + Wayland

## 报告描述

Boss：“员工卡有两处展示模型和思考强度的地方，我觉得这里可以集成到一处，你觉得呢？另外，可以根据员工的任务完成数量，累积和改变员工的卡面质感，从纸质、塑料……铂金，我觉得网上有现成的质感设计，不过在目前的员工详情卡上我没有看到任何质感，包括你说的全息流光什么的”

## 代码现状与机制分析

1. **模型与思考强度展示重复分散**：
   - 在 `employee-detail/index.tsx:427-440` 的 HUD 指标栏中展示了只读模型名与思考级别；
   - 在底部表单区 `employee-detail/index.tsx:500-555` 又单独放了两个 `<Select>` 下拉框；
   - 导致用户感觉冗余、视觉分散且编辑路径不集中。
   - **优化方案**：HUD 看板专注归集 4 项职场纯战绩指标（参与任务数、累计发言数、已装备技能数、履职总时长）；而算力配置整合为专属的 Bento 模块「🧠 驱动算力与思考中枢 (Compute & Intelligence)」，将模型选择、思考深度仪表、指示器融为一体。
2. **卡面质感平淡与全息流光不可见**：
   - 当前 `.imb-employee-card-face` 仅使用了纯色平铺的 `background: var(--imb-surface)`，缺少真实物理材质的纹理、底纹、微噪点与高光切边；
   - 全息流光使用了极其微弱的 `rgba(..., 0.12)` 且采用 `mix-blend-mode: overlay`，在纯色底板上几乎被完全吞噬，肉眼不可见；且坐标传递在父容器与子元素之间存在层级衰减。
3. **基于任务数的 4 阶卡面材质演进系统（Material Progression）**：
   - **Level 1 (新手 / 新招募, 0~4 任务)**：**原浆纸质卡（Textured Kraft Paper）**
     - 细微纤维噪点纸质底纹、暖白/米灰哑光质感、双色印泥印章边缘、低反射。
   - **Level 2 (进阶 / 5~19 任务)**：**磨砂透光 PVC（Frosted Acrylic PVC）**
     - 亚克力半透明磨砂漫反射、高亮白色发丝斜向透光切线、科技感导光边框。
   - **Level 3 (资深 / 20~49 任务)**：**钛金拉丝金属（Brushed Titanium）**
     - 各向异性金属拉丝反光渐变（45deg 双向金属光影）、冷银金属切角边缘（Specular Bevel）、银箔防伪芯片。
   - **Level 4 (元老 / 宗师 / 50+ 任务，大总管 53 任务直达)**：**曜石铂金黑金（Obsidian Platinum Holographic）**
     - 深邃曜石晶体底座、真·彩虹全息衍射镭射流光（Prismatic Rainbow Foil）、烫金镶边、动态金属徽标与流光反射。

## 验收标准

- [ ] **信息整合**：HUD 看板纯粹呈现 4 项硬核战绩（任务数、发言数、技能数、履职时间），移除冗余只读项；模型与思考配置统一收敛为高集成算力控制 Bento。
- [ ] **可见真实质感（Visible Material Tiers）**：根据 `taskCount` 自动激活对应阶梯的卡面材质类名（`tier-paper` / `tier-pvc` / `tier-titanium` / `tier-platinum`），每阶均具有鲜明可辨的底纹、边框、光泽与材质印章。
- [ ] **真·全息彩虹流光（Prismatic Holographic Sheen）**：鼠标移动时，卡面呈现肉眼清晰可见的绚丽彩虹衍射光带与高光镜面移动（支持深浅两色模式）。
- [ ] **无损向后兼容**：不破坏既有数据与操作逻辑，全量测试 PASS。

## 处理记录

| 日期 | 状态 | 操作人 | 说明 |
| --- | --- | --- | --- |
| 2026-10-21 | verified | AI Assistant | 确证模型重复与材质扁平问题，设计 4 阶材质演进模型与真全息方案，立案建档 |
