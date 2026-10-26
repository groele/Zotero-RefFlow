import './setup';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectLibraryMatch} from '../src/modules/workIdentity';
import BatchImporter from '../src/modules/batchImporter';
import {validateBatchRecord,collectionState,sameCollectionState} from '../src/modules/batchOwnership';

test('an explicit DOI cannot be overridden by a conflicting arXiv match',()=>{
 const ref:any={title:'Shared preprint title',authors:[],identifiers:{DOI:'10.1234/published',arXiv:'2401.12345'}};
 const other:any={id:1,deleted:false,isRegularItem:()=>true,getCreators:()=>[],getField:(key:string)=>({DOI:'10.1234/different',url:'https://arxiv.org/abs/2401.12345',title:ref.title} as any)[key]||''};
 assert.equal(selectLibraryMatch(ref,[other]),undefined);
});

test('DOI and CNKI identity conflicts remain distinct local works',()=>{
 const url='https://kns.cnki.net/kcms/detail?dbcode=CJFD&filename=ABC202401001';
 const ref:any={title:'Shared title',authors:[],identifiers:{DOI:'10.1234/published',CNKI:url}};
 const other:any={id:1,deleted:false,isRegularItem:()=>true,getCreators:()=>[],getField:(key:string)=>({DOI:'10.1234/different',url,title:ref.title} as any)[key]||''};
 assert.equal(selectLibraryMatch(ref,[other]),undefined);
});

test('pane-scoped cancellation preserves another pane importing the same parent',()=>{
 const original=(BatchImporter as any).sessions;const a=new AbortController(),b=new AbortController(),paneA={},paneB={};
 (BatchImporter as any).sessions=new Map([[a,{parentID:1,owner:paneA}],[b,{parentID:1,owner:paneB}]]);
 try{(BatchImporter.cancelImports as any)(1,paneA);assert.equal(a.signal.aborted,true);assert.equal(b.signal.aborted,false);}
 finally{(BatchImporter as any).sessions=original;}
});

test('closing one owner does not stop unowned API jobs or another owner',()=>{
 const original=(BatchImporter as any).sessions,owner={},a=new AbortController(),b=new AbortController(),c=new AbortController();
 (BatchImporter as any).sessions=new Map([[a,{parentID:1,owner}],[b,{parentID:2}],[c,{parentID:1,owner:{}}]]);
 try{BatchImporter.cancelImports(undefined,owner);assert.equal(a.signal.aborted,true);assert.equal(b.signal.aborted,false);assert.equal(c.signal.aborted,false);BatchImporter.cancelImports();assert.equal(b.signal.aborted,true);assert.equal(c.signal.aborted,true);}
 finally{(BatchImporter as any).sessions=original;}
});

test('edited or unverified collection identities are never treated as owned empty containers',()=>{
 const col:any={key:'COLKEY01',name:'Batch',parentID:false},baseline=collectionState(col);
 assert.equal(sameCollectionState(col,baseline),true);assert.equal(sameCollectionState(col),false);
 assert.equal(sameCollectionState({...col,name:'User research'},baseline),false);
 assert.equal(sameCollectionState({...col,parentID:9},baseline),false);
 assert.equal(sameCollectionState({...col,key:'NEWKEY01'},baseline),false);
});

test('malformed ownership journal subrecords fail before reconciliation',()=>{
 const record={version:2,parentID:1,libraryID:1,createdIDs:[2],relations:[],memberships:[],attachments:[],uses:[],states:{}};
 assert.equal(validateBatchRecord(record,1,1),record);
 for(const corrupt of [
  {...record,createdIDs:[1]}, {...record,createdIDs:[2,2]}, {...record,createdIDs:['2']},
  {...record,attachments:null}, {...record,relations:[{id:2,parentAdded:'true',itemAdded:true}]},
  {...record,uses:[{id:2,parents:null,collections:[]}]},
  {...record,states:{2:{metadata:'baseline',collections:[],related:null}}},
  {...record,collectionState:{key:'COL',name:'Batch',parentID:-1}}
 ])assert.throws(()=>validateBatchRecord(corrupt,1,1),/malformed/);
});
