import CitationVerifier from "./verifier";
import { getItemDOI, isRegularLibraryItem, selectLibraryMatch } from "./workIdentity";

export interface FastLibraryIndex {
  byDOI: Map<string, Zotero.Item>;
  byTitle: Map<string, Zotero.Item[]>;
  generation: number;
}

/**
 * In-memory O(1) fast library lookup index to accelerate sidebar item matching
 * across repeated views and list scrolls without repeatedly querying SQLite.
 */
export class LibraryMatchIndex {
  private indices = new Map<number, FastLibraryIndex>();

  public clear(libraryIDs?: Set<number>): void {
    if (libraryIDs) {
      for (const id of libraryIDs) {
        this.indices.delete(id);
      }
    } else {
      this.indices.clear();
    }
  }

  private getOrCreateIndex(libraryID: number): FastLibraryIndex {
    let index = this.indices.get(libraryID);
    if (!index) {
      index = {
        byDOI: new Map(),
        byTitle: new Map(),
        generation: 0
      };
      this.indices.set(libraryID, index);
    }
    return index;
  }

  public recordMatch(item: Zotero.Item, libraryID: number): void {
    if (!isRegularLibraryItem(item)) return;
    const index = this.getOrCreateIndex(libraryID);

    const doi = getItemDOI(item);
    if (doi && !index.byDOI.has(doi)) {
      index.byDOI.set(doi, item);
    }

    const title = item.getField("title") as string;
    const cleanTitle = CitationVerifier.cleanTitle(title);
    if (cleanTitle && cleanTitle.length >= 8) {
      const existing = index.byTitle.get(cleanTitle) || [];
      if (!existing.some((i) => i.id === item.id)) {
        existing.push(item);
        index.byTitle.set(cleanTitle, existing);
      }
    }
  }

  public findFastMatch(info: ItemBaseInfo, libraryID: number): Zotero.Item | undefined {
    const index = this.indices.get(libraryID);
    if (!index) return undefined;

    const doi = CitationVerifier.normalizeDOI(info.identifiers?.DOI);
    if (doi && index.byDOI.has(doi)) {
      const match = index.byDOI.get(doi);
      if (match && isRegularLibraryItem(match) && getItemDOI(match) === doi) return match;
      index.byDOI.delete(doi);
    }

    const titleCandidate = info.title || info.text || "";
    const cleanTitle = CitationVerifier.cleanTitle(titleCandidate);
    if (cleanTitle && cleanTitle.length >= 8 && index.byTitle.has(cleanTitle)) {
      const candidates = index.byTitle.get(cleanTitle)!;
      const alive: Zotero.Item[] = [];
      for (let i = candidates.length - 1; i >= 0; i--) {
        const item = candidates[i];
        if (!isRegularLibraryItem(item)) {
          candidates.splice(i, 1);
          continue;
        }
        alive.push(item);
      }
      if (!alive.length) return undefined;
      return selectLibraryMatch(info, alive);
    }

    return undefined;
  }
}

export default LibraryMatchIndex;
