export interface BatchUse {id:number;parents:number[];collections:number[];}
export interface CreatedState {metadata:string;collections:number[];related:string[];}
export interface BatchRecord {
  version:1|2;parentID:number;libraryID:number;createdIDs:number[];noteID?:number;collectionID?:number;
  relations:Array<{id:number;parentID?:number;parentAdded:boolean;itemAdded:boolean}>;
  memberships:Array<{id:number;collectionID:number}>;attachments:Array<{id:number;parentID:number;metadata?:string}>;
  noteState?:string;
  uses?:BatchUse[];states?:Record<string,CreatedState>;
}
export function metadataFingerprint(item:Zotero.Item):string {
  const value:any=typeof (item as any).toJSON==='function'?(item as any).toJSON():{
    title:item.getField('title'),DOI:item.getField('DOI'),date:item.getField('date'),creators:item.getCreators?.(),tags:item.getTags?.()};
  for(const key of ['key','version','dateAdded','dateModified','collections','relations'])delete value[key];
  if(typeof value.extra==='string')value.extra=value.extra.split(/\r?\n/).filter((line:string)=>!/^import_batch: |^refnexus_(?:batch_parent|record_)/.test(line)).join('\n');
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))));
}
export function usesItem(record:BatchRecord,id:number):boolean {
  return Boolean(record.uses?.some(use=>use.id===id)||record.createdIDs.includes(id)||record.relations.some(edge=>edge.id===id)||record.memberships.some(row=>row.id===id));
}
export function needsRelation(record:BatchRecord,id:number,parentID:number):boolean {
  return Boolean(record.uses?.some(use=>use.id===id&&use.parents.includes(parentID))||record.relations.some(edge=>edge.id===id&&(edge.parentID||record.parentID)===parentID));
}
export function needsMembership(record:BatchRecord,id:number,collectionID:number):boolean {
  return Boolean(record.uses?.some(use=>use.id===id&&use.collections.includes(collectionID))||record.memberships.some(row=>row.id===id&&row.collectionID===collectionID));
}
