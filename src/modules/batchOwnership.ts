export interface BatchUse {id:number;parents:number[];collections:number[];}
export interface CreatedState {metadata:string;collections:number[];related:string[];}
export interface CollectionState {key:string;name:string;parentID:number|false;}
export interface BatchRecord {
  version:1|2;parentID:number;libraryID:number;createdIDs:number[];noteID?:number;collectionID?:number;
  relations:Array<{id:number;parentID?:number;parentAdded:boolean;itemAdded:boolean}>;
  memberships:Array<{id:number;collectionID:number}>;attachments:Array<{id:number;parentID:number;metadata?:string}>;
  noteState?:string;
  collectionState?:CollectionState;
  uses?:BatchUse[];states?:Record<string,CreatedState>;
}
/** Validate local and legacy journals before using their ownership evidence. */
export function validateBatchRecord(value:any,parentID:number,libraryID:number):BatchRecord {
  const id=(n:any)=>Number.isSafeInteger(n)&&n>0;
  const ids=(rows:any)=>Array.isArray(rows)&&rows.every(id);
  const rows=(entries:any,valid:(entry:any)=>boolean)=>Array.isArray(entries)&&entries.every(entry=>entry&&typeof entry==='object'&&valid(entry));
  if(!value||![1,2].includes(value.version)||value.parentID!==parentID||value.libraryID!==libraryID)
    throw new Error('Batch ownership does not match this parent item');
  const valid=ids(value.createdIDs)&&new Set(value.createdIDs).size===value.createdIDs.length&&!value.createdIDs.includes(parentID)&&
    rows(value.relations,row=>id(row.id)&&(row.parentID===undefined||id(row.parentID))&&typeof row.parentAdded==='boolean'&&typeof row.itemAdded==='boolean')&&
    rows(value.memberships,row=>id(row.id)&&id(row.collectionID))&&
    rows(value.attachments,row=>id(row.id)&&id(row.parentID)&&(row.metadata===undefined||typeof row.metadata==='string'))&&
    (value.noteID===undefined||id(value.noteID))&&(value.collectionID===undefined||id(value.collectionID))&&
    (value.noteState===undefined||typeof value.noteState==='string')&&
    (value.uses===undefined||rows(value.uses,row=>id(row.id)&&ids(row.parents)&&ids(row.collections)))&&
    (value.states===undefined||value.states&&typeof value.states==='object'&&!Array.isArray(value.states)&&Object.entries(value.states).every(([key,state]:[string,any])=>id(Number(key))&&state&&typeof state.metadata==='string'&&ids(state.collections)&&Array.isArray(state.related)&&state.related.every((key:any)=>typeof key==='string')))&&
    (value.collectionState===undefined||value.collectionState&&typeof value.collectionState.key==='string'&&typeof value.collectionState.name==='string'&&(value.collectionState.parentID===false||id(value.collectionState.parentID)));
  if(!valid)throw new Error('Cannot safely reconcile a malformed import journal');
  return value;
}
export function collectionState(collection:any):CollectionState {
  return {key:String(collection.key||''),name:String(collection.name||''),parentID:collection.parentID||false};
}
export function sameCollectionState(collection:any,state?:CollectionState):boolean {
  if(!state)return false;
  const current=collectionState(collection);
  return current.key===state.key&&current.name===state.name&&current.parentID===state.parentID;
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
