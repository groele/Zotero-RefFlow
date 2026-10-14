# RefFlow 名称、插件 ID 与 Zotero 11 兼容声明

> 此文保留 11.0.3 本地候选版的修改及测试历史。当前发布版本重设为 **10.0.0**，标签 **V10**；最新安装包及校验见 [V10 版本记录](V10-RELEASE-2026-10-14.md)。

日期：2026-10-14。候选版本：11.0.3。此轮完成本地修改与验证，未提交、推送、创建标签或 GitHub Release。

## 当前身份

| 项目 | 当前值 |
| --- | --- |
| 插件名称 | Zotero RefFlow |
| 插件 ID | `refflow@groele.github.io` |
| npm 包 / XPI | `zotero-refflow` / `zotero-refflow.xpi` |
| chrome / Fluent / 设置 / DOM 前缀 | `refflow` |
| Zotero 运行时对象 | `Zotero.ZoteroRefFlow` |
| 兼容声明 | 最低 `10.0.6`，最高 `11.*` |
| 项目 | https://github.com/groele/Zotero-RefFlow |
| 未来更新清单 | https://raw.githubusercontent.com/groele/Zotero-RefFlow/main/update.json |
| 未来下载地址 | https://raw.githubusercontent.com/groele/Zotero-RefFlow/main/zotero-refflow.xpi |

源码清单、更新模板、打包校验、单元测试、原生测试工具与三种语言设置页同步更新。保留原作者 Polygon / MuiseDestiny 署名、AGPL-3.0-or-later 许可和上游项目入口。平台适配修复继承此前 [Gecko 153 适配](GECKO153-ADAPTATION-2026-10-14.md)。

## 安装与配置迁移

Zotero 将新 ID 视为独立插件。先停用 RefNexus，再安装候选 `build/zotero-refflow.xpi`；确认工作正常后可卸载旧插件。不能通过旧 ID 的自动更新原地替换。不要同时启用两者。

首次启动只复制旧插件明确设置过的已知偏好，包含布尔、整数、字符串和 API Key；已有 RefFlow 用户设置优先。旧偏好保留，不删除，不打印密钥。完成标记使复制只进行一次；失败时不写完成标记，可重试且不覆盖已复制值。

旧参考文献缓存文件保留，新缓存按需重建。文库中的批次 ID、日志与批次标签继续使用原数据格式，以保留撤回旧批次的能力。这些 `refnexus` 数据键和历史发布校验脚本不是未迁移的插件公开身份。

## 验证

| 检查 | 结果 |
| --- | --- |
| 单元测试（含偏好迁移、错误重试及身份 / 兼容回退拒绝） | 243/243 |
| TypeScript、生产构建、bootstrap 与设置脚本语法 | 通过 |
| Windows / Zotero 10.0.6 / Gecko 140 | 99/99 原生场景，14 组检查全部通过 |
| Windows / Zotero 11.0-dev.5+dac1ad489 / Gecko 153 | 99/99 原生场景，14 组检查全部通过 |
| Zotero 10 / 11 重启后的插件加载及设置页 | 各 2/2 通过 |
| 两代宿主的维护者、项目及设置页链接检查 | 各 2/2 通过 |
| XPI 完整性 | ZIP 完整，28 个文件与构建目录逐项一致 |

测试分别使用独立 profile 和 SQLite 文库。新包身份、实际安装清单、更新地址、设置迁移、设置页、菜单、系统复制粘贴、PDF、图谱、导入撤回及反复禁用启用均在真实宿主中检查。原生身份迁移夹具同时验证旧整数偏好复制、新偏好优先及旧偏好保留。重启与设置页维护信息报告随汇总记录保存。

记录位于 `tests/refflow-unit.log`、`tests/refflow-zotero10-final.json`、`tests/refflow-zotero11-accepted.json` 及其子报告，汇总为 `tests/refflow-verification.json`。一次并行运行中，两宿主共用 loopback 故障服务器，服务器全局并发计数造成一个测试失败；串行重跑 Zotero 11 全部通过。另一次新增校验错误使用 HTTP 辅助方法读取 `jar:` URI，修正为读取实际安装的 XPI ZIP 后通过。中间记录保留，不能作为最终验收结果。

第一次 Zotero 11 重启检查与另一独立 profile 的设置页元数据测试同时启动，报告运行时未就绪；未取得当次插件启动错误日志，原因尚未确定。随后两次串行重启检查均 2/2 通过。保留 `tests/refflow-zotero11-restart-first.json` 和 `tests/refflow-zotero11-restart-second.json`；不能用后续通过的结果声称已修复该次启动失败或完成长期稳定性验证。

在线服务使用受控响应和 loopback 故障服务器，不能据此声称所有实时服务及配额都已验证。宿主仍输出已有 `uncaught exception: undefined` 等消息；未发现此插件 bundle、Fluent 或版本格式错误。Zotero 11 尚为开发版，按用户要求将声明上限扩展到 `11.*`，不代表未来稳定版、其他操作系统、全部插件组合或长期运行已完整验收。

## 候选交付与仓库状态

候选包：`build/zotero-refflow.xpi`，233,260 字节。

SHA-256：`a61c0635501c496a992c880cbc81ad69d92d5ba439009677ebf9c09c1a92e7e6`。

配套清单：`build/update.json`。校验详情：`build/verification.json`。版本、ID、下载路径、兼容范围及 SHA-256 相互一致。未来更新 URL 已配置，但候选文件尚未上传。

构建使用 `REFNEXUS_NO_PROMOTE=1`；新增等效 `REFFLOW_NO_PROMOTE=1`。旧根目录 RefNexus 11.0.2 正式 XPI 和 `update.json` 保留；旧 XPI SHA-256 仍为 `622015b65a587e94fd6fd04652eae4e8b23a7f2a9353103b88d9004721dd3054`。

修改前快照：工作区上一层 `backups/refflow-identity-20261014-154139`。实现 checkout 仍在 `bootstrap` 分支并跟踪 `origin/bootstrap`；新增 `refflow` remote 指向新仓库，保留 `origin` 原作者仓库。已有大量此前修改，未将它们混入此次提交或推送。只读收尾结果在 `tests/refflow-closeout.json`。

复验时，两宿主的完整 HTTP 压力测试必须串行执行，以免共享故障服务的全局计数相互干扰。
