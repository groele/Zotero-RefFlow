import './setup';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import BatchImporter from '../src/modules/batchImporter';

test('timed-out DOI translator discovery cannot start a late metadata request',async()=>{
 const z:any=Zotero,original=z.Translate;let release!:(value:any)=>void,requests=0;
 z.Translate={Search:class{setIdentifier(){}getTranslators(){return new Promise(resolve=>release=resolve);}setTranslator(){}async translate(){requests++;return [{DOI:'10.1234/late',title:'Late'}];}}};
 try{
  await assert.rejects((BatchImporter as any).translatedMetadata('10.1234/late',5),(error:any)=>error.code==='timeout');
  release(['late translator']);await new Promise(resolve=>setTimeout(resolve,5));assert.equal(requests,0);
 }finally{z.Translate=original;}
});

test('aborted DOI discovery remains unable to start a late metadata request',async()=>{
 const z:any=Zotero,original=z.Translate,controller=new AbortController();let release!:(value:any)=>void,requests=0;
 z.Translate={Search:class{setIdentifier(){}getTranslators(){return new Promise(resolve=>release=resolve);}setTranslator(){}async translate(){requests++;return [];}}};
 try{const job=(BatchImporter as any).translatedMetadata('10.1234/late',1000,controller.signal);controller.abort();await assert.rejects(job,(error:any)=>error.name==='AbortError');release(['late translator']);await new Promise(resolve=>setTimeout(resolve,5));assert.equal(requests,0);}
 finally{z.Translate=original;}
});
