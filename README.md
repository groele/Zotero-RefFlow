# Zotero RefFlow for Zotero 10 / 11

**V10 / 10.0.0** · 参考文献获取、文献卡片与引用关系浏览。加强多来源身份校验、部分结果处理与缓存一致性。

**RefFlow V10（10.0.0）**：名称为 `Zotero RefFlow`，ID 为 `refflow@groele.github.io`，支持范围为 `10.0.6–11.*`。安装包与配套更新清单位于 `zotero-refflow.xpi` 和 `update.json`；发布标签为 **`V10`**。插件版本按维护者要求重新编号为 `10.0.0`，Zotero 兼容范围仍为 `10.0.6–11.*`。项目、反馈和自动更新均指向本仓库。详见[名称及 ID 迁移记录](docs/REFFLOW-IDENTITY-2026-10-14.md)和[平台适配记录](docs/GECKO153-ADAPTATION-2026-10-14.md)。

本项目以用户提供的 `zotero-reference-zotero10.xpi` 的功能组织和使用习惯为基准，对获取流程、稳定性、性能和交互进行二次开发。该 XPI 的实际清单名称是 **Ethereal Reference**，版本 **1.8.17**；文件名中的“zotero10”不代表插件版本号。

## 项目信息

- 二次开发与维护：**[groele](https://github.com/groele)**。
- 项目与下载：[groele/Zotero-RefFlow](https://github.com/groele/Zotero-RefFlow)。
- 问题反馈：[GitHub Issues](https://github.com/groele/Zotero-RefFlow/issues)。
- 自动更新清单：[update.json](https://raw.githubusercontent.com/groele/Zotero-RefFlow/main/update.json)。
- 设置页提供项目、反馈、原始项目、版本说明与免费 OpenAlex Key 入口。
- 当前插件发布标签：`V10`；`refnexus-v11.0.2` 属于旧插件发布记录。

## 来源与二次开发声明

本项目基于 [MuiseDestiny/zotero-reference](https://github.com/MuiseDestiny/zotero-reference) 二次开发，并参考上述 XPI 的紧凑卡片、原生面板按钮、搜索、多选和菜单布局。原作者 Polygon / MuiseDestiny 与原贡献者的署名、著作权及开源许可均保留。本项目与原作者没有官方隶属或背书关系。

采用 **GNU AGPL-3.0-or-later**，详见 [LICENSE](LICENSE)。本目录提供修改后的源代码、构建脚本、测试和安装包。`reference.svg`、`reference-sidenav.svg`、`refresh.svg`、`type.svg` 来源于用户提供的原 XPI；其余新增实现请同时遵循本项目许可。原插件的付费服务、AI 服务与账户权益没有被复刻或绕过。

## 安装与使用

从 [V10 Release](https://github.com/groele/Zotero-RefFlow/releases/tag/V10) 下载 [zotero-refflow.xpi](zotero-refflow.xpi)。在 Zotero 中打开 **工具 → 插件 → 齿轮 → 从文件安装插件**。

从 RefNexus 切换：先停用旧插件，再安装 RefFlow，确认功能和设置后可卸载旧插件。新 ID 会被 Zotero 视为独立插件，不能通过旧 ID 的自动更新原地替换；不要同时启用两者。RefFlow 首次启动复制旧插件明确设置过的偏好和 API Key，保留旧配置，已有 RefFlow 设置优先。旧参考文献缓存文件保留，新缓存按需重建；导入日志格式保留，因此仍可撤回旧批次导入。

1. 选中文献，在右侧图标栏进入 **参考文献**。
2. 点击面板标题旁的刷新图标获取列表。新安装默认 **自动获取**：本地 PDF → 已保存网页 → 在线索引及出版社网页 / XML。已有用户可在 **更多 → 来源 → 自动获取（推荐）** 启用。也可手动选择 PDF、出版社网页 / XML 或在线数据。
3. 文献类型按钮可切换 **参考文献 / 施引文献 / 相关文献**；后两项使用在线服务。
4. 输入关键词过滤；`Ctrl / Cmd` 点选、`Shift` 连选，方向键导航，双击卡片打开已有条目或文献网址。
5. 卡片右侧 `+` 导入文库，`↗` 定位已有条目。更多菜单提供复制、批量导入、排序、OA 下载开关和撤回上次导入。双击数量状态可复制整份列表。
6. 标题悬浮详情优先显示已有元数据，不额外联网。可在插件设置中调整悬浮行为和自动获取。

PDF 模式会复用匹配的阅读器，或在后台打开当前文献的 PDF 附件。没有可读取文本层的扫描件需要先做 OCR。

## 11.0.2 稳定性更新

- 统一 Crossref、OpenAlex 与 Semantic Scholar 的标题身份校验，并在 DOI 解析中接通 Semantic Scholar 回退。
- 统一部分结果、损坏记录与缓存状态，避免错误报告为空或提前结束分页。
- 完整验证与数据流边界见[逻辑结构审计](docs/LOGIC-STRUCTURE-AUDIT-2026-10-13.md)和[版本说明](docs/RELEASE-NOTES.md)。

## 11.0.0 大版本更新

当前版本为 11.0.2。当前版本的变更与验收记录见[11.0.2 版本说明](docs/RELEASE-NOTES.md)及[逻辑结构审计](docs/LOGIC-STRUCTURE-AUDIT-2026-10-13.md)。

- 刷新时保留已取得的卡片；网络失败、取消或空结果不会清掉同一文献类型的可用列表。
- 刷新与排序保留搜索、选择及焦点；排序只处理本地结果，不再触发获取请求，来源编号保持不变。
- 修复获取完成后延迟匹配失效的问题，后续进入视区的卡片仍能匹配本地文库。
- 取消会撤销排队和后台请求；多个面板共享同一个请求时，取消其中一个不会影响其他面板。可选元数据补全超时也会释放其请求。
- 更新清单与安装包在生产构建成功后同步生成，并包含 SHA-256 校验；所有发布路径锁定到本维护者的仓库子目录。
- 156 项单元测试、109 项功能实机场景、5 项实时联网、2 项维护信息及 4 项发布后原生升级检查通过。方法、性能与未覆盖范围见 [11.0.0 检验记录](docs/MAJOR-UPDATE.md)，变更见 [版本说明](docs/RELEASE-NOTES.md)。

## 10.3.3 稳定性与快捷操作

- 完整来源列表优先于条数更多的残缺列表，保留来源顺序及编号。
- 按服务和凭据隔离限流冷却，遵守 Retry-After 与每日额度重置；重复刷新不会绕过冷却，新 Key 可立即请求。
- 排队计入请求总预算；停用时立即结束网络等待、退避和队列。
- 同一列表刷新保留搜索，无结果提供恢复提示；Esc 清除搜索 / 选择，Ctrl/Cmd+C 复制选择的引文。
- 右键菜单捕获原列表；按钮提供可访问名称并保留原生键盘操作。
- OpenAlex 每批补全 100 条；删除旧启动参数及缓存路径兼容分支。
- 144 项单元测试、97 项功能实机场景及 2 项维护信息实机检查通过。详情和边界见 [稳定性说明](docs/STABILITY.md)。

## 10.3.2 侧边栏布局修复

- 修复关系图初始化把 Zotero 原生侧边栏改为纵向、导致图标栏落到内容下方的问题；删除对原生内容区的全局宽度覆盖。
- 首屏最多 8 张卡片主动做本地匹配，后续列表保持按可见区域延迟处理，避免状态依赖后台窗口的监听时机。
- 关系图列表改用 Zotero 10 原生自定义面板，仅在关系图开启且选中常规文献时显示；保留右侧原生图标栏和笔记编辑布局。
- 参考文献侧栏图标使用独立提示文本，保留面板标题；修复热升级留下的已知旧布局修改。
- Windows / Zotero 10.0.6 侧边栏专项 10/10、单元测试 133/133，通过真实 DOM 几何测量及截图验证。详情见 [侧边栏修复记录](docs/SIDEBAR.md)。

## 10.3.1 卡片编号

- 每张卡片显示独立编号；有来源编号时保留，没有时按来源列表位置补齐。
- 排序和过滤后保留编号，三位 / 四位编号自动扩展数字列，保留状态圆点。
- 本次编号专项原生测试证据见 [docs/evidence/10.3.1](docs/evidence/10.3.1)。

## 10.3.0 出版社与获取体验改进

- 自动回退，无 PDF、扫描件或本地提取失败时尝试其他来源；已取得可用 PDF 列表时不额外联网。
- 新增 13 组出版社 HTML 解析规则，以及 PMC 官方 JATS XML 回退；校验父论文 DOI / 标题，避免推荐文章混入。真实样本结果与格式样例的验证层级见 [出版社测试说明](docs/PUBLISHERS.md)。
- 扩展 Science 的 References and Notes、Nature 方法部分独立文献表、延续标题、姓氏前缀与悬挂缩进解析，清理重复页眉页脚。
- 优先正文 PDF，降低补充材料误选；网页快照按文件大小和修改时间使旧缓存失效。
- 不拼接不同来源的编号；发现编号断档或元数据数量不足时尝试其他来源，保留较完整列表与部分标记。
- 提供正在尝试的来源、失败原因提示和离线缓存恢复；已保存网页可离线解析。
- HTML / XML 响应不长期保留在 HTTP 缓存，PMC 单请求串行、限速并限制排队；短期缓存未找到结果以减少重复请求。

## 已有改进

- 保留原 XPI 的紧凑功能布局：原生标题图标、搜索框、原始引文、题名、作者、年份、期刊与卡片操作。
- 面向 Zotero 10 的 `ItemPaneManager`、原生 PDF Reader、偏好设置和撤稿接口；升级工具库至 6.0.0，移除旧 Reader 注入、轮询布局与 RDF 更新配置。
- 修复双栏读取顺序、作者年份格式识别、编号正文误识别及 DOI 吞入后续文本。
- 合并重复任务，隔离条目、文库、附件、来源和文献类型，阻止旧请求覆盖新列表。
- HTTP 有超时、有限重试、并发与排队上限，遵守 `Retry-After`；避免 Zotero 默认重试策略造成长时间等待。
- 缓存使用原子写入、串行保存和退出刷新；持久缓存保留最近 250 个条目，HTTP 缓存最多 500 项。
- 在线列表保留主来源顺序；部分列表显示数量比例。有效缓存可在刷新失败时恢复，施引文献增加备用来源。
- 批量导入按文库串行处理、去重，等待 OA 下载完成；撤回只移除该批次产生的数据与关系，保留已有关系和集合成员。
- 修复 Zotero 10 关系图入口，图形应用首次打开时加载；不同主窗口分别维护界面资源。

OpenAlex 的匿名使用存在预算限制，可在设置中填写自己的免费 API Key。密钥通过请求头发送，保存在本机 Zotero 偏好配置中；密码输入框只隐藏显示，不表示配置文件被加密。参见 [OpenAlex 官方认证说明](https://help.openalex.org/api/authentication/)。

## 兼容范围与验证边界

声明支持 Zotero `10.0.6–11.*`。实际验证对象为 **Windows / Zotero 10.0.6 / Gecko 140** 和 **Zotero 11.0-dev.5+dac1ad489 / Gecko 153**。Zotero 11 尚处开发阶段；此声明按维护者要求扩展，不能视为未来 Zotero 11 稳定版及全部后续版本均已验收。

详细结果、修复理由、性能数据和未覆盖项目见 [AUDIT.md](AUDIT.md)；本轮新增证据见 [docs/PUBLISHERS.md](docs/PUBLISHERS.md)。测试使用独立配置、真实 Reader、真实 SQLite 和真实 HTTP；故障场景另有明确标注的注入测试。功能测试通过不等于任何 PDF 或第三方服务都能得到完整结果。原插件的全部服务功能不在本次等价性承诺范围内。

## 开发与重现实机测试

```powershell
npm ci
npm run tsc
npm test
$env:REFFLOW_NO_PROMOTE = '1'
npm run build-prod
npm run native:fixtures
Invoke-WebRequest https://arxiv.org/pdf/1706.03762 -OutFile tests/native-fixtures/real-arxiv-1706.03762.pdf
```

在另一个终端启动故障测试服务器：

```powershell
python scripts/native-http-server.py
```

再运行生产包的实机测试：

```powershell
pwsh -NoProfile -File scripts/run-isolated-native.ps1 -Wait -CloseWhenDone
```

脚本使用临时独立配置和数据目录。结果位于 `tests/native-final.json` 及同名分组报告（包含出版社测试）；需要查看 `finished` 和 `failed` 字段。临时测试驱动不在生产包中，生产包不启用调试协议。外部服务测试会实际联网，网络故障需结合报告中的 HTTP 状态判断。

提交修改时请保留原项目署名、许可和二次开发说明。
