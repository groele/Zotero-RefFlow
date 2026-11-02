import { config } from "../../package.json";
import type { ReferenceResult } from "./referenceRetrieval";

/**
 * 缓存快照与签名计算模块 (Cache Snapshot & Signature Generator)
 * 确保文献条目在不同来源、附件修改与版本更新时的缓存指纹确定性
 */

export function readerMatchesItem(reader: any, item: Zotero.Item): boolean {
  const raw = reader?.itemID ? Zotero.Items.get(reader.itemID) : undefined;
  const attachment = (raw || undefined) as Zotero.Item | undefined;
  return Boolean(attachment && attachment.attachmentContentType === "application/pdf" && (attachment.parentID === item.id || attachment.id === item.id));
}

export async function resolvePDFAttachment(item: Zotero.Item, reader?: any): Promise<Zotero.Item | undefined> {
  const raw = reader?.itemID ? Zotero.Items.get(reader.itemID) : undefined;
  const attachment = (raw || undefined) as Zotero.Item | undefined;
  if (readerMatchesItem(reader, item)) return attachment;
  const best: any = await item.getBestAttachment();
  if (best && typeof best === "object" && best.attachmentContentType === "application/pdf") return best as Zotero.Item;
  for (const id of item.getAttachments()) {
    const rawAtt = Zotero.Items.get(id);
    const att = (rawAtt || undefined) as Zotero.Item | undefined;
    if (att && att.attachmentContentType === "application/pdf" && !att.deleted) return att;
  }
}

export async function computePDFCacheSignature(item: Zotero.Item, reader?: any): Promise<string> {
  const attachment = await resolvePDFAttachment(item, reader);
  if (!attachment || attachment.attachmentContentType !== "application/pdf") return "";
  const path = await attachment.getFilePathAsync();
  if (!path) return "";
  const file = Zotero.File.pathToFile(path);
  if (!file.exists()) return "";
  return `pdf-sdt-v3:${attachment.libraryID}:${attachment.key}:${file.fileSize}:${file.lastModifiedTime}`;
}

export async function computeSnapshotSignatures(item: Zotero.Item): Promise<any[]> {
  const signatures: any[] = [];
  for (const id of item.getAttachments().slice(0, 20)) {
    const raw = Zotero.Items.get(id);
    const attachment = (raw || undefined) as Zotero.Item | undefined;
    if (!attachment || attachment.deleted || attachment.attachmentContentType !== "text/html") continue;
    const path = await attachment.getFilePathAsync();
    const file = path ? Zotero.File.pathToFile(path) : undefined;
    signatures.push([attachment.key, attachment.dateModified, file?.exists() ? file.fileSize : 0, file?.exists() ? file.lastModifiedTime : 0]);
  }
  return signatures;
}

export function mayPersistResult(result: ReferenceResult): boolean {
  const pdf = /^PDF\b/.test(result.source);
  return Boolean(Zotero.Prefs.get(`${config.addonRef}.${pdf ? "savePDFReferences" : "saveAPIReferences"}`));
}
