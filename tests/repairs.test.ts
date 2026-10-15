import './setup';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workIdentity,selectLibraryMatch} from '../src/modules/workIdentity';
import {usesItem,needsRelation,needsMembership,metadataFingerprint,BatchRecord} from '../src/modules/batchOwnership';
import {preferCachedReferences,cacheReferenceResult,readCachedReferenceResult} from '../src/modules/referenceCache';
import {validateGraph} from '../src/modules/graphModel';
import {SharedRequestScheduler} from '../src/modules/requestScheduler';
import Utils from '../src/modules/utils';
import API from '../src/modules/api';

const title='Quantum optical response in layered semiconductors';
const ref=(extra:any={})=>({title,authors:[],identifiers:{},...extra});
const item=(id:number,author='Smith',year='2024',doi='')=>({id,deleted:false,isRegularItem:()=>true,getField:(field:string)=>({title,DOI:doi,date:year} as any)[field]||'',getCreators:()=>[{lastName:author}]}) as any;
test('local candidates corroborate author and year and reject ambiguous DOI identities',()=>{
  assert.equal(selectLibraryMatch(ref({authors:['Jones'],year:'2024'}),[item(1,'Smith','1995')]),undefined);
  assert.equal(selectLibraryMatch(ref(),[item(1,'Smith','2024','10.1234/a'),item(2,'Smith','2024','10.1234/b')]),undefined);
  assert.equal(selectLibraryMatch(ref({authors:['Smith'],year:'2024'}),[item(1)])?.id,1);
  assert.equal(selectLibraryMatch(ref({identifiers:{DOI:'10.1234/a'}}),[item(1,'Jones','1995','10.1234/a')])?.id,1);
});
test('batch and cache identity distinguish metadata and non-DOI provider identifiers',()=>{
  assert.notEqual(workIdentity(ref({authors:['Smith'],year:'1995'})),workIdentity(ref({authors:['Jones'],year:'2024'})));
  assert.notEqual(workIdentity(ref({identifiers:{CNKI:'https://kns.cnki.net/x?FileName=A&DbCode=CJFD'}})),workIdentity(ref({identifiers:{CNKI:'https://kns.cnki.net/x?FileName=B&DbCode=CJFD'}})));
  assert.equal(workIdentity(ref({identifiers:{DOI:'https://doi.org/10.1234/ABC'}})),workIdentity(ref({identifiers:{DOI:'10.1234/abc'}})));
});
test('reused rows lease existing relations and collections even when they create no new changes',()=>{
  const record:BatchRecord={version:2,parentID:1,libraryID:1,createdIDs:[],relations:[],memberships:[],attachments:[],uses:[{id:2,parents:[1,3],collections:[4]}]};
  assert.equal(usesItem(record,2),true);assert.equal(needsRelation(record,2,3),true);assert.equal(needsRelation(record,2,9),false);assert.equal(needsMembership(record,2,4),true);
});
test('rollback metadata fingerprints ignore host version changes but detect user edits',()=>{
  let value={title,version:1,dateModified:'first',relations:{a:1},collections:[1],extra:'import_batch: refnexus_batch_a'};
  const row:any={toJSON:()=>({...value})};const first=metadataFingerprint(row);
  value={...value,version:2,dateModified:'later',relations:{a:2}};assert.equal(metadataFingerprint(row),first);
  value={...value,title:'Edited title'};assert.notEqual(metadataFingerprint(row),first);
});
test('complete cached evidence survives a shorter partial attempt without source mutation',()=>{
  const old={references:[ref(),ref({title:'Second reference'})],source:'PDF',partial:false};
  const next={references:[ref()],source:'Online',partial:true,expected:2};
  const chosen=preferCachedReferences(next,old,'Offline');assert.equal(chosen.retained,true);assert.equal(chosen.references.length,2);assert.equal(chosen.source,'PDF');assert.equal(chosen.latestAttempt?.count,1);
  assert.equal(preferCachedReferences({...next,partial:false,expected:1},old,'Offline').retained,undefined);
  const restored=readCachedReferenceResult(cacheReferenceResult(next,'signature'),'signature');assert.equal(restored?.partial,true);
});
test('GB/T parsed volume issue and pages survive metadata serialization',()=>{
  const utils=new Utils();const value=utils.refText2Info('张三, 李四. 二维材料中的谷极化研究[J]. 物理学报, 2024, 73(4): 12-18.');
  assert.equal(value.volume,'73');assert.equal(value.issue,'4');assert.equal(value.pages,'12-18');
  assert.equal(readCachedReferenceResult(cacheReferenceResult({references:[value],source:'PDF'},'sig'),'sig')?.references[0].pages,'12-18');utils.API.requests.dispose();utils.API.publisherReferences.dispose();
});
test('Crossref reports conversion losses even without reference-count',async()=>{
  const api=new API({} as any);api.requests.get=async()=>({message:{DOI:'10.1234/loss',title:['Parent'],reference:[null,{'article-title':'Valid reference record'}]}});api.openAlex.getWorkByDOI=async()=>undefined;
  try{const value=await api.getDOIInfoByCrossref('10.1234/loss');assert.equal(value?.referencePartial,true);assert.equal(value?.references?.[0].number,2);}finally{api.requests.dispose();api.publisherReferences.dispose();}
});
test('graph validation rejects invalid publications, dangling edges and excessive input',()=>{
  assert.throws(()=>validateGraph({nodes:[]}),/nodes/);assert.throws(()=>validateGraph({nodes:{x:{title:'Paper'}},edges:[['x','unknown',1]]}),/invalid node/);
  assert.throws(()=>validateGraph({nodes:{x:{title:null}}}),/publication/);
  const result=validateGraph({nodes:{x:{title:'Paper'}},edges:[]});assert.equal(result.nodes.x.paperId,'x');assert.deepEqual(result.common_citations,[]);
});
test('shared provider admission bounds concurrency across clients and isolates credentials',async()=>{
  const scheduler=new SharedRequestScheduler();let active=0,maximum=0;
  const work=async()=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,8));active--;return 1;};
  await Promise.all(Array.from({length:8},()=>scheduler.run('provider:keyA',work,Date.now()+1000,undefined,2)));
  assert.equal(maximum,2);assert.deepEqual(scheduler.usage,{scopes:0,active:0,queued:0});
  let release!:()=>void;const first=scheduler.run('provider:keyA',()=>new Promise<void>(resolve=>release=resolve),Date.now()+1000,undefined,1);
  assert.equal(await scheduler.run('provider:keyB',async()=>2,Date.now()+1000,undefined,1),2);release();await first;
});
test('shared queued cancellation releases admission without starting physical work',async()=>{
  const scheduler=new SharedRequestScheduler(),controller=new AbortController();let release!:()=>void,started=false;
  const first=scheduler.run('service',()=>new Promise<void>(resolve=>release=resolve),Date.now()+1000,undefined,1);
  const queued=scheduler.run('service',async()=>{started=true;},Date.now()+1000,controller.signal,1);controller.abort();await queued;assert.equal(started,false);assert.equal(scheduler.usage.queued,0);release();await first;assert.equal(scheduler.usage.scopes,0);
});
test('library-scoped invalidation preserves unrelated cached matches and active generations',()=>{
  const utils:any=new Utils();utils.itemCache.set('1:a',{});utils.itemCache.set('2:b',{});utils.clearLibraryItemCache(new Set([1]));assert.equal(utils.itemCache.has('1:a'),false);assert.equal(utils.itemCache.has('2:b'),true);assert.equal(utils.itemCacheGeneration,0);assert.equal(utils.libraryGenerations.get(1),1);utils.API.requests.dispose();utils.API.publisherReferences.dispose();
});
