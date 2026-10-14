# RefNexus：Zotero 11 / Firefox 153 适配记录

> 后续状态：此记录描述首次 RefNexus 适配验收。随后按用户要求更名为 RefFlow，并将兼容上限扩展到 `11.*`；最新身份、包哈希与实机验证见 [RefFlow 迁移记录](REFFLOW-IDENTITY-2026-10-14.md)。下文旧包名称及哈希保留为历史证据。

日期：2026-10-14。源码 / 本地候选包版本：11.0.3。正式发布仍为 11.0.2。

依据工作区《Zotero11-Firefox153-插件适配指南.md》，并实时核对 [Zotero 11 官方开发文档](https://www.zotero.org/support/dev/zotero_11_for_developers)、官方设置页实现及本机 Zotero 10 / 11 开发版源码。

## 实际修复

| 范围 | 原问题 | 修改 |
| --- | --- | --- |
| 设置页 | 根节点内联 `onload`；五个链接内联 `onclick` | 外部 `preferences.js` 捕获宿主非冒泡 `load`，按根节点初始化；代理链接点击；禁用和窗口关闭时释放监听器 |
| 设置页注册 | 未明确默认 XUL 命名空间；无外部脚本注册 | 设置 `defaultXUL: true` 和 `scripts`，与片段中的 XUL 元素及 `html:` 前缀匹配 |
| 菜单状态 | `checked="false"` 在 Gecko 153 仍表示勾选 | 两处菜单改用宿主反射 `checked` 属性，选中和未选中均检查实际属性状态 |
| 菜单命令 | `Promise.resolve(action())` 捕获不到同步异常 | 使用 `Promise.resolve().then(action)`，将同步异常与异步拒绝交给现有错误反馈 |
| 弹出菜单 | 禁用时可残留独立挂在窗口上的菜单及已排队命令 | 销毁菜单及卡片监听器；销毁后的命令不执行；文献类型菜单核对所属条目，避免快速切换后作用到错误条目 |
| 启动 | 等待 Zotero 初始化期间禁用仍可能注册 chrome；异步 hook 失败只记录日志 | 启动代次取消；bootstrap 等待 hook，并在失败时释放部分资源和 chrome 注册 |
| 清理 | 单个宿主注销异常可跳过后面的栏目、通知、计时器、存储及样式清理 | 独立捕获同步 / 异步清理错误；销毁卡片、请求、偏好监听器、样式和 Fluent 文档资源；Views 和图谱销毁可重复调用 |
| 冻结沙箱 | D3 色彩模块赋值创建继承原型上的 `constructor` / `toString`，冻结 `Object.prototype` 后失败 | 构建时只针对 `d3-color/src/define.js`，用 `Object.defineProperty` 创建自有属性，保持描述符行为；不修改宿主内建对象；上游代码结构改变时构建失败以要求复查 |
| 本地化 | 英文 / 意大利文两个完全空消息导致 Fluent 解析错误 | 用合法的 `{ "" }` 空文本表达式保留布局含义 |
| 验证工具 | 原生运行器固定 Zotero 安装路径 | 接受 `-ZoteroPath`，仍强制独立 profile 和数据目录；新增针对性原生测试和 XPI 一致性校验 |

源码与实际打包依赖已检查：没有可执行的 `ownerGlobal`、`CheckboxStateChange`、同步登录管理器、懒加载服务字符串接口、非远程 `browser remote="false"` 或自定义菜单图标迁移需求。现有搜索框没有额外清除按钮。保留 Crossref、OpenAlex、Semantic Scholar 官方 Graph API、出版社 / 快照及 PDF 的现有角色。

## 兼容与交付

本机正式宿主为 Zotero 10.0.6 / Gecko 140；测试开发版为 Zotero `11.0-dev.5+dac1ad489` / Gecko 153，运行中读取版本确认。两个宿主分别使用独立 profile 和独立 SQLite 库，没有打开日常文库。

官方当前仍要求等待 feature freeze 通知后声明 Zotero 11 兼容。候选包因此保留 `10.0.6–10.*`；dev / beta 构建可测试较低上限的包。移除内联事件是面向未来 CSP 的准备，未把当前宿主临时关闭的 CSP 误写为已全面启用。

候选包：`build/zotero-refnexus.xpi`。构建使用 `REFNEXUS_NO_PROMOTE=1`，没有替换根目录正式 XPI、没有推广在线更新清单，也没有上传 GitHub。

## 可复现验证

```powershell
npm test
$env:REFNEXUS_NO_PROMOTE = '1'
npm run build
python scripts/verify-gecko153-package.py
# 先启动 loopback 故障服务，避免把服务未启动误报为插件网络故障
$httpFixture = Start-Process -FilePath (Get-Command python).Source -WindowStyle Hidden `
  -ArgumentList 'scripts/native-http-server.py' -PassThru
pwsh -NoProfile -File scripts/run-isolated-native.ps1 `
  -ScriptPath scripts/native-gecko153.js `
  -OutputPath tests/gecko153-zotero10-delivery.json -Wait -CloseWhenDone -SkipOnline
# 测试开发版时另传 -ZoteroPath <独立开发版 zotero.exe>
Stop-Process -Id $httpFixture.Id
```

`tests/gecko153.test.ts` 覆盖冻结内建对象、设置片段先后加载、窗口隔离、重复事件、启动取消、同步 / 异步启动失败、清理异常隔离及菜单错误反馈。原生脚本检查真实 DOM / XUL 状态、偏好保存、菜单复制和系统粘贴、PDF 提取、受控 HTTP、SQLite、图谱和反复启停。

原始原生记录保存在 `tests/gecko153-*.json`，构建文件和 SHA-256 在 `build/verification.json`。首次全部验收通过后脚本在独立测试库中保存重启标记；用同一 profile 再次启动宿主，会执行两项重启检查并写入 `*-restart.json`。

## 最终验证结果

| 检查 | 结果 | 本地记录 |
| --- | --- | --- |
| 单元 / 冻结沙箱 / 生命周期回归 | 239/239 通过 | `tests/gecko153-unit.log` |
| TypeScript、生产构建、bootstrap / 设置脚本语法 | 通过 | `tests/gecko153-build.log` |
| Zotero 10.0.6 / Gecko 140 | 98/98 原生场景通过，13 组检查全部通过 | `tests/gecko153-zotero10-delivery.json` 及其子报告 |
| Zotero 11.0-dev.5+dac1ad489 / Gecko 153 | 98/98 原生场景通过，13 组检查全部通过 | `tests/gecko153-zotero11-accepted.json` 及其子报告 |
| Zotero 10 重启后的持久加载和设置页 | 2/2 通过 | `tests/gecko153-zotero10-delivery-restart.json` |
| Zotero 11 重启后的持久加载和设置页 | 2/2 通过 | `tests/gecko153-zotero11-accepted-restart.json` |
| XPI 文件一致性 | 28 个文件逐项一致，ZIP 完整；两套隔离配置安装的 XPI 与交付包 SHA-256 相同 | `build/verification.json` |

两代宿主均确认：选中 / 未选中的菜单实际属性状态正确；设置片段能初次加载、切换、关闭后再次打开并保存；真实复制菜单写入 `text/plain`，原生文本框粘贴获得正确中文 / 英文内容；系统剪贴板既有可读格式在测试结束时恢复；41 节点图谱在真实嵌入式浏览器中渲染；禁用后弹出菜单消失、旧命令不再执行，重复启用没有重复栏目。

候选 XPI 大小：232,820 字节。SHA-256：`e965dab810094b689005653c9d62b70a939cb44a1f695861cdd27554d4f4aca5`。根目录 11.0.2 正式 XPI 及其 `update.json` 仍保持原版本，哈希匹配。

原生日志检查未发现 RefNexus bundle 错误、Fluent 解析错误或版本格式警告。日志仍有宿主的 `uncaught exception: undefined`，以及测试快照引发的 HiddenBrowser / 索引消息；本记录不声称所有宿主日志均无错误。

验证属于 Windows 的这一正式版和这一开发版。在线服务主要使用受控响应和 loopback 故障服务；没有验证所有实时服务配额、其他系统、长期运行、全部第三方插件组合或未来 Zotero 11 稳定版。没有执行正式在线更新。未在强制开启 baseline CSP 的完整宿主中验收；当前源码已移除本插件设置片段的内联处理器。

工作区已有大量此前修改，且 `origin/bootstrap` 指向原始项目。只读收尾没有提交或推送。此次修改前的源文件快照保存在工作区上一层 `backups/gecko153-20261014-095315`。
