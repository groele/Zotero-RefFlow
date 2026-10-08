# 10.3.0 出版社适配与获取成功率改进

日期：2026-10-08；Windows / Zotero 10.0.6；基于同一生产 XPI 验证。

## 获取流程与使用方式

**更多 → 来源 → 自动获取（推荐）**。新安装默认自动；已有用户的来源偏好保留。

1. 优先正文 PDF；有可用列表时直接显示，不为了悬浮或丰富元数据再发额外请求。
2. 尝试父论文已保存的 HTML 快照，离线可用。
3. 在线索引：Crossref / OpenAlex；无结果时尝试 Semantic Scholar。
4. 索引未收录或列表不完整时，尝试允许的出版社网页与 PMC 官方 JATS XML。
5. 编号断档、起始编号不是 1 或元数据声明数量不足时，标注部分列表并继续尝试。各来源整表比较，保留较多条目，不拼接编号。
6. 刷新失败时恢复仍有效的自动模式缓存。状态栏显示尝试阶段，悬浮可查看本次尝试记录。

可手动选择 **出版社网页 / XML**，优先快照、网页和 JATS；**PDF** 模式在空结果或解析失败时也自动回退。取消或切换条目后旧结果不能写回当前列表。

## 出版社真实联网样本

下表是单篇样本结果，不是该出版社所有期刊的成功率；次数、覆盖和耗时会受服务变化影响。HTML 解析、XML 解析和索引返回是不同验证层级。

| 实机场景 | 返回数量 | 实际来源 | 本次耗时 |
|---|---:|---|---:|
| PLOS HTML bibliography | 37 | PLOS HTML | 2838 ms |
| Nature through publisher or PMC JATS fallback | 84 | Nature / Springer HTML | 5612 ms |
| PMC JATS DOI lookup and XML references | 84 | PMC JATS | 5232 ms |
| Elsevier (`10.1016/j.cell.2012.11.027`) | 40 | Crossref + OpenAlex | 2533 ms |
| ACS (`10.1021/acsnano.7b05743`) | 59 | Crossref + OpenAlex | 2698 ms |
| APS (`10.1103/PhysRevLett.105.136805`) | 31 | Crossref | 1884 ms |
| RSC (`10.1039/C4CS00265B`) | 50 | Crossref + OpenAlex | 2385 ms |
| Wiley (`10.1002/adpr.202400014`) | 36 | Crossref + OpenAlex | 2874 ms |

Nature 样本：`10.1038/s41586-021-03819-2`；PLOS 样本：`10.1371/journal.pone.0000308`。Nature 网页会因访问环境返回不同响应，本轮 XML 路径另有直接联网测试；不能据某一次 HTML 成功宣称网页永久可访问。

## 格式规则覆盖与解析修复

13 组 HTML 规则：Nature / Springer、Elsevier、Wiley、ACS、RSC、APS、AIP / IOP、Taylor & Francis、PLOS、MDPI、Frontiers、eLife、Science / PNAS。每组有独立的原生 DOM **合成格式样例**测试：限定文献容器、顺序、DOI、父论文冲突和操作文字清理。AIP、IOP、MDPI、Frontiers、eLife、Taylor & Francis、Science / PNAS 等尚未逐个平台完成真实 HTML 样本验证。

- Science：References and Notes 标题、致谢终止。
- Nature：从末尾方法文献表继续扫描主文献表；避免把中间 Methods 正文和作者贡献纳入引文。右栏标题保留列位置。
- Harvard / APA 等：姓氏前缀、Unicode 姓名、悬挂缩进续行；该规则仍是启发式。
- 多页 PDF：重复边缘页眉 / 页脚清理、常见排版连字、保留科学术语连字符。
- 附件选择：正文优先于标题注明 Supporting Information、Supplementary、SI 等的补充文件；当前阅读器仍可明确指定所读附件。
- 网页快照：文件大小或修改时间变化后缓存失效；原生 SQLite 附件测试验证了更新后 2 条变为 3 条，无在线请求。
- 元数据不足：修复两个主索引均无父论文记录时提前返回、未尝试 Semantic Scholar 的问题。
- Crossref 结构化引文：显示作者、题名、刊名、卷期页与 DOI，减少内部字段键名出现在卡片中。

## 性能与边界

- 网页 / XML 解析仅处理有限大小响应和最多 2000 条；完整 HTML / XML 不长期保存在 HTTP 缓存，只持久化解析后的文献元数据。
- PMC 请求串行，间隔至少 350 ms，待执行任务最多 8 个。网页请求单次超时 8 秒、执行预算 10 秒；重复未命中保留 5 分钟，强制刷新清除该记录。
- 父论文 DOI 不一致拒绝读取；无 DOI 的保存网页使用严格题名匹配。受限访问、动态加载、验证码或没有文献表时继续回退，不绕过认证。
- 自动模式使用“编号连续”作为可用性依据，不能证明 PDF 列表完整。缺页、错误附件、图像型 PDF、复合引文、极端排版仍可能失败或缺条。
- JATS 回退只覆盖 PMC 收录且接口允许获取全文的论文，不是所有期刊的 XML 下载服务。
- 原有匿名启动异常 `uncaught exception: undefined` 仍待定位；断言通过不能解释为日志零异常。
- Connected Papers 远程建图、CNKI 账户、长期内存剖析和主配置全部插件组合仍未完整验证。

## 最终验证

- TypeScript：通过；单元测试 **125/125**。
- 实机场景 **74/74**：PDF 与任务 10、压力与故障 22、真实服务 5、出版社与自动模式 28、其他直接场景 9。汇总项不重复计数。
- 安装包：**255123 字节**；SHA-256：`4538f538e2e946d2f4f0ea45686d075bf0589def5f365707e0d2fad9e75e0f41`。
- 真实 PDF、原生图标、导入 / 撤回、偏好设置、同条目重复渲染、双窗口与启停回归均通过。

证据：[完整汇总](evidence/10.3.0/native-summary.json)、[出版社与自动模式](evidence/10.3.0/native-publishers.json)、[版本与散列](evidence/10.3.0/verification.json)、[单元测试](evidence/10.3.0/unit-results.txt)。

复现：先按 README 构建并启动本机故障服务器，再执行 `pwsh -NoProfile -File scripts/run-isolated-native.ps1 -Wait -CloseWhenDone`。不需要下载 Nature / PLOS 整页夹具；真实页面与 API 测试直接联网。

## 官方依据

- [PMC ID Converter API](https://pmc.ncbi.nlm.nih.gov/tools/id-converter-api/)：DOI → PMCID。
- [PMC OAI-PMH API](https://pmc.ncbi.nlm.nih.gov/tools/oai/)：当前接口、JATS、授权全文与串行限速。
- [JATS mixed-citation](https://jats.nlm.nih.gov/publishing/tag-library/1.2/element/mixed-citation.html)：混合与结构化引文。
- [Nature Formatting Guide](https://www.nature.com/nature/for-authors/formatting-guide)：在线方法部分与编号文献组织。
