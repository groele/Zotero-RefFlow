import Requests from "./requests";
import Utils from "./utils";
import CitationVerifier from "./verifier";
import { config } from "../../package.json";

export class CNKIProvider {
  constructor(private requests: Requests, private utils: Utils) {}

  async getCNKIURL(keywords: string, silent: boolean = false, signal?: AbortSignal) {
    if (!silent) {
      (new ztoolkit.ProgressWindow("[Pending] API"))
        .createLine({ text: `Get CNKI URL`, type: "default" })
        .show();
    }
    const query = {
      Platform: "",
      DBCode: "CFLS",
      KuaKuCode: "CJFQ,CDMD,CIPD,CCND,CISD,SNAD,BDZK,CCJD,CCVD,CJFN",
      QNode: {
        QGroup: [{
          Key: "Subject",
          Title: "",
          Logic: 1,
          Items: [{ Title: "主题", Name: "SU", Value: keywords, Operate: "%=", BlurType: "" }],
          ChildItems: []
        }]
      },
      CodeLang: "ch"
    };
    const form = {
      IsSearch: "true",
      QueryJson: JSON.stringify(query),
      PageName: "defaultresult",
      DBCode: "CFLS",
      CurPage: "1",
      RecordsCntPerPage: "20",
      CurDisplayMode: "listmode",
      CurrSortField: "",
      CurrSortFieldType: "desc",
      IsSentenceSearch: "false",
      Subject: ""
    };
    const body = Object.entries(form).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
    const res = await this.requests.post("https://kns.cnki.net/kns8/Brief/GetGridTableHtml", body, "text", {
      Accept: "text/html",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest"
    }, signal);
    if (signal?.aborted) return;
    try {
      if (typeof res === "string") {
        let cnkiMatch = res.match(/href='(.+FileName=.+?&DbName=.+?)'/i);
        if (cnkiMatch && cnkiMatch[1]) {
          let args = this.utils.parseCNKIURL(cnkiMatch[1]);
          if (args) {
            return `https://kns.cnki.net/kcms/detail/detail.aspx?FileName=${args.fileName}&DbName=${args.dbName}&DbCode=${args.dbCode}`;
          }
        }
      }
    } catch { }
    if (!silent) {
      (new ztoolkit.ProgressWindow("[Pending] API"))
        .createLine({ text: `Get CNKI URL Fail`, type: "fail" })
        .show();
    }
  }

  async getTitleInfoByCNKI(refText: string, signal?: AbortSignal): Promise<ItemInfo | undefined> {
    // 拒绝非中文请求，避免被封IP
    if (signal?.aborted || !this.utils.isChinese(refText)) { return; }
    let res = this.utils.parseRefText(refText);
    const key = `${res.title}${res.authors}${refText}`;
    const cached = this.requests.getCache(key);
    if (cached) {
      return cached;
    }
    ztoolkit.log("parseRefText", refText, res);
    let url = await this.getCNKIURL(res.title, true, signal);
    if (!url || typeof url !== "string") { return; }

    let htmlString = await this.requests.get(url, "text", {}, signal);
    if (signal?.aborted || typeof htmlString !== "string") return;
    ztoolkit.log(url, htmlString);
    const parser = ztoolkit.getDOMParser();
    const doc = parser.parseFromString(htmlString, "text/html").documentElement as any;
    let aTags = doc.querySelectorAll(".top-tip span a");
    const informSpan = [...doc.querySelectorAll("p.total-inform span")].find(span => span.innerText.includes("下载"));
    const downloadMatch = informSpan?.innerText?.match(/\d+/);
    const downloadCount = downloadMatch ? downloadMatch[0] : undefined;
    const returnedTitle = String(doc.querySelector(".brief h1")?.textContent || "").trim();
    const requestedTitle = CitationVerifier.cleanTitle(res.title);
    if (requestedTitle.length < 6 || !returnedTitle || (requestedTitle !== CitationVerifier.cleanTitle(returnedTitle) && CitationVerifier.tokenJaccard(res.title, returnedTitle) < 0.95)) return;

    let info: ItemInfo = {
      identifiers: { CNKI: url },
      title: returnedTitle,
      abstract: doc.querySelector("span#ChDivSummary")?.innerText || "",
      authors: [...doc.querySelectorAll("#authorpart span a")].map((a: any) => a.innerText),
      type: "journalArticle",
      primaryVenue: aTags[0]?.innerText || "",
      year: aTags[1]?.innerText ? aTags[1].innerText.split(",")[0] : "",
      url: url,
      source: "CNKI",
      tags: [...doc.querySelectorAll(".keywords a")].map((a: any) => a.innerText.replace(/(\n|\s+|;)/g, ""))
        .concat(downloadCount !== undefined ? [
          {
            text: downloadCount,
            color: "#cc7c08",
            tip: "知网下载量"
          }
        ] : [])
    };
    this.requests.setCache(key, info);
    return info;
  }

