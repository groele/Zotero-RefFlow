# Zotero RefFlow

## 10.1.0 - 2026-10-15

- Fix title-only library/batch identity collisions; corroborate author/year and reject ambiguous candidates.
- Protect later batch reuse and user changes during rollback, including shared relations/collections, edited notes and PDF annotations. Legacy journals without edit baselines retain uncertain objects.
- Unify CNKI Auto routing, completeness, cache quality/persistence settings and GB/T volume/issue/pages mapping; invalidate old retrieval/PDF cache policies.
- Replace the embedded sample graph and private Vue bridge with a source-built, validated SVG renderer and a versioned interface. Add empty states, keyboard operations and dark mode.
- Bound long reference lists to 60 mounted cards while retaining full-list search/selection/copy; share provider admission, scope library invalidation and support import cancellation with incremental attachment journals.
- Preserve Semantic Scholar as a first-class provider, existing plugin identity and update authority. See [repair evidence and limits](REPAIRS-2026-10-15.md); original [V10 audit](FULL-LOGIC-AUDIT-2026-10-15.md) remains available as historical evidence.

## Historical V10 audit checkpoint - 2026-10-15

- Before the 10.1.0 repairs, the audit used version **10.0.0** and left the V10 XPI and update manifest unchanged.
- Added a [step-by-step implementation audit](FULL-LOGIC-AUDIT-2026-10-15.md), isolated native reproduction script, and sanitized evidence. The findings describe known defects; they are not fixes.
- Confirmed problems include cross-batch rollback removing reused items, title-only identity collisions, an unlabelled initial sample graph, incomplete-result handling, persistence-setting inconsistencies, a missing CNKI Auto route and lost GB/T volume/issue/pages.
- Verification: 244/244 unit tests, TypeScript, evaluation build and 28-file package checks passed. Native regressions: 53/54; the failed check hardcodes the former 11.0.2 version. Eleven diagnostic probes completed, reproducing ten defects and confirming stale-response isolation.
- Native audit host: Windows / Zotero 10.0.6 with isolated libraries and controlled external-provider responses. Zotero 11 was not revalidated. An unlocated startup exception remains under investigation.
- Public evidence omits local account and checkout paths. Existing V10 package SHA-256: `5ab078db36712efa4d7c48ba858478e3484976511c86ab2e3fa4e1be834d5dfd`.

## V10 / 10.0.0 - 2026-10-14

- 当前 RefFlow 11.0.3 本地候选版按维护者要求重新编号为 10.0.0；使用独立 GitHub 标签 V10。
- 插件更名为 Zotero RefFlow；新 ID `refflow@groele.github.io`，运行时、chrome 与 Fluent 标识同步迁移。
- 项目、问题反馈、安装包下载及自动更新清单统一指向 `groele/Zotero-RefFlow`。
- Zotero 兼容声明扩展为 `10.0.6–11.*`，包含此前 Gecko 153 生命周期、设置页、菜单及 D3 适配修复。
- 首次启动保留并复制 RefNexus 用户偏好，已有 RefFlow 设置优先；批次导入日志保留原格式。新 ID 需要手动安装并停用旧插件。
- Windows / Zotero 11 开发版的验证不代表未来稳定版完整验收。插件版本重设为 `10.0.0`，GitHub 标签为 `V10`。

### 升级说明

旧 RefNexus 的 ID 与 RefFlow 不同，需要手动安装并停用旧插件。测试过 RefFlow 11.0.3 本地候选包的用户，也需要从文件安装 V10；自动更新不会把同一 ID 的 11.0.3 降级为 10.0.0。

## RefNexus v11.0.2 - 2026-10-13

### Fixed

- Crossref、OpenAlex 与 Semantic Scholar 标题检索共用候选核验和唯一身份选择；统一 DOI 解析器补齐 Semantic Scholar 回退。
- 统一参考文献完整性计算与缓存契约；区分合法空结果和无可用记录的部分结果，逐条隔离畸形数据。
- OpenAlex 分页按验证后的唯一记录计数，避免重复记录导致提前结束。

### Verification

- 224/224 单元测试；151/151 隔离 Zotero 原生场景；TypeScript 与生产构建通过。
- Zotero 10.0.6 实机；供应方响应受控，真实联网服务覆盖不属于本次验收。

### Compatibility

- 保留原插件 ID、官方 Semantic Scholar Graph API、更新地址及原生 Zotero 数据格式；未引入迁移。

## v11.0.1 - 2026-10-09

设置页维护信息移至页面底部，便于访问项目与维护链接。

## v11.0.0 - 2026-10-09

面向 Zotero 10 的大版本更新。

## 获取与交互

- 刷新时保留已有卡片，失败、取消和空结果均保留同一文献类型的可用列表。
- 刷新与排序保留搜索、已选择的参考文献及焦点；原始编号保持不变。
- 排序直接处理本地列表，无需再次获取参考文献。
- 修复获取结束后延迟匹配本地文库失效的问题。
- 获取进度集中显示在面板，减少浮动提示窗口。
- API 缓存保留来源、预计数量和部分列表标记；旧的在线获取缓存签名失效后重新获取，既有 PDF 缓存保持兼容。

## 稳定性与发布

- 请求采用独立订阅取消：取消一个面板不会影响仍需要相同请求的另一个面板；最后一个订阅取消时终止传输。
- 取消排队会立即释放队列容量；可选补全超时会撤销其请求，减少无效后台工作。
- 继续遵守服务限流，取消会打断等待；不会将超过一天的 Retry-After 缩短。
- 生产构建成功后同步生成安装包与更新清单；加入安装包 SHA-256 校验及本插件版本说明链接。
- 更新唯一来源为 `groele/Zotero-diy/main/RefNexus-Zotero10`，使用独立标签 `refnexus-v11.0.0`。
- 设置页明确维护者、二次开发来源、更新仓库、兼容范围及版本说明入口。

## 安装与验证

安装 Release 附件 `zotero-refnexus.xpi`，或在 Zotero 的插件管理中检查更新。此前已经使用 RefNexus 且更新地址指向本仓库的版本可通过该地址升级；原始 Zotero Reference 的不同插件 ID 不会自动迁移。

Windows / Zotero 10.0.6：156 项单元测试、109 项功能实机场景、5 项实时联网及 2 项维护信息检查通过；TypeScript 和生产构建通过。发布后使用真实 10.3.3 安装包完成原生自动升级至 11.0.0，4 项升级检查通过，详见 [检验记录](https://github.com/groele/Zotero-diy/blob/main/RefNexus-Zotero10/docs/MAJOR-UPDATE.md)。

支持 Zotero 10.0.0–10.*；插件版本 11.0.0 不表示兼容 Zotero 11。其他操作系统、未来主版本、长期内存及全部第三方插件组合尚未验证。

## 来源与许可

基于 **Zotero Reference / Ethereal Reference**，原作者 **Polygon / MuiseDestiny**，原项目 [MuiseDestiny/zotero-reference](https://github.com/MuiseDestiny/zotero-reference)；以用户提供的 `zotero-reference-zotero10.xpi` 布局为参考进行二次开发。

二次开发维护者：**groele**。保留原作者与贡献者署名及 **AGPL-3.0-or-later** 许可，与原作者没有官方隶属或背书关系。
