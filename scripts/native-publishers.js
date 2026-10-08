if(!/refnexus-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const report={version:Zotero.version,at:new Date().toISOString(),tests:[],scope:'Real native DOM/Reader/SQLite; synthetic publisher layouts labeled separately from live services'};
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const check=(ok,message)=>{if(!ok)throw new Error(message)};
const test=async(name,fn)=>{const start=Date.now();try{const detail=await fn();report.tests.push({name,ok:true,ms:Date.now()-start,detail});}catch(error){report.tests.push({name,ok:false,ms:Date.now()-start,error:String(error),stack:error?.stack});}await save();};
const views=Zotero.ZoteroRefNexus.views,provider=views.utils.API.publisherReferences;
const fixtures=[
 ['Nature / Springer','https://www.nature.com/articles/fixture','ol','c-article-references','li','c-article-references__item'],
 ['Elsevier','https://www.sciencedirect.com/science/article/pii/fixture','div','references','div','bib-reference'],
 ['Wiley','https://onlinelibrary.wiley.com/doi/10.1234/fixture','ol','references','li','citation'],
 ['ACS','https://pubs.acs.org/doi/10.1234/fixture','ol','references','li','NLM_ref'],
 ['RSC','https://pubs.rsc.org/en/content/articlehtml/fixture','ol','references','li','reference'],
 ['APS','https://journals.aps.org/prl/abstract/fixture','ol','references','li','bibitem'],
 ['AIP / IOP','https://pubs.aip.org/apl/article/fixture','ol','ref-list','li','ref'],
 ['Taylor & Francis','https://www.tandfonline.com/doi/full/10.1234/fixture','ol','references','li','citation'],
 ['PLOS','https://journals.plos.org/plosone/article?id=10.1234/fixture','ol','references','li',''],
 ['MDPI','https://www.mdpi.com/fixture','ol','html-refs','li','html-ref'],
 ['Frontiers','https://www.frontiersin.org/articles/fixture','div','references','div','Reference'],
 ['eLife','https://elifesciences.org/articles/fixture','ol','reference-list','li','reference'],
 ['Science / PNAS','https://www.science.org/doi/10.1234/fixture','ol','references','li','citation']
];
for(const [name,url,parent,container,tag,entry] of fixtures)await test('synthetic native HTML layout: '+name,async()=>{
 const html='<html><head><meta name="citation_doi" content="10.1234/fixture"></head><body><h1>Fixture article identity</h1><div class="recommendations">Unrelated recommendation</div><'+parent+' class="'+container+'">'+Array.from({length:3},(_,i)=>'<'+tag+' class="'+entry+'"><span class="ref-label">'+(i+1)+'.</span> Smith, J. Fixture citation '+(i+1)+'. Journal, 2024. <a href="https://doi.org/10.1234/ref'+(i+1)+'">DOI</a><button>Download</button></'+tag+'>').join('')+'</'+parent+'></body></html>';
 const references=provider.parseHTML(html,url,'10.1234/fixture');check(references.length===3,'Wrong bibliography count '+references.length);check(references.every((ref,i)=>ref.identifiers.DOI==='10.1234/ref'+(i+1)),'DOI/order lost');check(references.every(ref=>!ref.text.includes('Download')),'Action text leaked');check(provider.parseHTML(html,url,'10.1234/other').length===0,'Wrong parent accepted');return {fixture:true,references:references.length};
});
await test('native JATS parses mixed and element citations and rejects parent mismatch',async()=>{
 const xml='<article><front><article-meta><article-id pub-id-type="doi">10.1234/fixture</article-id></article-meta></front><back><ref-list><ref id="r1"><label>1</label><mixed-citation>Smith, J. <article-title>Mixed citation title</article-title>. <source>Nature</source> (<year>2024</year>). <pub-id pub-id-type="doi">10.1234/ref1</pub-id></mixed-citation></ref><ref id="r2"><label>2</label><element-citation><person-group><name><surname>Brown</surname><given-names>A.</given-names></name></person-group><article-title>Structured citation title</article-title><source>Science</source><year>2023</year><pub-id pub-id-type="doi">10.1234/ref2</pub-id></element-citation></ref></ref-list></back></article>';
 const refs=provider.parseXML(xml,'10.1234/fixture');check(refs.length===2,'JATS count wrong');check(refs[1].authors[0]==='A. Brown','JATS author lost');check(refs[1].text.includes('. Science. 2023.'),'Readable structured punctuation missing');check(provider.parseXML(xml,'10.1234/other').length===0,'Wrong XML parent accepted');return {references:2};
});
for(const [name,count] of [['science-notes',2],['nature-methods',4]])await test('native publisher PDF layout: '+name,async()=>{
 const parent=new Zotero.Item('journalArticle');parent.setField('title',name);await parent.saveTx();const attachment=await Zotero.Attachments.importFromFile({file:cfg.fixtures+'\\'+name+'.pdf',parentItemID:parent.id});const reader=await Zotero.Reader.open(attachment.id,undefined,{openInBackground:true});const refs=await views.utils.PDF.getReferences(reader,false,{notify:false});check(refs.length===count,'Expected '+count+' got '+refs.length);check(refs.every(ref=>!ref.text.includes('Attribution')&&!ref.text.includes('Methods body')),'Body/attribution leaked');return {fixture:true,references:refs.length,diagnostics:views.utils.PDF.getDiagnostics(reader)};
});
const select=async item=>{window.Zotero_Tabs.select('zotero-pane');await window.ZoteroPane.selectItem(item.id);await Zotero.Promise.delay(150);return window.document.querySelector('item-pane-custom-section[data-pane*="refnexus"] [data-type="body"]');};
await test('native automatic and publisher source options have translated visible labels',async()=>{
 const pref=Zotero.Utilities.Internal.openPreferences('refnexus-preferences');
 try{let menu;for(let i=0;i<100;i++){menu=pref.document.getElementById('refnexus-priority-source');if(menu)break;await Zotero.Promise.delay(100);}check(menu,'Priority menu absent');await pref.document.l10n.translateFragment(menu);for(const value of ['Auto','Web'])check(menu.querySelector('menuitem[value="'+value+'"]').getAttribute('label'),'Empty native label: '+value);return {options:4};}finally{pref.close();}
});
await test('native main PDF is preferred over the first supplementary attachment',async()=>{
 const parent=new Zotero.Item('journalArticle');parent.setField('title','Main PDF preference fixture');await parent.saveTx();
 const si=await Zotero.Attachments.importFromFile({file:cfg.fixtures+'\\numbered-prose.pdf',parentItemID:parent.id});si.setField('title','Supporting Information');await si.saveTx();
 const main=await Zotero.Attachments.importFromFile({file:cfg.fixtures+'\\single.pdf',parentItemID:parent.id});main.setField('title','Full Text');await main.saveTx();
 const chosen=await views.pdfAttachment(parent);check(chosen.id===main.id,'Supplement selected instead of main PDF');return {mainPreferred:true,attachments:2};
});
await test('native Auto uses a saved publisher snapshot without network and persists its source',async()=>{
 const parent=new Zotero.Item('journalArticle');parent.setField('title','Snapshot fixture paper');parent.setField('DOI','10.1234/snapshot');await parent.saveTx();
 const path=cfg.fixtures+'\\snapshot.html';await Zotero.File.putContentsAsync(path,'<html><meta name="citation_doi" content="10.1234/snapshot"><ol class="references"><li>1. Smith, J. Snapshot citation one. PLOS, 2024.</li><li>2. Brown, A. Snapshot citation two. PLOS, 2023.</li></ol></html>');
 const attachment=await Zotero.Attachments.importFromFile({file:path,parentItemID:parent.id});attachment.setField('url','https://journals.plos.org/plosone/article?id=10.1234/snapshot');await attachment.saveTx();
 const body=await select(parent);body.setAttribute('source','Auto');body.setAttribute('data-refnexus-type','References');const original=views.utils.API.getReferenceList;let calls=0;
 try{views.utils.API.getReferenceList=async()=>{calls++;throw new Error('No external requests expected');};await views.refreshReferences(body,false,false,false,parent);check(body.references.length===2,'Snapshot failed: '+body.querySelector('#reference-num').title);check(body.getAttribute('data-refnexus-result-source').includes('snapshot'),'Source not marked');check(calls===0,'Unnecessary network');await views.refreshReferences(body,true,false,false,parent);check(calls===0&&body.references.length===2,'Snapshot cache failed');const importedPath=await attachment.getFilePathAsync();const updated=String(await Zotero.File.getContentsAsync(importedPath)).replace('</ol>','<li>3. Lee, K. New snapshot citation. PLOS, 2022.</li></ol>');await Zotero.File.putContentsAsync(importedPath,updated);await views.refreshReferences(body,true,false,false,parent);check(body.references.length===3,'Changed snapshot still used stale cache');return {references:3,networkCalls:calls,source:body.getAttribute('data-refnexus-result-source'),fileCacheInvalidation:true};}finally{views.utils.API.getReferenceList=original;}
});
await test('native Auto and PDF modes fall back without a PDF and retain cached results offline',async()=>{
 const parent=new Zotero.Item('journalArticle');parent.setField('title','No PDF fallback fixture');parent.setField('DOI','10.1234/fallback');await parent.saveTx();const body=await select(parent);body.setAttribute('data-refnexus-type','References');const original=views.utils.API.getReferenceList;
 try{
  views.utils.API.getReferenceList=async()=>({references:[{text:'Smith, J. Automatic online fallback. Journal, 2024.',title:'Automatic online fallback',identifiers:{},authors:[],number:1}],source:'Crossref'});
  body.setAttribute('source','Auto');await views.refreshReferences(body,false,false,false,parent);check(body.references.length===1,'Auto fallback failed');
  views.utils.API.getReferenceList=async()=>{throw new Error('Offline fixture');};await views.refreshReferences(body,false,false,false,parent);check(body.references.length===1&&body.getAttribute('data-refnexus-result-source').includes('缓存'),'Auto offline cache failed');
  views.utils.API.getReferenceList=async()=>({references:[{text:'Smith, J. PDF mode online fallback. Journal, 2024.',identifiers:{},authors:[],number:1}],source:'Crossref'});body.setAttribute('source','PDF');await views.refreshReferences(body,false,false,false,parent);check(body.references.length===1,'PDF fallback failed');return {auto:true,pdf:true,offlineCache:true};
 }finally{views.utils.API.getReferenceList=original;}
});
await test('live PLOS HTML bibliography',async()=>{const refs=await provider.getReferences('10.1371/journal.pone.0000308','https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0000308');check(refs.length>=10,'PLOS failed');return {references:refs.length,source:refs[0].sources[0]};});
await test('live Nature through publisher or PMC JATS fallback',async()=>{const refs=await provider.getReferences('10.1038/s41586-021-03819-2','https://www.nature.com/articles/s41586-021-03819-2');check(refs.length>=50,'Nature failed: '+JSON.stringify(provider.requests.lastFailure));return {references:refs.length,source:refs[0].sources[0]};});
await test('live PMC JATS DOI lookup and XML references',async()=>{const refs=await provider.getReferences('10.1038/s41586-021-03819-2');check(refs.length>=50,'PMC JATS failed: '+JSON.stringify(provider.requests.lastFailure));check(refs[0].sources[0]==='PMC JATS','Did not use XML');return {references:refs.length,source:refs[0].sources[0]};});
for(const [publisher,doi] of [['Elsevier','10.1016/j.cell.2012.11.027'],['ACS','10.1021/acsnano.7b05743'],['APS','10.1103/PhysRevLett.105.136805'],['RSC','10.1039/C4CS00265B'],['Wiley','10.1002/adpr.202400014']])await test('live publisher metadata references: '+publisher,async()=>{
 const info=await views.utils.API.getDOIInfoByCrossref(doi);check(info?.references?.length>0,'No references: '+doi);return {doi,references:info.references.length,source:info.references[0].sources,expected:info.referenceExpected,partial:info.referencePartial};
});
report.finished=new Date().toISOString();report.passed=report.tests.filter(test=>test.ok).length;report.failed=report.tests.filter(test=>!test.ok).length;await save();
