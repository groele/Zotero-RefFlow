prefs-label = Zotero RefFlow
pane-title =
    .label = { $count ->
        [0] 参考文献
       *[other] { $count } 篇参考文献
    }
    .tooltiptext = 参考文献
relatedbox-download-oa = 下载开放获取 PDF
relatedbox-force-label = 重新获取
relatedbox-copy-label = 复制列表
relatedbox-cancel-label = 取消
relatedbox-cancelled = 已取消获取
relatedbox-loading = 正在获取参考文献…
relatedbox-pages-label = 页
relatedbox-empty = 未找到参考文献，请检查文本层或换用另一来源
relatedbox-timeout = 获取超时，请重试或换用另一来源
relatedbox-scan-limited = 已达到扫描上限，请核对列表完整性
relatedbox-fetch-label = 获取参考文献
relatedbox-source-label = 参考文献来源
relatedbox-select-item = 请先选择一篇文献
relatedbox-fetch-error = 获取失败，请重试
tabpanel-reader-tab-label = RefFlow 引文
relatedbox-number-label = 条参考文献：
relatedbox-refresh-label = 刷新
relatedbox-search-placeholder = 搜索参考文献
relatedbox-batch-import = ⚡ 批量导入
relatedbox-rollback = ↩️ 撤回
relatedbox-copy-all-tooltip = 双击标题复制全部参考文献列表
relatedbox-copy-success = 已成功复制参考文献列表至剪贴板
relatedbox-retracted-badge = 🚨 已撤稿
relatedbox-retracted-reason = 该论文已被学术期刊或机构撤回
relatedbox-no-importable = 未检测到可导入的参考文献
relatedbox-rollback-success = 已成功撤回 { $count } 篇导入文献
relatedbox-no-rollback-batch = 未找到可撤回的批次记录
relatedbox-source-tooltip = 当前来源: { $source } (点击切换模式，长按强制更新)

pane-refresh =
    .tooltiptext = 解析 / 重新获取

pane-type =
    .tooltiptext = 文献类型

pane-more =
    .tooltiptext = 更多操作

cards-in-library = 已在 Zotero 文库中

cards-cited = 被引

cards-show-library = 在 Zotero 中显示

cards-import = 通过 DOI 添加到 Zotero

cards-copy-text = 复制参考文献文本

cards-copy-doi = 复制 DOI

cards-copy-url = 复制 URL

cards-open = 在 Zotero 或浏览器中打开

cards-import-selected = 通过 DOI 添加选中的文献

cards-import-all = 通过 DOI 添加全部文献

cards-source-pdf = 来源：PDF

cards-source-online = 来源：在线数据

cards-sort-original = 排序：原始顺序

cards-sort-recency = 排序：发表时间

cards-sort-cited = 排序：被引次数

cards-type-references = 参考文献

cards-type-citations = 施引文献

cards-type-related = 相关文献

cards-work-not-found = 无法识别这篇文献的 DOI，请补充 DOI 后重试

cards-cached-offline = 网络不可用，显示缓存

cards-partial = 部分列表
cards-source-auto = 自动获取（推荐）
cards-source-web = 出版社网页 / XML
cards-auto-empty = 未找到可用列表；请检查 PDF 文本层、DOI 或网络
cards-number-label = 来源列表编号
cards-no-search-results = 没有匹配的参考文献，按 Esc 清除搜索

graph-pane-title =
    .label = 文献关系图
graph-pane-sidenav =
    .tooltiptext = 文献关系图

pane-sidenav =
    .tooltiptext = 参考文献

cards-kept-results = 保留上次结果
cards-refresh-empty-kept = 未获取新列表，保留上次结果
cards-resolving-doi = 正在识别文献 DOI…
cards-context-changed = 文献或文档已改变，请刷新

cards-list-name = 参考文献列表
cards-rollback-retained = 已保留 { $count } 个被复用或修改的导入条目。
cards-rollback-summary = 已完成批次撤回，{ $count } 个条目移至回收站；复用或修改过的内容予以保留。
cards-rollback-failed = 撤回失败，请检查文库权限和批次记录后重试。

cards-latest-attempt = 本次获取

graph-origins-changed = 起始文献已改变，请重新构建关系图。

cards-importing-doi = 正在通过 DOI 添加到 Zotero…
cards-import-cancelled = 已取消导入；已完成的文献仍保留在 Zotero
cards-import-failed = DOI 导入失败，请重试
cards-import-summary = 已添加：{ $added }；已存在：{ $existing }；失败：{ $failed }
cards-import-complete = DOI 导入完成
cards-import-downloading = 正在下载开放获取 PDF…
cards-import-download-summary = PDF 已下载：{ $downloaded }；下载失败：{ $failed }
cards-import-error-no-doi = 这篇文献缺少有效 DOI，未创建条目。请核对 DOI 后在 Zotero 顶部“通过标识符添加条目”中导入。
cards-import-error-translator = 没有可用的 DOI 翻译器，请更新 Zotero 翻译器后重试。
cards-import-error-identity = DOI 查询未返回相同 DOI 的文献，未创建条目。请核对 DOI 后重试。
cards-import-error-metadata = DOI 返回的题名为空，未创建条目。请稍后重试。
cards-import-error-timeout = DOI 查询超时，未创建条目。请检查网络后重试。
cards-import-error-destination = 目标文库、分类或起始文献已不可用，请重新选择后重试。
cards-import-error-lookup = Zotero DOI 查询失败，未创建条目。请检查网络及翻译器后重试。