  async getCNKIFileInfo(fileName: string, count = 0, signal?: AbortSignal): Promise<ItemInfo | undefined> {
    if (signal?.aborted || !fileName) return;
    const prefsKey = `${config.addonRef}.CNKI.token`;
    const username = String(Zotero.Prefs.get(`${config.addonRef}.CNKI.username`) || "");
    const password = String(Zotero.Prefs.get(`${config.addonRef}.CNKI.password`) || "");
    let token = String(Zotero.Prefs.get(prefsKey) || "");
    const updateToken = async () => {
      if (!username || !password || signal?.aborted) return false;
      const res = await this.requests.post("https://apix.cnki.net/databusapi/api/v1.0/credential/namepasswithcleartext/personalaccount",
        { Username: username, Password: password }, "json", {}, signal, { cache: false });
      if (signal?.aborted || typeof res?.Content !== "string" || !res.Content.trim()) return false;
      token = res.Content.trim();
      Zotero.Prefs.set(prefsKey, token);
      return true;
    };
    if (!token && !await updateToken()) return;
    const name = encodeURIComponent(fileName);
    const infoApi = `https://x.cnki.net/readApi/api/v1/paperInfo?fileName=${name}&tableName=CJFDTOTAL&dbCode=CJFD&from=ReadingHistory&type=psmc&fsType=1&taskId=0`;
    const refApi = `https://x.cnki.net/readApi/api/v1/paperRefreNotes?appId=CRSP_BASIC_PSMC&dbcode=CJFD&tablename=CJFDTOTAL&filename=${name}&type=1&page=1`;
    const infoData = await this.requests.get(infoApi, "json", { token }, signal);
    if (signal?.aborted) return;
    const refData = await this.requests.get(refApi, "json", { token }, signal);
    if (signal?.aborted) return;
    if (!refData || String(refData.code) !== "200") {
      const rejected = ["401", "403"].includes(String(refData?.code));
      if (rejected && count < 1 && await updateToken()) return this.getCNKIFileInfo(fileName, count + 1, signal);
      return;
    }

    let info: ItemInfo = {
      identifiers: {},
      authors: [],
      type: "",
      references: [],
      title: ""
    };
    const typeMap: any = {
      "journal": "journalArticle"
    };
    if (String(infoData?.code) == "200" && infoData?.content?.paper?.bibliography) {
      const bibList = Array.isArray(infoData.content.paper.bibliography) ? infoData.content.paper.bibliography : [];
      const refList = Array.isArray(refData?.content?.refer) ? refData.content.refer : [];
      bibList.forEach((ref: { title: string }) => {
        let _ref = refList.find((_r: { title: string }) => {
          return Boolean(ref?.title && _r?.title && ref.title.indexOf(_r.title) != -1);
        });
        const refText = (ref?.title || "").replace(/^\[\d+\]/, "");
        if (_ref) {
          const dbCode = (_ref.dbSource || "").split("_")[0];
          const cnkiURL = `https://kns.cnki.net/kcms/detail/detail.aspx?FileName=${encodeURIComponent(_ref.fileName || "")}&DbName=${encodeURIComponent(_ref.tableName || "")}&DbCode=${encodeURIComponent(dbCode)}`;
          info.references?.push({
            identifiers: {
              CNKI: cnkiURL
            },
            text: refText,
            title: _ref.title,
            authors: [],
            type: typeMap[_ref.type] || "journalArticle",
            url: cnkiURL
          });
        } else {
          info.references?.push({
            identifiers: {},
            text: refText,
            authors: [],
            type: "journalArticle",
            title: refText
          });
        }
      });
    } else if (Array.isArray(refData?.content?.refer)) {
      const referList = [...refData.content.refer];
      referList.sort((a: any, b: any) => Number(a.citationNumber || 0) - Number(b.citationNumber || 0))
        .forEach((ref: any) => {
          const title = (ref.title || "").replace(/^\[\d+\]/, "");
          const dbCode = (ref.dbSource || "").split("_")[0];
          const cnkiURL = `https://kns.cnki.net/kcms/detail/detail.aspx?FileName=${encodeURIComponent(ref.fileName || "")}&DbName=${encodeURIComponent(ref.tableName || "")}&DbCode=${encodeURIComponent(dbCode)}`;
          const authors = typeof ref.author === "string" ? ref.author.split(";").filter((s: string) => s.length) : [];
          info.references?.push({
            identifiers: {
              CNKI: cnkiURL
            },
            authors: authors,
            type: typeMap[ref.type] || "journalArticle",
            text: `${ref.author || ""}. ${title}[${ref.type?.[0] || "J"}]. ${ref.source || ""}, ${ref.year || ""}, ${ref.volumn || ""}:${ref.pageNumber || ""}.`,
            title: ref.title,
            year: ref.year,
            url: cnkiURL,
            number: Number(ref.citationNumber || 0)
          });
        });
    }
    info.referencePartial = !Array.isArray(infoData?.content?.paper?.bibliography);
    if (signal?.aborted) return;
    return info;
  }
}

export default CNKIProvider;
