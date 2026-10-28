> **12.7.1**：新增来源完整性明细、设置页快捷操作和显示开关。[版本说明](docs/releases/v12.7.1.md)。



# Zotero RefFlow


**Zotero Flow Series · 文献发现**

*让研究的每一步衔接起来。 / Connect each step of research.*

检索参考文献、被引文献与相关研究。

[简体中文](README.md) · [English](README.en.md)

[![当前版本](https://img.shields.io/badge/version-12.7.1-245ac7?style=flat-square)](https://github.com/groele/Zotero-RefFlow/releases/tag/v12.7.1) · [下载 XPI](https://github.com/groele/Zotero-RefFlow/releases/download/v12.7.1/zotero-refflow.xpi) · [问题反馈](https://github.com/groele/Zotero-RefFlow/issues)

[产品定位](#overview) · [安装与更新](#installation) · [快速开始](#quick-start) · [核心功能](#features) · [设置与使用](#settings) · [数据、同步与外部服务](#data) · [兼容性与验证范围](#compatibility) · [常见问题](#troubleshooting) · [开发与详细文档](#development) · [系列产品](#series) · [项目来源与许可](#license)

<a id="overview"></a>

## 产品定位

面向追溯研究来源与扩展阅读的研究者，从本地文档和在线来源检索文献关系，在 Zotero 内查看、筛选与导入候选条目。

本插件可以独立安装，按需与系列其他插件组合使用。

<a id="installation"></a>

## 安装与更新

1. 下载 [zotero-refflow.xpi](https://github.com/groele/Zotero-RefFlow/releases/download/v12.7.1/zotero-refflow.xpi)（插件版本 **12.7.1**），不要安装 Source code ZIP。
2. 在 Zotero 打开 **工具 → 插件／附加组件**，从齿轮菜单选择 **从文件安装插件**。
3. 选择 XPI，完成安装；按提示重启 Zotero。

后续可在插件管理器中检查更新。自动检查／安装取决于 Zotero 与该插件的更新设置和兼容范围。升级或迁移前备份重要数据。

更新清单: [update.json](https://github.com/groele/Zotero-RefFlow/blob/main/update.json) · 插件 ID: `refflow@groele.github.io`.

<a id="quick-start"></a>

## 快速开始

1. 选择带有可用标识或附件的文献，打开其参考文献侧栏。
2. 按需刷新，切换参考文献、被引文献或相关文献。
3. 核对来源与匹配结果，再导入需要的条目。

<a id="features"></a>

## 核心功能

| 特色能力 | 能解决什么问题 | 实际边界 |
|---|---|---|
| 可追溯的多来源发现 | 从本地 PDF、网页快照、出版方、Crossref、OpenAlex 与 Semantic Scholar 等获取可用的文献关系线索，并保留来源角色。 | 覆盖度、排序、限流与可用字段由各来源决定；扫描 PDF 需有可用文本层或 OCR。 |
| 方向明确的关系浏览 | 在列表和图谱中区分“参考文献”“被引文献”“相关文献”，支持从一篇论文扩展阅读路径。 | 相似度或共现关系不是引用事实，不能与参考/被引方向混用。 |
| DOI 优先的本地导入 | 在导入候选前规范 DOI、检查重复，并通过 Zotero 的 DOI/translator 路径创建本地条目。 | 无 DOI 时使用明确回退；用户仍应核对目标库/集合、匹配结果和缺失字段。 |
| 可取消的网络与部分结果处理 | 为请求提供超时、取消、合理重试和来源级错误/部分结果提示，避免把失败显示成空结果。 | 外部服务或网络不可用时无法保证完整关系；“未检索到”不表示关系不存在。 |
| 缓存、批次与恢复线索 | 缓存可复用结果，并保留批量导入的提交信息以便在中断后判断和恢复。 | 缓存不替代原始来源；恢复操作需要基于显示的状态和条目匹配审查。 |

<a id="settings"></a>

## 设置与使用

在 **Zotero → 设置 → Zotero RefFlow** 中查看插件偏好页。

在 Zotero 设置中配置在线服务密钥、刷新行为、提示和保存选项。来源选择 Auto 与“自动刷新”是不同设置。

<a id="data"></a>

## 数据、同步与外部服务

- 在线来源包括 Crossref、OpenAlex 和 Semantic Scholar；覆盖度、限流和返回顺序由来源决定。
- 参考文献快照与缓存不等于完整原文书目；扫描 PDF 可能需要 OCR。导入会创建 Zotero 条目。

<a id="compatibility"></a>

## 兼容性与验证范围

| 项目 | 范围 |
|---|---|
| 当前插件版本 | 12.7.1 |
| 清单声明的 Zotero 范围 | `10.0.6` 至 `11.*` |
| 当前说明 | 332 项单测及隔离 Windows Zotero 10.0.6 定向原生检查通过；导入使用受控 DOI 元数据。暗色主题视觉、主 profile 安装、自动更新安装、Zotero 11 和其他系统未验证。 |

插件版本与 Zotero 版本分别管理。兼容声明不等于已验证所有宿主、系统和外部服务；本轮仅验证上述定向行为，未覆盖所有业务流程或主环境安装。

<a id="troubleshooting"></a>

## 常见问题

结果不完整时先看来源、部分结果标记、条目 DOI 与附件文本；“未检索到”不代表不存在引用关系。不同来源的排序不能直接当作原文编号。

反馈时提供插件与 Zotero 版本、系统、操作步骤、预期／实际结果和脱敏错误。

<a id="development"></a>

## 开发与详细文档

普通安装无需开发环境。以下为仓库已有开发入口，涉及原生测试时使用独立配置。

```powershell
npm ci
npm run tsc
npm test
# Evaluation build: do not promote the installer or update feed
$env:REFFLOW_NO_PROMOTE = "1"
npm run build-prod
```

- [数据源与接口规范 / Dataflow and API](docs/DATAFLOW-AND-API-SPEC.md)
- [修复记录 / Repair record](docs/REPAIRS-2026-10-15.md)
- [版本说明 / Release notes](docs/releases/v12.7.1.md)
- [产品简介 / Product profile](docs/brand/PRODUCT.md)
- [品牌规范 / Brand guide](docs/brand/BRAND.md)
- [README 模板 / README template](docs/brand/README-TEMPLATE.md)
- [后续提升清单 / Improvement priorities](docs/brand/IMPROVEMENTS.md)
- [原详细指南 · README.md](docs/reference/README.md)
- [原详细指南 · README.zh-CN.md](docs/reference/README.zh-CN.md)

原详细指南保留功能细节、快捷键、历史验证与完整致谢；其中版本和测试结果属于各自记录时间。

<a id="series"></a>

## 系列产品

| 产品 | 定位 |
|---|---|
| [Zotero RefFlow](https://github.com/groele/Zotero-RefFlow) | 文献发现 · 检索参考文献、被引文献与相关研究。 |
| [Zotero MetaFlow](https://github.com/groele/Zotero-MetaFlow) | 元数据整理 · 校验、规范并补全文献元数据。 |
| [Zotero ViewFlow](https://github.com/groele/Zotero-ViewFlow) | 阅读预览 · 在 Zotero 侧栏预览并复制格式化引文。 |
| [Zotero MindFlow](https://github.com/groele/Zotero-MindFlow) | 知识组织 · 将文献、批注与思路组织为可编辑导图。 |
| [Zotero TaskFlow](https://github.com/groele/Zotero-TaskFlow) | 任务推进 · 将文献研读转化为可追踪的任务与计划。 |
| [Zotero CiteFlow](https://github.com/groele/Zotero-CiteFlow) | 写作引用 · 追踪 Word 文档引用，并连接 Zotero 文献操作。 |
| [Zotero PaperFlow](https://github.com/groele/Zotero-PaperFlow) | 投稿审稿 · 管理手稿、投稿轮次与审稿回复。 |

各插件分别安装和更新；同属一个系列不意味着共享数据库或已自动联通所有流程。

<a id="license"></a>

## 项目来源与许可

**二次开发声明：** Zotero RefFlow 基于 MuiseDestiny（Polygon）的开源插件 [zotero-reference / Ethereal Reference](https://github.com/MuiseDestiny/zotero-reference) 二次开发并独立维护。上游版权、AGPL 义务与适用第三方声明继续有效；本项目不是上游项目或 Zotero 官方发布。

许可: [AGPL-3.0-or-later](LICENSE).

本系列独立维护，并非 Zotero 官方产品。Zotero 及第三方名称、商标与材料归各自权利人所有。

[Release/tag policy](docs/release-tag-policy.md)
