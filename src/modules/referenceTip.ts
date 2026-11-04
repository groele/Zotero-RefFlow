import { config } from "../../package.json";
import TipUI from "./tip";
import Utils from "./utils";
import { getString } from "../utils/locale";

export interface ReferenceTipContext {
  utils: Utils;
  tips: Map<Window, TipUI>;
}

/**
 * Creates and displays the reference hover tip popover with multi-source metadata.
 */
export function showReferenceTipUI(
  refRect: Rect,
  reference: ItemInfo,
  position: string,
  idText: string | undefined,
  localOnly: boolean = false,
  win: Window = window,
  ctx: ReferenceTipContext
): TipUI {
  const toTimeInfo = (t: string) => {
    if (!t) return undefined;
    const info = new Date(t).toString().split(" ");
    return `${info[1]} ${info[3]}`;
  };

  ctx.tips.get(win)?.clear();
  const tipUI = new TipUI(ctx.utils, win);
  ctx.tips.set(win, tipUI);
  tipUI.onInit(refRect, position);
  const refText = reference.text!;

  const getDefalutInfoByReference = async (): Promise<ItemInfo> => {
    const localItem = reference._item;
    let info: ItemInfo;
    if (localItem) {
      info = {
        identifiers: {},
        authors: localItem.getCreators().map((i: any) => i.firstName + " " + i.lastName),
        tags: localItem.getTags().map((i: any) => {
          const ctag: any = localItem.getColoredTags().find((ci: any) => ci.tag === i.tag);
          return ctag ? { text: i.tag, color: ctag.color } : i.tag;
        }),
        abstract: localItem.getField("abstractNote") as string,
        title: localItem.getField("title") as string,
        year: localItem.getField("year") as string,
        primaryVenue: localItem.getField("publicationTitle") as string,
        type: "",
        source: reference.source || undefined
      };
    } else {
      info = {
        identifiers: reference.identifiers || {},
        authors: reference.authors || [],
        type: "",
        year: reference.year || undefined,
        title: reference.title || idText || "Reference",
        tags: reference.tags || [],
        text: reference.text || refText,
        abstract: reference.abstract || refText,
        primaryVenue: reference.primaryVenue || undefined
      };
      const url = ctx.utils.identifiers2URL(info.identifiers);
      if (url) info.url = url;
    }
    return info;
  };

  let coroutines: Promise<ItemInfo | undefined>[];
  let prefIndex: number;
  let according: string;

  if (localOnly) {
    according = "Zotero";
    prefIndex = 0;
    coroutines = [getDefalutInfoByReference()];
  } else if (reference?.identifiers.arXiv) {
    according = "arXiv";
    coroutines = [
      getDefalutInfoByReference(),
      ctx.utils.API.getArXivInfo(reference.identifiers.arXiv, tipUI.signal)
    ];
    prefIndex = parseInt(Zotero.Prefs.get(`${config.addonRef}.${according}InfoIndex`) as string);
  } else if (reference?.identifiers.DOI) {
    according = "DOI";
    coroutines = [
      getDefalutInfoByReference(),
      ctx.utils.API.getDOIInfoBySemanticscholar(reference.identifiers.DOI, tipUI.signal),
      ctx.utils.API.getDOIInfoByCrossref(reference.identifiers.DOI, tipUI.signal)
    ];
    prefIndex = parseInt(Zotero.Prefs.get(`${config.addonRef}.${according}InfoIndex`) as string);
  } else {
    according = "Title";
    const searchTitle = reference.title || reference.text || "";
    coroutines = [
      getDefalutInfoByReference(),
      ctx.utils.API.semanticScholar.byTitle(searchTitle, reference.authors?.[0], reference.year, tipUI.signal).then((paper) => paper ? ctx.utils.API.semanticScholar.toInfo(paper) : undefined),
      ctx.utils.API.getTitleInfoByCrossref(searchTitle, reference.authors?.[0], reference.year, tipUI.signal),
      ctx.utils.API.openAlex.searchWorkByTitle(searchTitle, reference.authors?.[0], reference.year, tipUI.signal).then((oa) => {
        if (!oa) return undefined;
        return {
          identifiers: oa.doi ? { DOI: oa.doi } : {},
          title: oa.title,
          authors: oa.authors,
          year: oa.year,
          type: "journalArticle",
          primaryVenue: oa.venue,
          source: "openalex",
          url: oa.doi ? `https://doi.org/${oa.doi}` : undefined,
          oaUrl: oa.oaUrl,
          tags: oa.citationCount ? [{ text: `Cited: ${oa.citationCount}`, color: "#d9480f", tip: "Citations (OpenAlex)" }] : []
        } as ItemInfo;
      }),
      ctx.utils.API.getTitleInfoByCNKI(searchTitle, tipUI.signal)
    ];
    prefIndex = parseInt(Zotero.Prefs.get(`${config.addonRef}.${according}InfoIndex`) as string);
  }

  if (!Number.isInteger(prefIndex) || prefIndex < 0 || prefIndex >= coroutines.length) prefIndex = 0;

  coroutines = coroutines.map((promise) => promise.catch((error) => {
    if (error?.name !== "AbortError") ztoolkit.log("Tip coroutine error", error);
    return undefined;
  }));

  const sourceConfig = {
    arXiv: { color: "#b31b1b", tip: "arXiv is a free distribution service and an open-access archive for 2,186,475 scholarly articles in the fields of physics, mathematics, computer science, quantitative biology, quantitative finance, statistics, electrical engineering and systems science, and economics. Materials on this site are not peer-reviewed by arXiv." },
    readpaper: { color: "#1f71e0", tip: "ReadPaper academic paper indexing and reading platform" },
    semanticscholar: { color: "#1857b6", tip: "Semantic Scholar is an artificial intelligence–powered research tool for scientific literature developed at the Allen Institute for AI and publicly released in November 2015. It uses advances in natural language processing to provide summaries for scholarly papers. The Semantic Scholar team is actively researching the use of artificial-intelligence in natural language processing, machine learning, Human-Computer interaction, and information retrieval." },
    crossref: { color: "#89bf04", tip: "Crossref is a nonprofit association of approximately 2,000 voting member publishers who represent 4,300 societies and publishers, including both commercial and nonprofit organizations. Crossref includes publishers with varied business models, including those with both open access and subscription policies." },
    connectedpapers: { color: "#35999a", tip: "Connected Papers is a visual tool to help researchers and applied scientists find academic papers relevant to their field of work." },
    openalex: { color: "#d9480f", tip: "OpenAlex is a free and open bibliographic database of global scholarly research with over 250M works, indexing citations and open-access links." },
    DOI: { color: "#fcb426" },
    Zotero: { color: "#d63b3b", tip: "Zotero is a free, easy-to-use tool to help you collect, organize, cite, and share your research sources." },
    CNKI: { color: "#1b66e6", tip: "China National Knowledge Infrastructure (CNKI) academic resource platform" }
  };

  for (let i = 0; i < coroutines.length; i++) {
    globalThis.setTimeout(async () => {
      const info = await coroutines[i].catch((e) => {
        ztoolkit.log("Tip coroutine error:", e);
        return undefined;
      });
      if (!info || tipUI.signal.aborted || win.closed) return;
      const tagDefaultColor = "#59C1BD";
      const tags = (info.tags || []).map((tag: object | string) => {
        if (typeof tag === "object") {
          return { color: tagDefaultColor, ...(tag as object) };
        } else {
          return { color: tagDefaultColor, text: tag };
        }
      }) as any || [];

      if (reference.retraction?.isRetracted) {
        tags.unshift({
          text: getString("relatedbox-retracted-badge") || "🚨 已撤稿",
          color: "#e03131",
          tip: reference.retraction.reason || getString("relatedbox-retracted-reason") || "该论文已被学术期刊或机构撤回"
        });
      }

      if (info.source) {
        tags.push({ text: info.source, ...sourceConfig[info.source as keyof typeof sourceConfig], source: info.source });
      }

      if (info.identifiers?.DOI) {
        tags.push({ text: "DOI", color: sourceConfig.DOI.color, tip: info.identifiers.DOI, url: info.url });
      }
      if (info.identifiers?.arXiv) {
        tags.push({ text: "arXiv", color: sourceConfig.arXiv.color, tip: info.identifiers.arXiv, url: info.url });
      }
      if (info.identifiers?.CNKI) {
        tags.push({ text: "URL", color: sourceConfig.CNKI.color, tip: info.identifiers.CNKI, url: info.url });
      }
      if (reference._item) {
        tags.push({ text: "Zotero", color: sourceConfig.Zotero.color, tip: sourceConfig.Zotero.tip, item: reference._item });
      }

      tipUI.addTip(
        ctx.utils.Html2Text(info.title!)!,
        tags,
        [
          info.authors?.slice(0, 3).join(" / "),
          [info?.primaryVenue, toTimeInfo(info.publishDate as string) || info.year].filter((e) => e).join(" \u00b7 "),
          reference.description
        ].filter((s) => s && s !== ""),
        ctx.utils.Html2Text(info.abstract!)!,
        according,
        i,
        prefIndex
      );
    });
  }

  return tipUI;
}
