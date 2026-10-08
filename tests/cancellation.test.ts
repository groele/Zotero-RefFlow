import './setup';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import Requests from '../src/modules/requests';
import API from '../src/modules/api';
import {referenceIdentity} from '../src/modules/referenceIdentity';

test('cancelling one subscriber preserves the shared request for another pane',async()=>{
 const original=Zotero.HTTP.request;let calls=0,cancelled=0,release:any;
 Zotero.HTTP.request=async(_m:string,_u:string,o:any)=>{calls++;o.cancellerReceiver(()=>cancelled++);return new Promise(resolve=>{release=resolve;});};
 const client=new Requests(),a=new AbortController(),b=new AbortController();
 try{const first=client.get('https://fixture/shared','json',{},a.signal),second=client.get('https://fixture/shared','json',{},b.signal);a.abort();assert.equal(await first,undefined);assert.equal(cancelled,0);release({status:200,response:{ok:true}});assert.deepEqual(await second,{ok:true});assert.equal(calls,1);assert.equal(client.metrics.deduplicated,1);}finally{client.dispose();Zotero.HTTP.request=original;}
});
test('cancelling the last subscriber physically cancels once and discards late results',async()=>{
 const original=Zotero.HTTP.request;let cancelled=0,release:any;
 Zotero.HTTP.request=async(_m:string,_u:string,o:any)=>{o.cancellerReceiver(()=>cancelled++);return new Promise(resolve=>{release=resolve;});};
 const client=new Requests(),controller=new AbortController();
 try{const pending=client.get('https://fixture/cancel','json',{},controller.signal);controller.abort();assert.equal(await pending,undefined);assert.equal(cancelled,1);release({status:200,response:{late:true}});await new Promise(resolve=>setTimeout(resolve,5));assert.equal((client as any).cache.size,0);assert.equal((client as any).inFlight.size,0);}finally{client.dispose();Zotero.HTTP.request=original;}
});
test('an aborted queued subscription frees queue capacity without sending HTTP',async()=>{
 const original=Zotero.HTTP.request;let calls=0,release:any;Zotero.HTTP.request=async()=>{calls++;return new Promise(resolve=>{release=resolve;});};
 const client=new Requests({maxConcurrent:1,maxQueued:1}),controller=new AbortController();
 try{const first=client.get('https://fixture/first'),queued=client.get('https://fixture/queued','json',{},controller.signal);assert.equal((client as any).queue.length,1);controller.abort();await queued;assert.equal((client as any).queue.length,0);assert.equal(calls,1);release({status:200,response:1});await first;}finally{client.dispose();Zotero.HTTP.request=original;}
});
test('already aborted callers do not use cached data or launch HTTP',async()=>{
 const client=new Requests(),controller=new AbortController();await client.get('https://fixture/cached');const count=client.metrics.requests;controller.abort();assert.equal(await client.get('https://fixture/cached','json',{},controller.signal),undefined);assert.equal(client.metrics.requests,count);client.dispose();
});
test('a replacement same-URL request survives cleanup of an abandoned flight',async()=>{
 const original=Zotero.HTTP.request;let calls=0;Zotero.HTTP.request=async(_m:string,_u:string,o:any)=>{calls++;o.cancellerReceiver(()=>{});return calls===1?new Promise(()=>{}):{status:200,response:{new:true}};};
 const client=new Requests(),controller=new AbortController();
 try{const old=client.get('https://fixture/replaced','json',{},controller.signal);controller.abort();const replacement=client.get('https://fixture/replaced');await old;assert.deepEqual(await replacement,{new:true});assert.deepEqual(await client.get('https://fixture/replaced'),{new:true});assert.equal(calls,2);}finally{client.dispose();Zotero.HTTP.request=original;}
});
test('optional enrichment deadline aborts its child request',async()=>{
 const api=new API({} as any);let aborted=false;
 const value=await (api as any).optional((signal:AbortSignal)=>new Promise(resolve=>{signal.addEventListener('abort',()=>{aborted=true;resolve(undefined);});}),10,undefined);
 assert.equal(value,undefined);assert.equal(aborted,true);api.requests.dispose();api.publisherReferences.dispose();
});
test('Retry-After beyond a day is not shortened to an early retry',async()=>{
 const original=Zotero.HTTP.request;Zotero.HTTP.request=async()=>({status:429,getResponseHeader:(name:string)=>name==='Retry-After'?'172800':null});const client=new Requests({budgetMs:100});
 try{await client.get('https://fixture/long-cooldown');assert.equal(client.lastFailure?.retryAfterMs,172800000);}finally{client.dispose();Zotero.HTTP.request=original;}
});
test('UI identity survives DOI case/URL changes and distinguishes author-year works',()=>{
 assert.equal(referenceIdentity({identifiers:{DOI:'https://doi.org/10.1234/ABC'}} as any),referenceIdentity({identifiers:{DOI:'10.1234/abc'}} as any));
 assert.notEqual(referenceIdentity({title:'A common title',year:'2023',authors:['A'],identifiers:{}} as any),referenceIdentity({title:'A common title',year:'2024',authors:['A'],identifiers:{}} as any));
});
