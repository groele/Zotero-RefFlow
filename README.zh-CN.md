<div align="center">

# Zotero RefFlow

**获取参考文献、施引文献及相关研究，构建更连贯的文献探索流程。**

[English](README.md) · [简体中文](README.zh-CN.md)

![Version](https://img.shields.io/badge/version-12.0.0-blue) ![Zotero](https://img.shields.io/badge/Zotero-10.0.6%E2%80%9311.*-green) ![License](https://img.shields.io/badge/license-AGPL-3.0-or-later-lightgrey)

[下载插件](https://github.com/groele/Zotero-RefFlow/releases/tag/V12) · [问题反馈](https://github.com/groele/Zotero-RefFlow/issues) · [版本发布](https://github.com/groele/Zotero-RefFlow/releases)

**Zotero Flow Series**

</div>

---

## 项目概述

Zotero RefFlow 是 Zotero Flow Series 中独立维护的插件，获取参考文献、施引文献及相关研究，构建更连贯的文献探索流程。 项目侧重在 Zotero 桌面环境中提供清晰、实用的科研工作流程。

## 核心功能

- 从本地 PDF、网页快照、在线索引与出版社资源获取参考文献。
- 在侧栏浏览参考文献、施引文献及相关文献。
- 搜索、排序、复制与批量导入，并识别文献库中已有条目。
- 保留可用缓存，并提示获取失败或部分结果。

## 界面展示

界面与实现细节可参考[项目文档](https://github.com/groele/Zotero-RefFlow/tree/main/docs)（如有）。当前版本截图将在核实实际界面后添加，避免使用过期图片。

## 兼容性

| 项目 | 说明 |
| --- | --- |
| 插件版本 | `12.0.0` |
| 插件 ID | `refflow@groele.github.io` |
| 声明兼容范围 | `10.0.6–11.*` |
| 验证情况 | 现有记录涉及 Windows Zotero 10.0.6 及 Zotero 11.0-dev.5；不代表后续 Zotero 11 正式版本均已验证。 |

兼容性声明不等于列出版本均已完成实机验证。

## 安装指南

1. [下载当前版本 XPI](https://github.com/groele/Zotero-RefFlow/releases/tag/V12)（`zotero-refflow.xpi`）。
2. 打开 Zotero 的 **工具 → 插件**（不同版本的菜单名称可能不同）。
3. 选择 **从文件安装插件**，选中 XPI，按提示重启。

自动更新清单：[update.json](https://github.com/groele/Zotero-RefFlow/blob/main/update.json)。

## 快速开始

1. 从 Release 下载 XPI 并在 Zotero 中安装。
2. 选中文献，在参考文献侧栏刷新获取列表。
3. 切换参考文献、施引文献和相关文献，检查匹配后再导入。

## 配置与注意事项

**2026-10-15 / 10.1.0 修复：** 修复 V10 审查中的十个可复现问题，增加可重建关系图、参考文献窗口化列表和共享请求调度。详见[修复与验收报告](docs/REPAIRS-2026-10-15.md)。撤回旧导入时，缺少用户修改基线的条目会保留，避免在归属不确定时删除数据。

Auto 负责自动选择获取来源；“自动刷新”是另一项设置，默认关闭。

在线获取依赖第三方服务及其速率限制。没有文本层的扫描 PDF 可能需要 OCR。可在 Zotero 设置中配置可选的 OpenAlex API 凭据。

## 开发与测试

在仓库根目录运行以下命令。涉及 Zotero 桌面实机测试时，请先配置项目要求的独立测试环境。

```powershell
npm ci
npm run tsc
npm test
npm run build-prod
```

上述命令为项目提供的开发与测试入口，不表示所有系统环境或集成测试均已通过。

## 文档与支持

[Audit](AUDIT.md) · [Release notes](docs/RELEASE-NOTES.md)

[提交问题](https://github.com/groele/Zotero-RefFlow/issues) · [查看源码](https://github.com/groele/Zotero-RefFlow)

## 致谢与项目来源

Zotero RefFlow 最初基于 [MuiseDestiny/zotero-reference](https://github.com/MuiseDestiny/zotero-reference) 开源项目二次开发，原项目作者为 MuiseDestiny (Polygon)。感谢原作者及贡献者的基础工作。此 Zotero Flow Series 版本独立维护，并非上游项目或 Zotero 官方发布。原作者版权及适用的第三方声明继续有效。

## 许可证

本项目遵循 **AGPL-3.0-or-later**，具体以 [LICENSE](LICENSE) 及适用的第三方版权声明为准。

Zotero 及相关商标归各自权利人所有。
