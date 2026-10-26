# Zotero RefFlow 系统优化与 DOI 导入验收

日期：2026-10-25。维护仓库：`groele/Zotero-RefFlow`。本轮为本地源码优化与评估包交付。

## 结果

单项卡片、批量菜单和图谱的新增条目均通过规范化 DOI 调用 Zotero 原生 `Translate.Search`。其入口与 Zotero 顶部“通过标识符添加条目”使用相同的翻译器类型；元数据获取使用 `libraryID: false` 和 `saveAttachments: false`，由 RefFlow 的事务及所有权日志完成保存、分类、关系和撤回。

缺少有效 DOI 时，仍可复用已经在本地库中可靠匹配的文献；否则明确提示核对 DOI 并使用 Zotero 标识符入口，不创建供应方简略条目。现有内部 `allowMetadataWithoutDOI` 显式调用选项保持兼容，三个用户导入入口均不启用它，有 DOI 时也不能用该选项绕过原生核验。

本轮新增 14 项单测，总计 **290/290** 通过；TypeScript、生产模式评估构建和标签规则自检通过。两个独立 Zotero 10.0.6 profile 使用相同最终 XPI，累计 **74/74 个具体原生场景**通过，包括两篇真实 DOI 的在线翻译器导入与重复检查。

## 仓库与基线

- 维护路径：`github-sources/Zotero-RefFlow`，远端 `https://github.com/groele/Zotero-RefFlow.git`，分支 `main`，起始 HEAD `eac4f753eac2f7ca4930c41298c0ee865b17001a`。
- 开始时源版本已由先前工作调整为 `12.5.4`，根目录已发布包仍为 `12.5.3`。本轮沿用现有评估版本，不把本地候选冒充正式发布。
- 先前的 README、设置页版本文字、品牌元数据、package/lockfile、请求层及其测试修改均已保存基线，并逐块比对确认未被覆盖。
- 所有构建设置 `REFFLOW_NO_PROMOTE=1`。根目录正式 XPI 与 `update.json` 保持原字节；没有推送、创建标签或发布 Release，没有安装到用户主 profile。

完整台账、日志、原生 JSON 与截图位于工作区 `output/refflow-system-optimization-20261025/`。

## 修复台账

| 范围 | 已复现问题 | 修改与验证 |
| --- | --- | --- |
| DOI 身份 | 原解析器删除合法末尾配对括号；旧式 SICI 被截断；复制字符及 URL 参数不稳 | 保留配对括号、角括号和 SICI 字符；规范全角、不可见字符和百分号编码；剥离 URL 查询/片段；拒绝含多个 DOI 的单字段 |
| 翻译器候选 | 仅检查第一条返回记录，前置无关记录会掩盖正确记录 | 只从与请求 DOI 相同且有题名的候选中选择，缺失或冲突均明确失败 |
| 并发查重 | 翻译器等待期间，其他导入器新增同 DOI 条目后仍可能重复创建 | 在写事务内部执行不依赖显示缓存的本地查询，复用外部新条目；撤回不会删除它 |
| 目标分类 | 外库、已删除的分类可能被忽略；异步操作容易使用后来的全局选择 | 快照所属窗口、同文库分类；检索前和事务提交前重新校验；失效时不改投其他分类 |
| 事务与撤回 | 首次写入失败可能留下空分类或批次日志；恢复逻辑可能掩盖原错误 | 首条分类/条目/关系/日志原子提交；恢复完整使用记录；恢复失败与原始错误隔离 |
| 原生选择行为 | 新条目保存后 Zotero 自动选择新条目，参考文献面板因此跳转 | 导入保存使用 `skipSelect: true`；原生验收断言选中父条目保持不变 |
| 图谱匹配 | 图谱年份为数字时触发 `query.year.match is not a function` | 候选身份层统一处理数字或字符串年份；图谱真实按钮导入通过 |
| 迟到响应 | 切换父条目后，旧按钮的本地查重结果可能继续导入、定位或覆盖状态 | 操作上下文、DOM 连接和父条目一致性共同校验；新导入前再次检查 |
| 任务所有权 | 不同取消信号可能继承同一任务结果；预算未参与合并身份 | 独立信号分别管理；无信号的同任务仍去重；翻译器超时/总预算纳入身份 |
| 输入快照 | 调用方在等待期间修改引用数组可能破坏结果回填 | 固定引用数组和元数据快照，向原引用对象回填已完成条目 |
| 状态与可访问性 | 英文技术错误直接显示；图谱加号缺少原生按钮语义；重试成功仍显示旧失败 | 中/英/意本地化进度和错误类别；图谱使用可聚焦按钮、忙碌状态；成功时同步按钮和状态栏 |
| 原生测试工程 | 历史脚本仍期待 DOI 冲突后创建简略条目；回环服务需手动管理 | 强化“冲突零写入→正确元数据重试→撤回”断言；新增 `-WithFaultServer` 身份探针、就绪检查和任务进程清理 |

修改前新增的第一组 7 个用例全部失败，对应证据为 `regression-before.log`；已有 276 项基线测试通过，修复后 290 项全部通过。

## 系统审查与回归覆盖

