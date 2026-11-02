/**
 * Zotero RefFlow - Architecture Index & Modular Exports
 * 
 * 分门别类整理架构：
 * 1. UI & Panels (视图、面板渲染与浮窗提示)
 * 2. Scholarly Providers (学术数据源客户端与格式化器)
 * 3. Citation & Verification (引用解析、校验矩阵与标题消歧)
 * 4. Importer & Transactions (文献批量导入、归属与事务日志)
 * 5. Graph & Relationships (文献关系图谱与关联面板)
 */

// 1. UI & Panels
export { default as Views } from "./views";
export { default as TipUI } from "./tip";
export { default as ReferenceCards } from "./referenceCards";
export { PaneRenderer } from "./views/paneRenderer";
export { SettingsActions } from "./views/settingsActions";
export { ReferencePipeline } from "./views/referencePipeline";
export { TipContentRenderer } from "./ui/tipContentRenderer";

// 2. Scholarly Providers
export { default as API } from "./api";
export { default as Requests } from "./requests";
export { default as OpenAlexProvider } from "./openalex";
export { default as SemanticScholarProvider } from "./semanticScholar";
export { default as PublisherReferences } from "./publisherReferences";
export { PaperInfoProviders } from "./providers/paperInfoProviders";
export { CNKIProvider } from "./providers/cnki";
export { default as RetractionChecker } from "./retraction";

// 3. Citation, Text Parsing & Verification
export { default as CitationVerifier } from "./verifier";
export { ReferenceTextParser } from "./referenceTextParser";
export { selectUniqueTitle } from "./titleResolution";
export { tryReferenceData } from "./referenceData";
export type { ReferenceResult } from "./referenceRetrieval";

// 4. Importer, Batch Operations & Journal Status
export { default as BatchImporter } from "./batchImporter";
export { importFailureText, importErrorText } from "./importErrors";

// 5. Graph & Network Visualizations
export { default as ConnectedPapers } from "./connectedpapers";
export { RelatedPanelBuilder } from "./graph/relatedPanelBuilder";
export { RelatedItemRenderer } from "./graph/relatedItemRenderer";
export { default as buildGraphData } from "./GraphData";
export { graphColor } from "./graphModel";
