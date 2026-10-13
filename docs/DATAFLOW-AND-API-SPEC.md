# 数据流与接口规范

本规范按用户于 2026-10-12 的明确要求制定。Semantic Scholar 是正式数据源；架构升级不得将其删掉或静默禁用。

## Semantic Scholar 必须保留的能力

使用官方 Academic Graph API：`https://api.semanticscholar.org/graph/v1/`。按本轮核对的[官方接口规范](https://api.semanticscholar.org/api-docs/)执行；外部接口变化时重新验证。

| 能力 | 官方接口 | 数据流规则 |
|---|---|---|
| DOI 元数据 / paperId 解析 | `GET /paper/DOI:{encodedDOI}` | DOI 先归一化，再编码路径；校验返回 `externalIds.DOI`；请求所需字段，保留返回的 paperId |
| 标题检索 | `GET /paper/search` 或 `/paper/search/match` | 检查标题、作者、年份和 DOI 一致性；不得仅凭第一条结果决定身份 |
| 参考文献 | `GET /paper/{paper_id}/references` | 使用 `citedPaper`；方向是原文引用的文献；跟踪分页和无法解析的记录 |
| 被引文献 | `GET /paper/{paper_id}/citations` | 使用 `citingPaper`；方向是引用原文的文献；与 References 数据隔离 |

保留 Semantic Scholar 的独立兜底角色：Crossref/OpenAlex 缺少原文记录或参考文献时，仍尝试其官方接口。其他来源不完整时可以比较独立候选列表，但不得拼接不同来源的编号并宣称是原文顺序。

## 网络、缓存与结果约束

1. HTTP 必须经过应用请求服务；取消信号覆盖查询、分页、补全和退避等待。一个消费者取消不能破坏其他消费者的共享请求。
2. 若配置 API Key，按官方要求使用 `x-api-key` 头。日志和审查证据不得包含凭据。
3. 遵守 HTTP 429、Retry-After 和总请求预算。限流/网络失败、合法空结果及用户取消必须能区分，不得把短暂失败长期缓存成“无文献”。
4. 有 next offset/cursor、达到数量/时间预算、缺失 citedPaper/citingPaper 或元数据解析损失时，结果标为 partial/truncated；不得把首个 100 条页面当作完整文献表。
5. 每条文献保留来源；本地匹配只能增加运行时关联和状态，不得修改已持久化的供应方证据。
6. 缓存必须隔离文库、条目、文献类型、来源/提取模式和全文/局部范围；验证签名和有效期，存储纯数据副本。
7. 本地检索、渲染与导入必须使用操作所属条目/窗口/文库，不依赖稍后变化的全局选中对象。
8. 图谱列表的位置序号不得宣称为原文引用编号；供应方撤稿证据不得被本地复查覆盖。Crossref/OpenAlex/Semantic Scholar 的父 DOI 身份必须验证。
9. 预算覆盖完整供应方操作，包括父查询、队列、补全和分页；整条刷新另外受协调器截止时间限制。预算耗尽不得继续生产新请求，且已有部分结果须保留完整性标记。
10. 缓存同时受数量、单项和总 UTF-8 字节预算约束；返回拥有的数据副本。认证 POST 不缓存，未提供文库的持久缓存操作不得猜测个人库。
11. 原生 DOI 翻译器的结果也须校验请求身份；不得强制改回 DOI 后保留冲突文献的标题/作者。文献导入只创建常规文献类型，规范化 DOI 后写入。
12. 任务身份包括正在使用的附件和检索字段快照。同一父条目不代表同一 PDF；元数据在请求途中改变时，不得提交编辑前的响应。
13. Crossref、OpenAlex 与 Semantic Scholar 的标题查询共用身份选择规则：先核验候选，再检查唯一身份；结果排序不能作为身份证据。只有一个通过核验的 DOI/来源 ID 才能自动采纳，已有作者/年份需获得对应佐证。统一 DOI 解析器按来源回退，单个来源故障不能跳过后续 Semantic Scholar。
14. 列表完整性在选择前统一计算，并贯穿缓存与界面。status=partial、数量缺口、混合/跳号编号及坏记录损失都不能被改为 success。逐条隔离坏记录；部分查询没有可用记录时按 unavailable 处理，不能当成确认空文献表。
15. OpenAlex 分页按验证后去重的有效记录计数，不能因重复行达到原始行数就提前结束。缺失 related_works 不代表确认没有相关文献。缓存签名包含检索策略版本；新身份核验规则不能继续读取旧策略的结果。

## Zotero 集成约束

逐项对照[Zotero 10 开发说明](https://www.zotero.org/support/dev/zotero_10_for_developers)和实际安装源码；使用原生 ItemPaneManager、数据对象、事务和受支持的 Reader/结构化文本服务。不得调用已移除的单选集合 getter、CookieSandbox、fulltextWord 等旧接口。

区分“被移除的旧接口”和“当前可用但属于内部实现的接口”。若尚未找到可保持功能质量的公开替代，明确记录边界，不能把内部调用称为公开稳定接口。

## 必要验收

- Crossref 与 OpenAlex 都缺失时，Semantic Scholar 官方接口仍能提供候选。
- DOI 元数据、标题检索、references、citations 均保留；引用方向正确。
- 标题相同而 DOI 不同不得合并。
- 分页、缺失记录、限流、取消、迟到响应及缓存失效均有测试。
- 测试只读取或写入隔离配置和文库；受控供应方响应与真实在线验证分别标注。
