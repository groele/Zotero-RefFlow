/**
 * Checks whether an active reader matches the target parent item.
 */
export function readerMatchesItem(reader: any, item: Zotero.Item): boolean {
  const attachment = reader?.itemID ? Zotero.Items.get(reader.itemID) : undefined;
  return Boolean(
    attachment &&
    attachment.attachmentContentType === "application/pdf" &&
    (attachment.parentID === item.id || attachment.id === item.id)
  );
}

/**
 * Resolves the best available local PDF attachment for the item.
 */
export async function getPdfAttachment(item: Zotero.Item, reader?: any): Promise<Zotero.Item | undefined> {
  if (readerMatchesItem(reader, item)) {
    const attachment = Zotero.Items.get(reader.itemID);
    if (!attachment || attachment.deleted || (attachment as any).inTrash) return undefined;
    try {
      const path = await attachment.getFilePathAsync();
      return path && Zotero.File.pathToFile(path).exists() ? attachment : undefined;
    } catch {
      return undefined;
    }
  }
  const best = await item.getBestAttachment();
  const attachments = (await (Zotero.Items as any).getAsync(item.getAttachments())) as Zotero.Item[];
  const candidates = [best, ...attachments].filter(
    (candidate, index, list) => candidate && list.indexOf(candidate) === index
  ) as Zotero.Item[];
  const supplementary = (candidate: Zotero.Item) =>
    /\bsupplement(?:ary|al)?\b|\bsupporting\s+information\b|\badditional\s+file\b|\b(?:ESI|SI)\b|补充|附件/i.test(
      String(candidate.getField("title")) + " " + String(candidate.getField("url"))
    );
  candidates.sort((a, b) => Number(supplementary(a)) - Number(supplementary(b)));
  for (const candidate of candidates) {
    if (!candidate || candidate.attachmentContentType !== "application/pdf" || candidate.deleted || (candidate as any).inTrash) {
      continue;
    }
    const path = await candidate.getFilePathAsync();
    if (path && Zotero.File.pathToFile(path).exists()) return candidate;
  }
  return undefined;
}

/**
 * Calculates a signature representing the PDF file's state for cache invalidation.
 */
export async function getPdfCacheSignature(item: Zotero.Item, reader?: any): Promise<string> {
  const attachment = await getPdfAttachment(item, reader);
  if (!attachment || attachment.attachmentContentType !== "application/pdf") return "";
  const path = await attachment.getFilePathAsync();
  if (!path) return "";
  const file = Zotero.File.pathToFile(path);
  if (!file.exists()) return "";
  return `pdf-sdt-v5:${attachment.libraryID}:${attachment.key}:${file.fileSize}:${file.lastModifiedTime}`;
}

/**
 * Collects snapshot signatures for HTML attachments.
 */
export async function getSnapshotSignatures(item: Zotero.Item): Promise<any[]> {
  const signatures: any[] = [];
  for (const id of item.getAttachments().slice(0, 20)) {
    const attachment = Zotero.Items.get(id);
    if (!attachment || attachment.deleted || attachment.attachmentContentType !== "text/html") continue;
    const path = await attachment.getFilePathAsync();
    const file = path ? Zotero.File.pathToFile(path) : undefined;
    signatures.push([
      attachment.key,
      attachment.dateModified,
      file?.exists() ? file.fileSize : 0,
      file?.exists() ? file.lastModifiedTime : 0
    ]);
  }
  return signatures;
}
