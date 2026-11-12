/** Scroll windows share an index until the displayed list, filter or search changes. */
export class ListIndices {
  private refs?: ItemBaseInfo[];
  private original?: ItemBaseInfo[];
  private query?: string;
  private filterKey?: string;
  private indices: number[] = [];
  private numbers: number[] = [];
  private width = 2;

  forList(
    refs: ItemBaseInfo[],
    original: ItemBaseInfo[],
    query: string,
    matches: (ref: ItemBaseInfo) => boolean,
    filterKey = "all",
  ) {
    if (this.refs !== refs || this.original !== original) {
      this.refs = refs;
      this.original = original;
      this.query = undefined;
      this.filterKey = undefined;
      const positions = new Map(original.map((ref, index) => [ref, index + 1]));
      this.numbers = refs.map((ref, index) =>
        Number.isSafeInteger(Number(ref.number)) && Number(ref.number) > 0
          ? Number(ref.number)
          : positions.get(ref) || index + 1,
      );
      this.width = this.numbers.reduce((width, number) => Math.max(width, String(number).length + 1), 2);
    }
    if (this.query !== query || this.filterKey !== filterKey) {
      this.query = query;
      this.filterKey = filterKey;
      this.indices = [];
      // Always apply matches so filter modes work even when the search box is empty.
      refs.forEach((ref, index) => {
        if (matches(ref)) this.indices.push(index);
      });
    }
    return { indices: this.indices, numbers: this.numbers, width: this.width };
  }
}