检索入口、来源职责、缓存、完整性标记、网络取消、本地查重、导入事务、批次撤回、图谱及宿主生命周期均已检查。现有 Crossref、OpenAlex、Semantic Scholar、出版商和 PDF 路由保持独立。Semantic Scholar 官方 Academic Graph API 的 DOI、标题、references、citations 能力继续保留。

| 验证层 | 具体场景数 | 结果与范围 |
| --- | ---: | --- |
| 单元测试 | 290 | 全通过；新增 14 项导入、身份、取消与目标集合回归 |
| DOI 专项原生 | 21 | DOI 别名、SICI、候选选择、失败零写入、并发新增、事务回滚、集合删除、超时、独立取消、关系撤回、卡片/菜单/图谱入口；包含下表两项在线 DOI |
| 原生架构/虚拟列表 | 8 | 2,000 条列表、60 卡片上限、全量复制、筛选、滚动、跨虚拟列表分段的键盘导航、独立 SVG 图谱和取消 |
| 原生管线 | 15 | 真实回环 HTTP、共享消费者、期限/取消、补全、原子缓存、引用身份、原生事务及迟到结果 |
| 原生数据流 | 13 | PDF 结构化提取、通知刷新、本地身份、撤稿来源证据、官方 S2 分页/方向及取消、失败与空列表区分 |
| 原生界面 | 7 | 亮暗 × 常规/窄宽共四项，以及无 DOI 错误、补正后重试、离开再返回 |
| 原生宿主/生命周期 | 10 | 原生侧栏布局、图谱切换、多窗口、PDF Reader、两轮禁用/重新启用 |
| 合计原生叶子场景 | **74** | 全通过；不把套件包装项重复计数 |

宽度请求为 480px 和 280px；宿主在窄宽下将侧栏约束为实际 **357px**。报告和 JSON 均保留实际几何值，未宣称在被宿主禁止的 280px 实宽下通过。已检查真实 Zotero 原生截图，按钮可见，无卡片横向溢出；主题使用隔离 profile 的 Gecko 原生配色覆盖，未更改用户环境。

### 真实在线 DOI

| DOI | 原生翻译器返回题名 | 作者数 | 重复导入 |
| --- | --- | ---: | --- |
| `10.1038/nphys1170` | Measured measurement | 1 | 识别已存在，没有新增重复项 |
| `10.1103/PhysRevLett.108.196802` | Coupled Spin and Valley Physics in Monolayers of MoS 2 and Other Group-VI Dichalcogenides | 5 | 识别已存在，没有新增重复项 |

其余供应方响应使用受控 fixture，宿主 DOM、SQLite、事务、Zotero API 和回环 XHR 为真实运行。本轮不把受控通过扩大为所有线上数据源、所有 DOI 或所有出版商始终可用的结论。

## 复现

在维护仓库中执行，先生成测试 PDF，再运行评估构建与原生脚本：

```powershell
$env:REFFLOW_NO_PROMOTE = '1'
npm test
npm run build
python scripts/release-tags.py --self-test
python scripts/make-native-fixtures.py
pwsh -NoProfile -File scripts/run-isolated-native.ps1 -ScriptPath scripts/native-doi-workflow.js -OutputPath tests/native-doi-workflow.json -WithFaultServer -Wait -CloseWhenDone
pwsh -NoProfile -File scripts/run-isolated-native.ps1 -ScriptPath scripts/native-doi-ui.js -OutputPath tests/native-doi-ui.json -Wait -CloseWhenDone
```

这些脚本强制使用独立 profile/数据目录。`-WithFaultServer` 只接受带指定服务身份的 127.0.0.1 回环服务；新建辅助进程在结束后关闭，不关闭其他服务。该选项要求 `-Wait`。

## 交付边界

- 本地评估 XPI 为 `12.5.4`，插件 ID 为 `refflow@groele.github.io`。SHA-256、ZIP/manifest、必要资源及实际原生安装包字节对照记录在输出目录的 `verification.json`。
- 实际宿主为 Windows 上的 Zotero **10.0.6**。manifest 预先声明的 `11.*` 没有扩大；本轮没有对 Zotero 11 或其他操作系统重新验收。
- 两篇真实在线 DOI 成功不代表所有 DOI 均可解析。无结果、缺 DOI、冲突 DOI、题名缺失、超时和网络错误均为可重试失败，用户界面不会自动创建简略条目。
- 现有批次日志仍保存在父条目 Extra，兼容原有撤回与历史批次格式；本轮未迁移存储格式。
- 原生宿主仍记录 `uncaught exception: undefined` 以及 Zotero streamer 的 WebSocket 连接警告。它们已如实保留在原生报告中，本轮不宣称宿主日志完全无警告。
- 代码与证据已保留在本地；没有提交、推送、打标签、发布 Release、主环境安装或正式自动更新验证。

## 核对来源

- [Zotero：通过标识符添加条目](https://www.zotero.org/support/adding_items_to_zotero#add_item_by_identifier)。
- [Zotero 10 开发说明](https://www.zotero.org/support/dev/zotero_10_for_developers)：复数集合选择 API 与新的 Search 约束。
- 实际安装的 `C:\Program Files\Zotero\app\omni.ja` 中 `lookup.js` 与 `xpcom/translate/src/translation/translate.js`：核对 `Translate.Search`、`setIdentifier`、`getTranslators` 与元数据模式；未把当前内部实现称为永久公开 API。
