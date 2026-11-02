/**
 * 浮窗学术源配置与翻译调度器 (Tip Source Providers & Translation Bridge)
 */

export interface TipTagConfig {
  color: string;
  tip?: string;
  url?: string;
  source?: string;
  item?: Zotero.Item;
}

export const TIP_SOURCE_CONFIG: Record<string, { color: string; tip?: string }> = {
  arXiv: {
    color: "#b31b1b",
    tip: "arXiv is a free distribution service and open-access archive for scientific research."
  },
  readpaper: {
    color: "#1f71e0",
    tip: "ReadPaper academic paper indexing and reading platform"
  },
  semanticscholar: {
    color: "#1857b6",
    tip: "Semantic Scholar AI-powered research tool developed at the Allen Institute for AI."
  },
  crossref: {
    color: "#89bf04",
    tip: "Crossref official digital object identifier (DOI) registration agency."
  },
  connectedpapers: {
    color: "#35999a",
    tip: "Connected Papers visual citation and similarity exploration tool."
  },
  openalex: {
    color: "#d9480f",
    tip: "OpenAlex open bibliographic database indexing 250M+ global scholarly works."
  },
  DOI: {
    color: "#fcb426"
  },
  Zotero: {
    color: "#d63b3b",
    tip: "Zotero local research library item."
  },
  CNKI: {
    color: "#1b66e6",
    tip: "China National Knowledge Infrastructure (CNKI) academic resource platform."
  }
};

export async function requestTranslation(text: string): Promise<string | undefined> {
  const provider = (Zotero as typeof Zotero & {
    PDFTranslate?: { api: { translate(text: string): Promise<{ result?: string }> } };
  }).PDFTranslate;
  return provider ? (await provider.api.translate(text))?.result : undefined;
}
