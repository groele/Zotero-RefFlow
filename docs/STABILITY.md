# 10.3.3 获取稳定性与使用体验

## 审查后修复的问题

| 问题 | 修复 | 验证方法 |
| --- | --- | --- |
| 较大的残缺列表覆盖后续较小的完整列表 | 完整候选优先；全部来源不完整时才保留条数最多的候选，不拼接编号 | 单元测试及真实 Zotero 获取流程，受控 PDF / API 候选 |
| 429 后反复刷新和切换条目继续请求服务 | 按 origin 和凭据保存有容量上限的冷却状态，遵守 Retry-After、余额及重置秒数；清理缓存不清除冷却，新凭据可立即尝试 | 原生回环 XHR，以及额度、到期恢复单元测试 |
| 排队和执行分别计时；队列唤醒存在抢占窗口 | 同一总截止时间；唤醒等待者前预留并发名额 | 原生 timeout 记录、并发抢占单元测试 |
| 取消传输后 Promise 未结束时，停用仍等到超时；退避不能中断 | 同时结束操作等待、退避及排队，不缓存迟到响应 | 真实原生慢请求、十秒退避及取消不会结束的受控传输 |
| 刷新丢失搜索、无匹配没有恢复提示、行按键抢占按钮 | 保留搜索，添加空结果提示、Esc 和 Ctrl/Cmd+C；行快捷键仅处理行自身焦点；操作按钮提供动态可访问名称 | 原生 DOM、菜单和本地化检查 |
| 菜单打开后列表变化，复制 / 打开使用新列表 | 捕获菜单打开时数据；来源和排序操作检查原条目身份 | 菜单打开后替换列表，再执行原菜单复制 |
| 旧启动参数及缓存路径分支 | 直接使用 Zotero 10 rootURI、PathUtils 和永久数据目录；目录不可用时保留内存缓存；关闭后拒绝迟到写入 | 原生落盘与目录 / 停用边界单元测试 |
| OpenAlex 补全每批 50 条 | 按当前官方上限每批 100 个 ID，继续裁剪 select 字段并限制并发 | 100 个唯一 ID 一次请求，受控供应方 |

100 条 OpenAlex ID 的补全请求数由 2 次降为 1 次，不代表各种网络下的延迟均降低 50%。冷却降低重复请求和无效等待，无法恢复已经耗尽的服务额度。

## 新版本接口边界

仅支持 Zotero 10，使用原生 ItemPaneManager、Reader、PreferencePanes 和 Firefox 140 编译目标。保留既有插件 ID、正常缓存数据及上游署名，删除旧运行时兼容分支。

审查了 Zotero 10 已移除的单选集合 getter、collectionTreeRow、CookieSandbox、fulltextWord 和 required 搜索参数；本插件没有继续调用这些接口。未来主版本发布后需要重新审查并实机验证，manifest 不放开到未经验证的主版本。

官方依据：[Zotero 10 开发说明](https://www.zotero.org/support/dev/zotero_10_for_developers)、[OpenAlex 认证与批量限制](https://help.openalex.org/api/authentication/)、[OpenAlex 错误与重置头](https://help.openalex.org/api/errors/)。

## 验证结果与边界

Windows / Zotero 10.0.6 独立配置和文库中，生产 XPI 通过 **97 项功能实机场景**；另有 **2 项维护信息实机检查、144 项单元测试**通过，TypeScript 检查通过。

- [完整实机回归](evidence/10.3.3/native-final.json)
- [新增 12 项专项](evidence/10.3.3/native-final-native-usability.json)
- [维护信息检查](evidence/10.3.3/metadata-native.json)
- [版本、测试数量及安装包散列](evidence/10.3.3/verification.json)

测试使用真实 DOM、Reader、SQLite、偏好设置、缓存文件和 XHR。HTTP 故障使用回环服务器，完整性候选和批量接口检查使用明确标注的受控供应方。本轮实时外部服务分组显式跳过，不计入通过项；上一轮 OpenAlex 匿名每日预算已耗尽。本轮不声称第三方服务全部可用，不声明其他操作系统、第三方插件组合或未来 Zotero 主版本已经实机验证。

保留中间失败证据：`usability-intermediate-host-key-handling.json` 原先以 defaultPrevented 判断插件抢占按钮，但 Zotero 自身也会消费按键；修正为直接计数插件的行打开动作。`sidebar-intermediate-version-fixture.json` 原先固定要求 10.3.2，现读取当前 package.json，避免正常升级产生误报。

## 快捷操作

- 搜索框按 Esc：清除条件，恢复全部文献。
- 卡片焦点按 Ctrl/Cmd+A：选择可见列表；Ctrl/Cmd+C：复制选择的引文。
- 卡片焦点按 Esc：清除选择；方向键移动；Enter 打开。
- 操作按钮保留原生 Enter / Space 行为。
- 服务限流时使用本地 PDF、快照或已有缓存；填写自己的 OpenAlex 免费 Key 后可立即尝试新的凭据。
