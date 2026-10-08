# 10.3.2 侧边栏布局修复

## 原因与复现

用户截图显示原生图标栏落到文献内容下方。使用实际安装的 Windows / Zotero 10.0.6，在独立配置中加载生产 10.3.1 XPI，复现了相同几何错误。

关系图的旧 `initEditPane()` 无条件设置原生 `item-pane` 的 `orient="vertical"`，并把关系图列表插入内容 deck 和原生图标栏之间；即使关系图关闭也会执行。此外，关系图样式全局强制 `#zotero-item-pane-content` 宽度为 100%。旧插件停用时没有撤销父容器方向修改。

原生无插件对照为横向布局，内容宽 320px，右侧图标栏宽 37px。旧包中图标栏 x=643、y=274.70，落在内容下方；恢复原生结构后图标栏 x=963、y=106.70，与内容顶边对齐。这些坐标是该测试窗口的实测值，不是不同窗口的固定定位参数。

证据：[旧包复现](evidence/10.3.2/sidebar-before.json)、[无插件对照](evidence/10.3.2/sidebar-host-baseline.json)。

## 修复

1. 删除对 Zotero 原生容器方向、内容宽度和直接子节点的持续修改。
2. 使用 `ItemPaneManager.registerSection()` 承载关系图列表，插件仅管理自身面板内部节点。关系图关闭、笔记选择和阅读器上下文中隐藏此库面板。
3. 各主窗口分别拥有关系图和列表，关闭一个窗口不会影响其他窗口。
4. 对热升级遗留的纵向布局执行一次性迁移，仅在原生 deck、图标栏及已知旧面板组成的结构中恢复方向；有未知宿主子节点或图标栏被移动时不应用迁移。
5. 参考文献侧栏图标使用 tooltip-only 本地化键；原生展开面板仍保留标题。

## 验证

- TypeScript 检查通过；133 个单元测试通过，其中 4 个覆盖迁移边界与幂等性。
- 生产 XPI 在真实 Zotero 10.0.6 独立配置中完成 10 项侧边栏专项：冷启动、图标提示、关系图开启、连续开关、不同宽度、笔记切换、两个主窗口、图形关闭、PDF 阅读器、两轮停用/启用和旧布局恢复。
- 断言图标栏位于右侧、与内容顶边对齐、原生宽度为 37px、宿主直接子节点不变，关系图列表仅位于原生自定义面板内。
- 截图直接由实际 Zotero 窗口渲染生成，已视觉审阅：[修复后截图](evidence/10.3.2/sidebar-fixed.png)。
- [侧边栏专项结果](evidence/10.3.2/sidebar-fixed.json)、[安装包版本与散列](evidence/10.3.2/verification.json)。

## 卡片状态与验证边界

连续实机回归中，一项卡片本地匹配断言未通过，队列为空且窗口记录为 `document.hidden=true`。独立测试恢复窗口、稳定父条目选择后匹配通过，但记录仍为隐藏状态，因此不能仅凭这个标志断言根因。

修复为首屏最多 8 张卡片主动执行本地检索，维持最多 4 个匹配任务并行，其余卡片继续按可见区域延迟匹配。卡片状态不再完全依赖首屏的 IntersectionObserver 回调；不增加网络请求。既有失效任务和已移除节点检查仍保留。

中间报告保留：[首次连续回归](evidence/10.3.2/native-final-intermediate-hidden-window.json)、[独立卡片匹配检查](evidence/10.3.2/card-visibility.json)。

在线测试还遇到 OpenAlex 匿名 IP 的每日预算耗尽，相关接口返回 HTTP 429，施引备用来源导致原 OpenAlex 标签断言失败。最终完整回归使用显式 `-SkipOnline` 跳过该实时服务分组，不将跳过计为通过；出版社解析、PDF、SQLite、UI 与故障测试仍执行。此前在线请求的真实失败证据保留在 [在线测试结果](evidence/10.3.2/native-final-native-online.json) 和 [中间汇总](evidence/10.3.2/native-final-intermediate-online-quota.json)。服务预算限制没有在本次布局修复中消除，可使用用户自己的 OpenAlex 免费 Key。

## 维护者与更新信息

本版维护者为 groele，插件描述和原生设置页均声明基于 Zotero Reference / Ethereal Reference（Polygon / MuiseDestiny）二次开发，保留原作者署名和 AGPL 许可。项目、反馈、JSON 更新清单和 XPI 下载均指向 groele/Zotero-diy 的 RefNexus-Zotero10 子目录；保持既有插件 ID 以支持原安装的升级。

最终生产 XPI 的 85 项实机回归和 2 项维护信息专项通过，133 项单元测试通过。5 项实时服务分组明确跳过，没有计入 85 项。设置页的真实界面结果见 [维护信息专项](evidence/10.3.2/metadata-native.json)，全回归见 [最终汇总](evidence/10.3.2/native-final.json)。

## 使用

安装本目录的 10.3.2 XPI，重启 Zotero 后使用。热升级亦有旧布局迁移。当前主配置是否已安装新包需要单独确认，独立配置测试不代表主配置已经升级。

本次没有在测试配置中安装主配置的全部第三方插件；验证的是对 Zotero 原生宿主结构的修复及本插件生命周期。此前记录的匿名启动异常仍保留为未解决项，不能把布局测试通过解读为整个应用启动日志零异常。
