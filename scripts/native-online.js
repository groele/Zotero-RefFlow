if(!/refnexus-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated release profile required');
const report={version:Zotero.version,at:new Date().toISOString(),tests:[],scope:'Live public Crossref and OpenAlex APIs; no service responses mocked'};
const save=()=>Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
const check=(ok,message)=>{if(!ok)throw new Error(message)};
const test=async(name,fn)=>{const start=Date.now();try{report.tests.push({name,ok:true,detail:await fn(),ms:Date.now()-start});}catch(error){report.tests.push({name,ok:false,ms:Date.now()-start,error:String(error)});}await save();};
const views=Zotero.ZoteroRefNexus.views,doi='10.1038/nphys1170';
await test('live multi-provider reference list includes bibliographic metadata',async()=>{
 const result=await views.utils.API.getDOIInfoByCrossref(doi);check(result?.references?.length>0,'No references from live services');check(result.references.some(ref=>ref.title||ref.text),'Reference metadata missing');return {doi,count:result.references.length,first:result.references[0].text||result.references[0].title};
});
for(const type of ['Citations','Related'])await test('live OpenAlex '+type+' and native mode cache',async()=>{
 const parent=new Zotero.Item('journalArticle');parent.setField('title','Valley-contrasting physics in graphene');parent.setField('DOI',doi);await parent.saveTx();window.Zotero_Tabs.select('zotero-pane');await window.ZoteroPane.selectItem(parent.id);await Zotero.Promise.delay(150);
 const body=window.document.querySelector('item-pane-custom-section[data-pane*="refnexus"] [data-type="body"]');body.setAttribute('data-refnexus-type',type);body.setAttribute('source','PDF');
 await views.refreshReferences(body,false,false,false,parent);check(body.getAttribute('source')==='API','Literature type did not switch to online');check(body.references?.length>0,'Live mode failed: '+body.querySelector('#reference-num').textContent+' '+body.querySelector('#reference-num').title+' '+JSON.stringify(views.utils.API.requests.lastFailure));
 const count=body.references.length;check(body.querySelectorAll('.reference-item').length===count,'Cards incomplete');check(body.getAttribute('data-refnexus-result-source').includes('OpenAlex'),'Provider label missing');await views.refreshReferences(body,true,false,false,parent);check(body.references.length===count,'Cached mode lost results');return {doi,count,source:body.getAttribute('data-refnexus-result-source')};
});
await test('real arXiv metadata uses the native XML parser',async()=>{
 const info=await views.utils.API.getArXivInfo('1706.03762');check(info?.title==='Attention Is All You Need','Wrong arXiv metadata');check(info.authors.length>=8 && info.year==='2017','Authors/year missing');return {title:info.title,authors:info.authors.length,year:info.year};
});
await test('real public paper PDF is extracted by native Zotero Reader',async()=>{
 const parent=new Zotero.Item('journalArticle');parent.setField('title','Public arXiv PDF regression');await parent.saveTx();const attachment=await Zotero.Attachments.importFromFile({file:cfg.fixtures+'\\real-arxiv-1706.03762.pdf',parentItemID:parent.id});const reader=await Zotero.Reader.open(attachment.id,undefined,{openInBackground:true});
 const refs=await views.utils.PDF.getReferences(reader,false,{notify:false});const diagnostics=views.utils.PDF.getDiagnostics(reader);check(refs.length>=20,'Too few references in real paper: '+refs.length);check(diagnostics.headingFound,'Real reference heading not found');return {source:'https://arxiv.org/pdf/1706.03762',references:refs.length,diagnostics};
});
report.finished=new Date().toISOString();report.passed=report.tests.filter(test=>test.ok).length;report.failed=report.tests.filter(test=>!test.ok).length;await save();
