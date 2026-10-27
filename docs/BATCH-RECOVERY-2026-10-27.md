# RefFlow 批次结果与定向重试优化（2026-10-27）

## 实现

新增每个侧栏独立的导入结果面板。失败时默认展开，成功时折叠；逐项展示本次输入位置、标题、规范 DOI 与本地化原因。支持复制失败 DOI（去重、排除无 DOI），以及仅重试元数据导入失败项。

- 首次操作捕获父条目、文库、目标集合、失败项元数据和位置。重试不读取之后的界面选择。
- 首次批次已经创建子集合时，重试继续写入同一集合，不另建同名集合；目标集合被删除时明确失败，不换到其他集合。
- 重试期间按钮禁用、面板 aria-busy；重复点击不产生第二次请求。重试完毕聚焦结果摘要；顶层异常恢复按钮并允许再次重试。
- 已成功导入的文献不加入重试队列。无 DOI 仍按现有策略明确失败，不静默创建简略条目。
- 文献导入失败与 PDF 下载失败分别说明。当前重试不覆盖已保存文献的 PDF 下载，也不自动包含停止后尚未尝试的项目。
- 失败列表初次仅创建 100 行，按用户操作每次追加 100 行；复制和重试覆盖完整失败集合，不受当前挂载范围限制。
- 列表排序、筛选和虚拟窗口重绘保留结果；清空、更换父条目和销毁侧栏使旧控件失效。旧操作完成不能把结果写到新父条目的侧栏。
- 文本用 textContent 生成；标题不能注入 HTML。新增文案覆盖中文、英文和意大利文，CSS 限定在 RefFlow 侧栏内。

新增 BatchResults 模块隔离结果恢复逻辑，单卡片与菜单批量导入复用；不修改原 DOI translator、事务去重、批次日志和撤回所有权规则。上一轮键盘导航和悬停提示修复（fb97ccd）一并提交 GitHub。

## 验证

301 项单测、TypeScript、生产构建与版本/标签自检通过。最终评估包在 Windows Zotero 10.0.6 隔离 profile 的 168 个叶子场景通过：新增恢复 16、键盘/悬停 12、几何/编号 19、生命周期 8、附件/日志 8、保护/所有权 31、界面/sidebar 17、DOI/stage3/pipeline/dataflow 57；不重复计数 suite wrapper。

新增 16 项包括：菜单混合结果、复制失败 DOI、只重试失败项与双击防护、原位置保留、无 DOI 复制禁用、重绘保留、旧控件失效、集合删除、顶层错误后的再次重试、切换父项、成功态、205 项失败渐进展示、PDF 失败独立说明，以及亮/暗主题各 280/480 请求宽度。实际截图检查无横向溢出。故障元数据与 PDF 失败对象按测试说明受控；DOI 工作流的两项在线原生查询仍真实执行。

### 测试基础设施

并行启动依赖固定 18796 端口的故障套件时发现服务器生命周期冲突：复用方尚未完成时，拥有服务器的套件先退出并停止服务器，出现 HTTP 0 和附件缺失。为 -WithFaultServer 加跨进程命名互斥，冲突时明确拒绝并要求串行；单独验证互斥拒绝路径通过。最终 DOI 与附件套件按串行方式复跑，完整通过。普通不依赖故障服务器的 profile 仍可独立运行。

中间还保留一次 Windows 拒绝原子替换 JSON 报告的 NotAllowedError；不将未查明原因的文件访问错误归因于产品功能。最终报告使用新文件名且均完整生成。中间失败 JSON 未覆盖删除；以 verification.json 列出的最终证据为准。

## 安装包与发布边界

本次为源码提交任务。构建始终使用 REFFLOW_NO_PROMOTE=1，正式 12.5.5 安装包和 update.json 不变，不移动 v12.5.5 或覆盖已发布资产。评估包复用开发基线版本号，不是新稳定发布；不要把 build/verification.json 中推导出的 12.5.5 URL 误认为此候选字节已发布。

最终评估包：189974 字节，SHA-256 49472c7b704541d4ecde804297eb6e81a4569161f1598bc01d96f80fbfe73f9f。
正式包保留 SHA-256 f95eb5a75ffaf6caa5447c4f2795a1fbee3e97316645a771a732a958fedd3e22。

原始证据、截图、评估包及机器可读清单位于 output/refflow-batch-results-20261027/。未安装到用户主 profile；未新增 Zotero 11、其他系统、屏幕阅读器实读和生产自动更新验收。

## 复现

```powershell
$env:REFFLOW_NO_PROMOTE='1'
npm test
npm run build
python scripts/release-tags.py --self-test
pwsh -NoProfile -File scripts/run-isolated-native.ps1 -ScriptPath scripts/native-batch-results.js -OutputPath tests/native-batch-results.json -Wait -CloseWhenDone
# 以下两个套件按顺序执行，不并行运行 -WithFaultServer。
pwsh -NoProfile -File scripts/run-isolated-native.ps1 -ScriptPath scripts/native-doi-workflow.js -OutputPath tests/native-doi-workflow.json -WithFaultServer -Wait -CloseWhenDone
pwsh -NoProfile -File scripts/run-isolated-native.ps1 -ScriptPath scripts/native-review-details.js -OutputPath tests/native-details.json -WithFaultServer -Wait -CloseWhenDone
```
