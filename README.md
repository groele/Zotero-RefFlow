# RefNexus for Zotero 10

RefNexus 是一个面向 **Zotero 10.0.x** 的参考文献获取与管理插件。

## 项目来源与二次开发声明

本项目由 [MuiseDestiny/zotero-reference](https://github.com/MuiseDestiny/zotero-reference) 原有 Zotero 插件二次开发而来，并非独立原创项目。我们保留了原项目的基础功能与开源许可，在此基础上重构参考文献抽取、Zotero 10 条目侧栏入口、缓存隔离、在线数据源合并和错误提示。原项目作者、贡献者及其著作权仍归原作者与相应贡献者所有。

本项目遵循原项目的 **GNU AGPL-3.0-or-later** 许可；请一并阅读本目录中的 [LICENSE](LICENSE)。本仓库与原项目作者没有官方隶属或背书关系。

- 原项目：<https://github.com/MuiseDestiny/zotero-reference>
- 二次开发：<https://github.com/groele/Zotero-diy/tree/main/RefNexus-Zotero10>

## Zotero 10 支持范围

插件目标版本为 Zotero `10.0.*`。清理了旧的单选集合 API 用法，改用 Zotero 10 的多选 API；不再承诺 Zotero 6、7、8 或 9 兼容。

## 使用方式

1. 在 Zotero 10 中选中一条文献。
2. 在条目详情侧栏点击 **参考文献** 图标。
3. 选择 `PDF` 或 `Online` 来源，然后点击 **获取参考文献**。
4. PDF 模式会优先使用已打开的 PDF；如果没有匹配的阅读器，会在后台打开该文献的 PDF 附件并读取文本层。

PDF 提取从文末向前扫描，识别中英文参考文献标题并合并跨行条目。扫描件若没有可读取的 PDF 文本层，或文献没有可识别的参考文献区段，插件会返回空结果并显示状态。Online 模式通过 DOI 或题名查询 Crossref、OpenAlex 和 Semantic Scholar；Crossref 或 OpenAlex 提供的列表顺序会保留，其他来源只用于补全缺失列表或丰富匹配条目，避免把不同来源的条目误拼成一份“完整”书目。

## 主要改进

- 使用 Zotero 10 `ItemPaneManager` 注册原生条目侧栏图标和入口。
- 使用 Zotero Reader 中 PDF.js 文本对象读取内容，移除旧的私有 Reader 页面数组扫描逻辑。
- 扫描包含第 1 页，并在发现参考文献标题后停止继续读取前文页面。
- 对页文本按坐标分行，降低多页、跨行和不同字号对解析的影响。
- PDF 缓存按“文库 ID + 条目 key”隔离，并写入新版本缓存文件，避免个人库与群组库串数据。
- 在线参考文献以主数据源顺序为准；不再把未匹配的 OpenAlex 结果追加到书目列表。
- 增加 Zotero 10 条目选择、PDF 缺失和提取失败的可见反馈。

## 安装

从本项目目录中的 `zotero-refnexus.xpi` 安装：在 Zotero 中打开 **工具 → 插件 → 齿轮菜单 → 从文件安装插件**。开发环境也可按 Zotero 插件开发方式将构建目录加载到独立测试配置。

## 开发与验证

```powershell
npm install
npm run tsc
npm test
npm run build-prod
```

当前回归覆盖参考文献解析、缓存库隔离、HTTP 请求去重、在线数据源列表顺序和批量导入基础逻辑。Zotero 10.0.6 隔离实机验证包括：插件启动、原生侧栏图标注册、侧栏按钮调用、PDF Reader 文本读取及带跨行条目的参考文献列表渲染。测试文库和 PDF 夹具均与个人主文库隔离。

## 许可与贡献

提交修改时请保留原项目署名、许可与本 README 中的二次开发说明。欢迎提交 Zotero 10 实机反馈、可复现 PDF 样例及修复建议。
