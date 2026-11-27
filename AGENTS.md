# ZakoJob 项目入口

ZakoJob（扎口Job）是个人手填的求职看板。开源静态版默认使用 IndexedDB；私有 Codex Site 版通过同源站点 API 使用本实例的 D1。两端共用岗位业务动作与界面语义。安装、部署与复测步骤见 [README](README.md)。

- 岗位流程与结果遵循[岗位追踪提案](openspec/changes/track-job-applications/proposal.md)。读写、冲突、偏好与备份遵循[数据提案](openspec/changes/persist-job-data/proposal.md)。
- 页面、组件、样式或交互任务先读[正式设计基底](docs/design/DESIGN.md)、[视觉变量](docs/design/tokens.css)及[前端提案](openspec/changes/present-job-board/proposal.md)。视觉取舍见[设计思路](docs/design/DESIGN-RATIONALE.md)。日历与跨岗位时间线方向见[日程视图提案](openspec/changes/view-job-schedule/proposal.md)。
- 两端共用完整的横向时间线：节点与连线按实际登记次序排列，打开卡片定位最新进展，可回看较早记录；历史超出宽度时仅时间线区域横向滚动。卡面按当前状态直接显示常用进展按钮（如「标记二面已面」「标记笔试已完成」按实际状态生成），其余更新统一经一级入口「更多」组织（其中「登记其他进展」承接跳步与选轮次，节点编辑与撤回、编辑岗位资料亦在菜单内），申请结果单独分组；只有辨识信息不足的岗位在标题旁提供「补资料」。手机需要选择或填写时使用底部面板。轻卡片视觉的圆角按组件职责分配，见设计基底。
- 日历与跨岗位时间线已在正式工作台实现：由日程投影从已读取的岗位生成，编辑后回读最新状态、无需刷新；宽桌面（1200px 及以上）岗位列表与日历并排，时间线独占整行，手机从导航进入。方向细节见[日程视图提案](openspec/changes/view-job-schedule/proposal.md)。
