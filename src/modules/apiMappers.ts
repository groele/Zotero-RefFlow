import Utils from "./utils";
import { tryReferenceData } from "./referenceData";

export function createProviderMappers(utils: Utils) {
  const Info = {
    crossref: (item: any) => {
      const types: any = {
        "journal-article": "journalArticle",
        "report": "report",
        "posted-content": "preprint",
        "book-chapter": "bookSection"
      };
      let references: ItemBaseInfo[] = (Array.isArray(item.reference) ? item.reference : []).flatMap((refItem: any, index: number) => {
        if (!refItem || typeof refItem !== "object" || Array.isArray(refItem)) return [];
        try {
          let identifiers;
          let url: string | undefined;
          let text: string;
          let textInfo: any = {};
          if (refItem.unstructured) {
            text = refItem.unstructured;
            textInfo = utils.refText2Info(text);
          } else {
            const volume = refItem.volume ? String(refItem.volume) + (refItem.issue ? `(${refItem.issue})` : "") : "";
            const pages = refItem["first-page"] ? String(refItem["first-page"]) : "";
            text = [
              refItem.author,
              refItem["article-title"],
              refItem["journal-title"],
              volume + (pages ? (volume ? ": " : "") + pages : ""),
              refItem.year ? `(${refItem.year})` : "",
              refItem.DOI ? `https://doi.org/${refItem.DOI}` : ""
            ].filter(Boolean).join(". ");
            if (!text) {
              text = Object.entries(refItem).filter(([key]) => key !== "key").map(([key, value]) => `${key}: ${value}`).join("; ");
            }
          }
          if (refItem.DOI) {
            identifiers = { DOI: refItem.DOI };
            url = utils.identifiers2URL(identifiers);
          }
          let info: ItemBaseInfo = {
            identifiers: identifiers || textInfo!.identifiers || {},
            title: refItem["article-title"] || textInfo?.title,
            authors: refItem?.author ? [refItem.author] : (textInfo?.authors || []),
            year: refItem.year || textInfo?.year,
            text: text,
            type: types[refItem.type] || textInfo?.type || "journalArticle",
            publicationVenue: refItem["journal-title"] || textInfo?.publicationVenue,
            volume: refItem.volume,
            issue: refItem.issue,
            pages: refItem["first-page"],
            number: index + 1,
            url: textInfo?.url || url
          };
          const row = tryReferenceData(info);
          return row ? [row] : [];
        } catch {
          return [];
        }
      });

      const refCount = item["is-referenced-by-count"];
      const resolvedTitle = Array.isArray(item.title) ? item.title[0] : (item.title || "");
      const resolvedAuthors = (Array.isArray(item.author) ? item.author : []).filter(Boolean).map((i: any) => {
        return i.family ? (i.given ? `${i.given} ${i.family}` : i.family) : (i.name || "");
      }).filter(Boolean) || [];
      const resolvedYear = (item.published && item.published["date-parts"]?.[0]?.[0]) ||
        (item["published-print"] && item["published-print"]["date-parts"]?.[0]?.[0]) ||
        (item["published-online"] && item["published-online"]["date-parts"]?.[0]?.[0]) ||
        (item.created && item.created["date-parts"]?.[0]?.[0]);
      const resolvedVenue = Array.isArray(item["container-title"]) ? item["container-title"][0] : (item["container-title"] || "");

      let info: ItemInfo = {
        identifiers: { DOI: item.DOI },
        authors: resolvedAuthors,
        title: resolvedTitle,
        year: resolvedYear ? String(resolvedYear) : undefined,
        type: types[item.type] || "journalArticle",
        text: resolvedTitle,
        url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : undefined),
        abstract: item.abstract,
        publishDate: item.published && item.published["date-parts"]?.[0]?.join("-"),
        source: item.source ? item.source.toLowerCase() : "crossref",
        primaryVenue: resolvedVenue,
        references: references,
        tags: [
          ...(refCount && refCount > 0 ? [{
            text: String(refCount),
            color: "#2fb8cb",
            tip: "is-referenced-by-count"
          }] : []),
        ]
      };
      return info;
    },
    connectedpapers: (item: any) => {
      let info: ItemInfo = {
        identifiers: { DOI: item.doiInfo.doi },
        authors: item?.authors?.map((i: any) => i[0].name),
        title: item.title.text,
        year: item.year.text,
        type: "journalArticle",
        text: item.title.text,
        url: item.doiInfo.doiUrl,
        abstract: item.paperAbstract.text,
        source: "connectedpapers",
        primaryVenue: item.venue.text,
        references: [],
        tags: [
          { text: item.citationStats.numCitations, tip: "citationStats.numCitations", color: "rgba(53, 153, 154, 0.5)" },
          { text: item.citationStats.numReferences, tip: "citationStats.numReferences", color: "rgba(53, 153, 154, 0.75)" }
        ]
      };
      return info;
    },
    readpaper: (data: any) => {
      let info: ItemInfo = {
        identifiers: {},
        title: utils.Html2Text(data.title) as string,
        year: data.year,
        publishDate: data.publishDate,
        authors: data?.authorList.map((i: any) => utils.Html2Text(i.name)),
        abstract: utils.Html2Text(data.summary) as string,
        primaryVenue: utils.Html2Text(data.primaryVenue) as string,
        tags: [
          ...(data.venueTags || []),
          ...(
            data.citationCount && data.citationCount > 0 ?
              [
                {
                  text: data.citationCount,
                  tip: "citationCount",
                  color: "#1f71e0"
                }
              ] : []
          )
        ],
        source: "readpaper",
        type: "journalArticle"
      };
      return info;
    },
    semanticscholar(data: any) {
      let info: ItemInfo = {
        identifiers: { DOI: data.DOI },
        title: data.title,
        authors: (data.authors || []).map((i: any) => i.name),
        year: data.year,
        publishDate: data.publicationDate,
        abstract: data.abstract,
        source: "semanticscholar",
        type: "journalArticle",
        tags: data.fieldsOfStudy || [],
        primaryVenue: data.journal?.name,
        url: data.DOI ? `https://doi.org/${data.DOI}` : undefined
      };
      return info;
    },
    unpaywall(data: any) {
      const types: any = {
        "journal-article": "journalArticle",
        "report": "report",
        "posted-content": "preprint",
        "book-chapter": "bookSection"
      };
      let info: ItemInfo = {
        identifiers: { DOI: data.DOI },
        authors: (data.z_authors || []).map((i: any) => i.family),
        title: data.title,
        year: data.year,
        type: types[data.genre],
        primaryVenue: data.journal_name,
        source: "unpaywall",
        publishDate: data.published_date,
        abstract: undefined
      };
      return info;
    },
    arXiv: (data: any) => {
      const rawTitle = Array.isArray(data.title) ? data.title[0] : (data.title || "");
      const rawSummary = Array.isArray(data.summary) ? data.summary[0] : (data.summary || "");
      const authors = Array.isArray(data.author)
        ? data.author.map((e: any) => Array.isArray(e.name) ? e.name[0] : (e.name || ""))
        : [];
      const categories = Array.isArray(data.category)
        ? data.category.map((e: any) => e["$"]?.term).filter(Boolean)
        : [];

      let info: ItemInfo = {
        identifiers: { arXiv: data.arXiv },
        title: rawTitle.replace(/\n/g, " ").trim(),
        year: data.year,
        authors: authors,
        abstract: rawSummary.replace(/\n/g, " ").trim(),
        url: utils.identifiers2URL({ arXiv: data.arXiv }),
        type: "preprint",
        tags: categories,
        publishDate: Array.isArray(data.published) ? data.published[0] : data.published,
        primaryVenue: data["arxiv:comment"] && data["arxiv:comment"][0]?.["_"] ? data["arxiv:comment"][0]["_"].replace(/\n/g, " ").trim() : undefined
      };
      return info;
    }
  };

  const BaseInfo = {
    readcube: (data: any) => {
      let identifiers;
      if (data.doi && utils.regex.arXiv.test(data.doi)) {
        data.arxiv = data.doi.match(utils.regex.arXiv).slice(-1)[0];
        data.doi = undefined;
      }
      let type = "journalArticle";
      if (data.arxiv && !data.doi) {
        identifiers = { arXiv: data.arxiv };
        type = "preprint";
      } else {
        identifiers = { DOI: data.doi };
      }
      let url = utils.identifiers2URL(identifiers);
      let related: ItemBaseInfo = {
        identifiers: identifiers,
        title: data.title,
        authors: data?.authors,
        year: data.year,
        type: type,
        text: data.title,
        url: url
      };
      return related;
    }
  };

  return { Info, BaseInfo };
}

export default createProviderMappers;
