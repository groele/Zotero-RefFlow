/**
 * 稳健型批量导入与事务回滚引擎 (Robust Batch Importer & Rollback Engine)
 * 具备幂等性写入、一键撤回 (Rollback) 快照、OA 全文下载与引文存根笔记 (Manifest Note) 生成
 */

import CitationVerifier from "./verifier";
import Utils from "./utils";

export interface BatchImportOptions {
  downloadOA?: boolean;
  createSubCollection?: boolean;
  createManifestNote?: boolean;
}

export interface BatchImportResult {
  batchId: string;
  total: number;
  importedCount: number;
  existingCount: number;
  failedCount: number;
  subCollection?: any;
}

export class BatchImporter {
  private static utils: Utils = new Utils();

  /**
   * 生成全局唯一的批次指纹 ID
   */
  public static generateBatchId(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `refnexus_batch_${ts}`;
  }

  /**
   * 一键批量安全导入
   */
  public static async importAll(
    parentItem: Zotero.Item,
    references: ItemBaseInfo[],
    options: BatchImportOptions = { downloadOA: true, createSubCollection: true, createManifestNote: true }
  ): Promise<BatchImportResult> {
    const libraryID = parentItem.libraryID;
    const batchId = this.generateBatchId();
    const parentTitle = (parentItem.getField("title") as string) || "Paper";

    let subCollection: any = null;
    let targetCollectionIds: number[] = [];

    // 1. 创建专用子分类 (Sub-Collection)
    if (options.createSubCollection) {
      try {
        subCollection = new (Zotero as any).Collection();
        const shortTitle = parentTitle.length > 25 ? parentTitle.slice(0, 25) + "..." : parentTitle;
        subCollection.name = `📁 [Refs] ${shortTitle}`;
        subCollection.libraryID = libraryID;
        const parentCols = parentItem.getCollections();
        if (parentCols && parentCols.length > 0) {
          subCollection.parentID = parentCols[0];
        }
        await subCollection.saveTx();
        targetCollectionIds = [subCollection.id];
      } catch (e) {
        ztoolkit.log("Error creating sub-collection:", e);
      }
    } else {
      targetCollectionIds = parentItem.getCollections() || [];
    }

    let importedCount = 0;
    let existingCount = 0;
    let failedCount = 0;
    const existingRelatedIds: number[] = [];
    const itemRecords: { index: number; title: string; doi?: string; item?: any; isNew: boolean }[] = [];

    const progressWin = new (Zotero as any).ProgressWindow({ closeTime: -1 });
    progressWin.changeHeadline(`[${batchId}] 批量导入中...`);
    progressWin.createLine({ text: `共计 ${references.length} 篇参考文献`, type: "default" });
    progressWin.show();

    // 批次内内存去重表，防止正文中多次引用同一篇文献时产生重复条目
    const seenDoiMap = new Map<string, any>();
    const seenTitleMap = new Map<string, any>();
    const oaQueue: { url: string; parentItemID: number; libraryID: number }[] = [];

    // 2. 顺序导入以保护 SQLite 事务完整性
    for (let i = 0; i < references.length; i++) {
      const ref = references[i];
      const indexNum = ref.number || (i + 1);
      const doi = ref.identifiers?.DOI;
      const normDoi = CitationVerifier.normalizeDOI(doi);
      const cleanTitleKey = CitationVerifier.cleanTitle(ref.title);

      progressWin.changeLine({
        text: `[${i + 1}/${references.length}] ${ref.title ? (ref.title.slice(0, 30) + "...") : "处理中"}`,
        progress: ((i + 1) / references.length) * 100
      });

      let targetItem = ref._item;

      // 检查批次内内存表
      if (!targetItem && normDoi && seenDoiMap.has(normDoi)) {
        targetItem = seenDoiMap.get(normDoi);
      } else if (!targetItem && cleanTitleKey && seenTitleMap.has(cleanTitleKey)) {
        targetItem = seenTitleMap.get(cleanTitleKey);
      }

      // 检查用户本地文库 (防止重复创建库内已有的文献)
      if (!targetItem) {
        try {
          targetItem = await this.utils.searchLibraryItem(ref, libraryID);
        } catch (searchErr) {
          ztoolkit.log("Local search check error:", searchErr);
        }
      }

      // 如果未在库内，执行创建
      if (!targetItem) {
        try {
          if (doi) {
            // 通过 Zotero 原生 Translator 获取官方完整元数据
            try {
              const translate = new (Zotero as any).Translate.Search();
              translate.setIdentifier({ DOI: doi });
              const translators = await translate.getTranslators();
              if (translators && translators.length > 0) {
                translate.setTranslator(translators);
                const translatePromise = translate.translate({
                  libraryID,
                  collections: targetCollectionIds,
                  saveAttachments: false
                });
                let timerId: any;
                const timeoutPromise = new Promise<never>((_, reject) => {
                  timerId = setTimeout(() => reject(new Error("Translator timeout")), 6000);
                });
                const created = await Promise.race([translatePromise, timeoutPromise]).finally(() => {
                  if (timerId) clearTimeout(timerId);
                });
                if (created && created.length > 0) {
                  targetItem = created[0];
                }
              }
            } catch (transErr) {
              ztoolkit.log("Translator fallback to metadata import:", transErr);
            }
          }

          // 降级直接从引文元数据创建
          if (!targetItem) {
            targetItem = new (Zotero as any).Item(ref.type || "journalArticle");
            targetItem.setField("title", ref.title || ref.text || "Untitled");
            if (doi) targetItem.setField("DOI", doi);
            if (ref.year) targetItem.setField("date", String(ref.year));
            if (ref.publicationVenue) targetItem.setField("publicationTitle", ref.publicationVenue);
            if (ref.authors && ref.authors.length > 0) {
              targetItem.setCreators(ref.authors.map((name: string) => this.utils.splitCreator(name)));
            }
            targetItem.libraryID = libraryID;
            for (const colId of targetCollectionIds) {
              targetItem.addToCollection(colId);
            }
            const oldExtra = (targetItem.getField("extra") as string) || "";
            targetItem.setField("extra", oldExtra ? `${oldExtra}\nimport_batch: ${batchId}` : `import_batch: ${batchId}`);
            if (targetItem.id !== parentItem.id) {
              try {
                parentItem.addRelatedItem(targetItem);
                targetItem.addRelatedItem(parentItem);
              } catch {}
            }
            await targetItem.saveTx(); // 单次原子事务写入
          } else {
            // Translator 创建的条目补全集合与关系
            for (const colId of targetCollectionIds) {
              targetItem.addToCollection(colId);
            }
            const oldExtra = (targetItem.getField("extra") as string) || "";
            targetItem.setField("extra", oldExtra ? `${oldExtra}\nimport_batch: ${batchId}` : `import_batch: ${batchId}`);
            if (targetItem.id !== parentItem.id) {
              try {
                parentItem.addRelatedItem(targetItem);
                targetItem.addRelatedItem(parentItem);
              } catch {}
            }
            await targetItem.saveTx();
          }

          if (targetItem) {
            importedCount++;
            ref._item = targetItem;
            if (normDoi) seenDoiMap.set(normDoi, targetItem);
            if (cleanTitleKey) seenTitleMap.set(cleanTitleKey, targetItem);
            itemRecords.push({ index: indexNum, title: ref.title, doi, item: targetItem, isNew: true });
          } else {
            failedCount++;
          }
        } catch (err) {
          ztoolkit.log("Import item failed:", ref, err);
          failedCount++;
        }
      } else {
        // 库内已有文献，加入目标 Collection 并建立双向关联
        existingCount++;
        ref._item = targetItem;
        let modified = false;
        for (const colId of targetCollectionIds) {
          targetItem.addToCollection(colId);
          modified = true;
        }
        if (targetItem.id !== parentItem.id) {
          try {
            parentItem.addRelatedItem(targetItem);
            targetItem.addRelatedItem(parentItem);
            existingRelatedIds.push(targetItem.id);
            modified = true;
          } catch {}
        }
        if (modified) {
          await targetItem.saveTx();
        }
        itemRecords.push({ index: indexNum, title: ref.title, doi, item: targetItem, isNew: false });
      }

      // 3. 收集 Open Access 全文 PDF 下载任务
      if (options.downloadOA && ref.oaUrl && targetItem) {
        oaQueue.push({
          url: ref.oaUrl,
          parentItemID: targetItem.id,
          libraryID: targetItem.libraryID
        });
      }
    }

    // 记录母条目 extra 中的批次信息、集合 ID 与已有文献关联记录 (用于完全干净的回滚)
    const parentExtra = (parentItem.getField("extra") as string) || "";
    let extraAppends = `refnexus_batch_parent: ${batchId}`;
    if (subCollection && subCollection.id) {
      extraAppends += `\nimport_collection_${batchId}: ${subCollection.id}`;
    }
    if (existingRelatedIds.length > 0) {
      extraAppends += `\nimport_related_existing_${batchId}: ${existingRelatedIds.join(",")}`;
    }
    parentItem.setField("extra", parentExtra ? `${parentExtra}\n${extraAppends}` : extraAppends);
    await parentItem.saveTx();

    // 4. 异步受控并发下载合法 Open Access 全文 PDF (并发限额 2，保护网络资源)
    if (options.downloadOA && oaQueue.length > 0) {
      (async () => {
        const queue = [...oaQueue];
        const concurrency = 2;
        const worker = async () => {
          while (queue.length > 0) {
            const task = queue.shift();
            if (!task) break;
            try {
              await (Zotero as any).Attachments.importFromURL({
                url: task.url,
                parentItemID: task.parentItemID,
                libraryID: task.libraryID,
                contentType: "application/pdf",
                title: "Full Text PDF (Open Access)"
              });
            } catch (e) {
              // 容错处理
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
      })();
    }

    // 5. 生成引文存根笔记 (Manifest Note)
    if (options.createManifestNote) {
      try {
        await this.createManifestNote(parentItem, references, batchId);
      } catch (e) {
        ztoolkit.log("Error creating manifest note:", e);
      }
    }

    // 刷新文库内存缓存，保证新条目与引用立即可用
    this.utils.clearLibraryItemCache();

    progressWin.changeHeadline(`[${batchId}] 导入完成！`);
    progressWin.changeLine({
      text: `新导入: ${importedCount} | 库内已有: ${existingCount} | 失败: ${failedCount}`,
      type: "success"
    });
    progressWin.startCloseTimer(4000);

    return {
      batchId,
      total: references.length,
      importedCount,
      existingCount,
      failedCount,
      subCollection
    };
  }

  /**
   * 生成结构化 Markdown 引文存根笔记 (Manifest Note)
   */
  private static async createManifestNote(parentItem: Zotero.Item, references: ItemBaseInfo[], batchId: string) {
    const parentTitle = (parentItem.getField("title") as string) || "文献";
    const noteLines: string[] = [
      `<h1>参考文献清单存根 (Reference Manifest)</h1>`,
      `<p><strong>来源母篇:</strong> ${parentTitle}</p>`,
      `<p><strong>导入批次 ID:</strong> <code>${batchId}</code> (可凭此 ID 一键撤回本次操作)</p>`,
      `<p><strong>总引用数:</strong> ${references.length} 篇</p>`,
      `<hr/>`,
      `<ol>`
    ];

    for (let i = 0; i < references.length; i++) {
      const r = references[i];
      const num = r.number || (i + 1);
      const doi = r.identifiers?.DOI;
      const title = r.title || r.text || "Untitled";
      const authors = (r.authors || []).join(", ");
      const retractionBadge = r.retraction?.isRetracted ? ` <strong style="color:red;">[🚨 已撤稿警示]</strong>` : "";
      const doiLink = doi ? ` <a href="https://doi.org/${doi}">DOI: ${doi}</a>` : "";
      const sourcesBadge = (r.sources && r.sources.length > 0) ? ` <span style="background-color:#e0f2fe; color:#0369a1; padding:1px 4px; border-radius:3px; font-size:11px;">[来源: ${r.sources.join(" + ")}]</span>` : "";
      const confBadge = r.confidence ? ` <span style="color:#16a34a; font-size:11px;">(${(r.confidence * 100).toFixed(0)}% 可信度)</span>` : "";
      const oaBadge = r.oaUrl ? ` <a href="${r.oaUrl}" style="color:#059669; font-weight:bold;">[🔓 Open Access PDF]</a>` : "";

      noteLines.push(`<li><strong>[${num}]</strong> ${authors ? authors + ". " : ""}<em>${title}</em> (${r.year || "n.d."})${doiLink}${sourcesBadge}${confBadge}${oaBadge}${retractionBadge}</li>`);
    }

    noteLines.push(`</ol>`);

    const noteItem = new (Zotero as any).Item("note");
    noteItem.setNote(noteLines.join("\n"));
    noteItem.parentID = parentItem.id;
    noteItem.libraryID = parentItem.libraryID;
    const oldExtra = (noteItem.getField("extra") as string) || "";
    noteItem.setField("extra", oldExtra ? `${oldExtra}\nimport_batch: ${batchId}` : `import_batch: ${batchId}`);
    await noteItem.saveTx();
  }

  /**
   * ↩️ 一键无损回滚 (1-Click Safe Rollback)
   * 撤销指定 batchId 创建的所有新条目和笔记，自动清理空子分类，解除双向关联，保护文库整洁
   */
  public static async rollbackBatch(parentItem: Zotero.Item, batchId: string): Promise<number> {
    if (!batchId) return 0;
    const libraryID = parentItem.libraryID;
    const s = new (Zotero as any).Search();
    s.libraryID = libraryID;
    s.addCondition("extra", "contains", `import_batch: ${batchId}`);
    const rawIds: number[] = await s.search();

    // 核心安全防线：绝对排除母条目 ID，杜绝误删母篇论文风险！
    const ids: number[] = rawIds.filter((id) => id !== parentItem.id);

    let deletedCount = 0;
    if (ids.length > 0) {
      const items = await (Zotero as any).Items.getAsync(ids);
      for (const item of items) {
        if (!item) continue;
        try {
          // 解除与母条目的关联
          await parentItem.removeRelatedItem(item);
        } catch (e) {
          ztoolkit.log("Rollback removeRelatedItem error:", e);
        }
      }

      try {
        if (typeof (Zotero as any).Items.trashTx === "function") {
          await (Zotero as any).Items.trashTx(ids);
          deletedCount = ids.length;
        } else {
          for (const item of items) {
            if (item && typeof item.eraseTx === "function") {
              await item.eraseTx();
              deletedCount++;
            }
          }
        }
      } catch (err) {
        ztoolkit.log("Rollback items trash failed:", err);
      }
    }

    // 检查并解除库内已有文献在此次导入中建立的双向关联 (彻底防止关联残留)
    const extra = (parentItem.getField("extra") as string) || "";
    const relatedRegex = new RegExp(`(?:import_related_existing_${batchId}|import_related_existing):\\s*([0-9,]+)`);
    const relatedMatch = extra.match(relatedRegex);
    if (relatedMatch) {
      const existingIds = relatedMatch[1].split(",").map(id => parseInt(id.trim())).filter(Boolean);
      for (const exId of existingIds) {
        try {
          let item = (Zotero as any).Items.get ? (Zotero as any).Items.get(exId) : undefined;
          if (!item && typeof (Zotero as any).Items.getAsync === "function") {
            const arr = await (Zotero as any).Items.getAsync([exId]);
            item = arr && arr[0];
          }
          if (item) {
            await parentItem.removeRelatedItem(item);
            if (typeof item.removeRelatedItem === "function") {
              await item.removeRelatedItem(parentItem);
            }
            await item.saveTx();
          }
        } catch (e) {
          ztoolkit.log("Rollback existing item un-relation error:", e);
        }
      }
    }

    // 检查并删除本次创建的专用子分类
    const colRegex = new RegExp(`(?:import_collection_${batchId}|import_collection):\\s*(\\d+)`);
    const colMatch = extra.match(colRegex);
    if (colMatch) {
      try {
        const colId = parseInt(colMatch[1]);
        let col = (Zotero as any).Collections.get ? (Zotero as any).Collections.get(colId) : undefined;
        if (!col && typeof (Zotero as any).Collections.getAsync === "function") {
          col = await (Zotero as any).Collections.getAsync(colId);
        }
        if (col && typeof col.eraseTx === "function") {
          await col.eraseTx();
        }
      } catch (e) {
        ztoolkit.log("Rollback collection failed:", e);
      }
    }

    // 清理母条目 extra 中的批次标记与分类记录
    const cleanedExtra = extra
      .replace(new RegExp(`\\n?(?:refnexus_batch_parent|ref_batch_parent|import_batch):\\s*${batchId}`, "g"), "")
      .replace(new RegExp(`\\n?import_collection_${batchId}:\\s*\\d+`, "g"), "")
      .replace(new RegExp(`\\n?import_related_existing_${batchId}:\\s*[0-9,]+`, "g"), "")
      .replace(/\n?import_collection:\s*\d+/g, "")
      .replace(/\n?import_related_existing:\s*[0-9,]+/g, "")
      .trim();
    parentItem.setField("extra", cleanedExtra);
    await parentItem.saveTx();

    this.utils.clearLibraryItemCache();

    return deletedCount;
  }
}
export default BatchImporter;
