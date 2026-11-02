import { getString } from "../../utils/locale";
import CitationVerifier from "../verifier";
import { safeProviderAttempt, renderReferenceSourceDetails, ReferenceSourceEvidence } from "../referenceSourceDetails";
import { retrieveReferenceList, ReferenceProvider, ReferenceResult } from "../referenceRetrieval";
import { readCachedReferenceResult, preferCachedReferences, cacheReferenceResult } from "../referenceCache";
import { referenceData } from "../referenceData";
import { mayPersistResult } from "../referenceSignatures";
import type { ReferenceTaskContext } from "../referenceTasks";
import type Views from "../views";

export class ReferencePipeline {
  public static referenceDescription(result: ReferenceResult): string {
    const attempt = result.latestAttempt;
    return result.source
      + (result.retained ? ` · ${getString("cards-kept-results")}` : "")
      + (attempt ? ` · ${getString("cards-latest-attempt")} ${attempt.count}${attempt.expected ? "/" + attempt.expected : attempt.partial ? "+" : ""}` : "")
      + (result.partial ? ` (${result.references.length}${result.expected ? "/" + result.expected : "+"} · ${getString("cards-partial")})` : "");
  }

  public static async onlineReferences(views: Views, item: Zotero.Item, task: ReferenceTaskContext, label: HTMLElement): Promise<ReferenceResult | undefined> {
    const api = views.utils.API, url = String(item.getField("url") || ""), title = String(item.getField("title") || "");
    let doi = CitationVerifier.normalizeDOI(String(item.getField("DOI") || "")) || CitationVerifier.normalizeDOI(url) || "";
    if (!doi) {
      let fileName = views.utils.parseCNKIURL(url)?.fileName;
      if (fileName || views.utils.isChinese(title)) {
        try {
          if (!fileName) {
            const matched = await api.getTitleInfoByCNKI(title, task.signal);
            fileName = views.utils.parseCNKIURL(matched?.identifiers?.CNKI || "")?.fileName;
          }
          if (!task.isCurrent()) return;
          if (fileName) {
            const info = await api.getCNKIFileInfo(fileName, 0, task.signal);
            if (info?.references?.length) return { references: info.references, source: "CNKI", partial: info.referencePartial };
          }
        } catch (error: any) {
          if (task.signal.aborted || error?.name === "AbortError") throw error;
          ztoolkit.log("CNKI unavailable; continuing DOI resolution", safeProviderAttempt(String(error?.message || error)));
        }
      }
      if (!task.isCurrent()) return;
      label.textContent = getString("cards-resolving-doi");
      const creator = item.getCreators()[0] as any;
      doi = (await api.resolveWork(title, creator?.name || creator?.lastName, String(item.getField("date")), task.signal))?.doi || "";
    }
    if (!doi || !task.isCurrent()) return;
    return api.getReferenceList(doi, url, title, task.signal);
  }

  public static async smartReferences(views: Views, item: Zotero.Item, reader: any, task: ReferenceTaskContext, includePDF: boolean, fromCurrentPage: boolean, label: HTMLElement, webFirst = false): Promise<ReferenceResult> {
    const api = views.utils.API, title = String(item.getField("title")), url = String(item.getField("url"));
    let doi = String(item.getField("DOI") || "");
    const resolveDOI = async () => {
      if (!views.utils.isDOI(doi)) doi = CitationVerifier.normalizeDOI(url) || "";
      if (!doi && task.isCurrent()) doi = (await api.resolveWork(title, (item.getCreators()[0] as any)?.lastName, String(item.getField("date")), task.signal))?.doi || "";
      return doi;
    };
    const providers: ReferenceProvider[] = [];
    if (includePDF) {
      providers.push({
        name: "PDF",
        run: async () => {
          const attachment = await (views as any).pdfAttachment(item, reader);
          if (!attachment || !task.isCurrent()) return;
          const references = await views.utils.PDF.getReferences(attachment, fromCurrentPage, {
            signal: task.signal,
            pageIndex: task.pageIndex,
            notify: false,
            onProgress: pages => {
              if (task.isCurrent()) label.textContent = `${getString("relatedbox-loading")} PDF · ${pages} ${getString("relatedbox-pages-label")}`;
            }
          });
          return { references, source: "PDF", partial: views.utils.PDF.getDiagnostics(attachment)?.scanLimited };
        }
      });
    }
    providers.push({
      name: "Snapshot",
      run: async () => {
        for (const id of item.getAttachments().slice(0, 20)) {
          if (!task.isCurrent()) return;
          const attachment = Zotero.Items.get(id);
          if (!attachment || attachment.attachmentContentType !== "text/html" || attachment.deleted) continue;
          const path = await attachment.getFilePathAsync();
          if (!path) continue;
          const file = Zotero.File.pathToFile(path);
          if (!file.exists() || file.fileSize > 8 * 1024 * 1024) continue;
          const html = await Zotero.File.getContentsAsync(path);
          if (typeof html !== "string") continue;
          const references = api.publisherReferences.parseHTML(html, String(attachment.getField("url") || url), doi, title);
          if (references.length) return { references, source: references[0].sources?.[0] + " snapshot" };
        }
        return;
      }
    });
    if (webFirst) {
      providers.push({
        name: "Publisher / JATS",
        run: async () => {
          if (!await resolveDOI() || !task.isCurrent()) return;
          const references = await api.publisherReferences.getReferences(doi, url, title, task.signal);
          return { references, source: references[0]?.sources?.[0] || "Publisher" };
        }
      });
    }
    providers.push({
      name: "Online",
      run: () => ReferencePipeline.onlineReferences(views, item, task, label)
    });
    return retrieveReferenceList(providers, task.signal, source => {
      if (task.isCurrent()) label.textContent = `${getString("relatedbox-loading")} ${source}`;
    });
  }
}
