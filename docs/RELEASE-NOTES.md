# Zotero RefNexus 11.0.2

## v11.0.2 - 2026-10-13

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
