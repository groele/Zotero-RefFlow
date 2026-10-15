if (!/refflow-z10-release-/.test(Zotero.DataDirectory.dir)) throw new Error('Isolated profile required');
const views = Zotero.ZoteroRefFlow.views, api = views.utils.API;
const report = {version: Zotero.version, at: new Date().toISOString(), scope: 'Isolated native SQLite, SDT, pane and cache. External providers controlled; no live provider requests.', tests: []};
const stamp = Date.now();
const check = (ok, text) => {if (!ok) throw new Error(text);};
const delay = ms => Zotero.Promise.delay(ms);
const save = () => Zotero.File.putContentsAsync(cfg.output, JSON.stringify(report, null, 2));
const probe = async (name, run) => {
  try {const detail=await run();check(detail.bugReproduced===undefined?detail.invariantPassed:!detail.bugReproduced,'Original defect reproduced');report.tests.push({name,ok:true,detail});}
  catch (error) {report.tests.push({name,ok:false,error:String(error),stack:error.stack});}
  await save();
};
const make = async (title, author, year) => {
  const item = new Zotero.Item('journalArticle'); item.setField('title', title);
  if (year) item.setField('date', year);
  if (author) item.setCreators([{creatorType: 'author', lastName: author}]);
  await item.saveTx({skipSelect: true}); return item;
};
const row = (title, extra = {}) => ({title, text: title, authors: [], identifiers: {}, type: 'journalArticle', ...extra});
const panel = async (item, source) => {
  await window.ZoteroPane.selectItem(item.id); await delay(150);
  const body = window.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');
  check(body, 'Missing native pane'); body.setAttribute('source', source); body.setAttribute('data-refflow-type', 'References');return body;
};
Zotero.Prefs.set('refflow.autoRefresh', false);

await probe('Auto persists PDF references despite both save preferences being false', async () => {
  Zotero.Prefs.set('refflow.savePDFReferences', false); Zotero.Prefs.set('refflow.saveAPIReferences', false);
  const item = await make('Auto persistence audit ' + stamp);
  await Zotero.Attachments.importFromFile({file: cfg.fixtures + '\\single.pdf', parentItemID: item.id});
  const body = await panel(item, 'Auto'); await views.refreshReferences(body, true, false, false, item);
  const cached = await views.storage.getAsync(item, 'References-Auto'); await views.storage.flush();
  const disk = Zotero.File.pathToFile(views.storage.filename).exists()?JSON.parse(await Zotero.File.getContentsAsync(views.storage.filename)):{};
  check(body.references.length === 4, 'Expected actual four-row SDT extraction');
  const persisted = disk[`${item.libraryID}:${item.key}`]?.['References-Auto']?.references?.length;
  return {bugReproduced: persisted === 4, extracted: body.references.length, inMemory: cached?.references?.length, onDisk: persisted, source: body.getAttribute('data-refflow-result-source')};
});

await probe('Auto bypasses the CNKI capability that the API route reaches', async () => {
  const item = await make('中文参考文献自动获取路径审查' + stamp);
  const oldResolve = api.resolveWork, oldCNKI = api.getTitleInfoByCNKI, oldFile = api.getCNKIFileInfo;
  let calls = 0;
  try {
    api.resolveWork = async () => undefined;
    api.getTitleInfoByCNKI = async () => {calls++;return {identifiers:{CNKI:'https://kns.cnki.net/kcms/detail/detail.aspx?FileName=AUDIT&DbName=CJFDTOTAL&DbCode=CJFD'}};};
    api.getCNKIFileInfo = async () => ({references: [row('受控知网参考文献' + stamp)], referencePartial: false});
    const body = await panel(item, 'Auto');await views.refreshReferences(body, false, false, false, item);
    const autoCount = body.references.length, autoCalls = calls;
    body.setAttribute('source', 'API');await views.refreshReferences(body, false, false, false, item);
    return {bugReproduced: autoCalls === 0 && calls > 0 && body.references.length === 1, autoCount, autoCNKICalls: autoCalls, apiCount: body.references.length, apiCNKICalls: calls};
  } finally {api.resolveWork = oldResolve;api.getTitleInfoByCNKI = oldCNKI;api.getCNKIFileInfo = oldFile;}
});

await probe('Local title matching accepts conflicting author and year', async () => {
  const title = 'Local identity ambiguity audit ' + stamp;
  const existing = await make(title, 'Smith', '1995'); views.utils.clearLibraryItemCache();
  const found = await views.utils.searchLibraryItem(row(title, {authors:['Jones'],year:'2024'}), existing.libraryID);
  return {bugReproduced: found?.id === existing.id, requestedAuthor:'Jones', requestedYear:'2024', actualAuthor:'Smith', actualYear:'1995', linked:!!found};
});

await probe('Batch title-only identity collapses different author/year references', async () => {
  const parent = await make('Batch title identity parent ' + stamp);
  const title = 'Independent same title bibliography audit ' + stamp;
  const refs = [row(title,{authors:['Smith'],year:'1995'}),row(title,{authors:['Jones'],year:'2024'})];
  const result = await views.importReferences(parent,refs,{downloadOA:false,createSubCollection:false,createManifestNote:false});
  return {bugReproduced: result.importedCount===1 && result.existingCount===1 && refs[0]._item?.id===refs[1]._item?.id, imported:result.importedCount, reused:result.existingCount, linkedIDs:refs.map(ref=>ref._item?.id)};
});

await probe('Rollback trashes an item reused by a later batch on another parent', async () => {
  const first = await make('Rollback origin A ' + stamp), second = await make('Rollback origin B ' + stamp);
  const title = 'Cross batch ownership reference ' + stamp;
  const firstRefs = [row(title)], secondRefs = [row(title)];
  const opts = {downloadOA:false,createSubCollection:false,createManifestNote:false};
  const batchA = await views.importReferences(first,firstRefs,opts);
  const batchB = await views.importReferences(second,secondRefs,opts);
  const reused = secondRefs[0]._item;
  const relatedBefore = second.relatedItems.includes(reused.key);
  await views.rollbackReferences(first,batchA.batchId);
  const reloaded = await Zotero.Items.getAsync(reused.id);
  return {bugReproduced:batchB.existingCount===1 && relatedBefore && reloaded.deleted, laterBatchReused:batchB.existingCount, laterParentRelatedBefore:relatedBefore, itemDeletedAfterOlderRollback:reloaded.deleted, laterParentStillRelated:second.relatedItems.includes(reused.key)};
});

await probe('Manual PDF route bypasses unified numbering gap completeness', async () => {
  const item = await make('Manual PDF completeness ' + stamp);
  await Zotero.Attachments.importFromFile({file:cfg.fixtures+'\\single.pdf',parentItemID:item.id});
  const oldExtract = views.utils.PDF.getReferences;
  try {
    Zotero.Prefs.set('refflow.savePDFReferences',true);
    views.utils.PDF.getReferences = async () => [row('PDF controlled first record',{number:1}),row('PDF controlled third record',{number:3})];
    const body=await panel(item,'PDF');await views.refreshReferences(body,false,false,false,item);
    const cached=await views.storage.getAsync(item,'References-PDF');
    return {bugReproduced:body.references.length===2 && cached.snapshot.partial===false, numbers:body.references.map(ref=>ref.number), cachedPartial:cached.snapshot.partial, source:body.getAttribute('data-refflow-result-source')};
  }finally{views.utils.PDF.getReferences=oldExtract;}
});

await probe('Crossref early filtering hides malformed-row losses without expected count',async()=>{
  const oldGet=api.requests.get,oldOA=api.openAlex.getWorkByDOI;
  try{
    api.requests.get=async()=>({message:{DOI:'10.1234/audit-origin',title:['Audit parent'],reference:[null,{'article-title':'Valid reference after malformed row'}]}});
    api.openAlex.getWorkByDOI=async()=>undefined;
    const result=await api.getDOIInfoByCrossref('10.1234/audit-origin');
    return {bugReproduced:result.references.length===1 && result.referencePartial===false, inputRows:2, outputRows:result.references.length, partial:result.referencePartial};
  }finally{api.requests.get=oldGet;api.openAlex.getWorkByDOI=oldOA;}
});

await probe('Refresh replaces a complete cached list with a shorter partial result',async()=>{
  const item=await make('Cache downgrade ' + stamp); item.setField('DOI','10.1234/cache-audit');await item.saveTx();
  const oldList=api.getReferenceList;let round=0;
  try{
    Zotero.Prefs.set('refflow.saveAPIReferences',true);
    api.getReferenceList=async()=>++round===1?{references:[1,2,3,4,5].map(i=>row('Complete reference '+i)),source:'Controlled complete',expected:5,partial:false}:{references:[row('Partial reference')],source:'Controlled partial',expected:5,partial:true};
    const body=await panel(item,'API');await views.refreshReferences(body,false,false,false,item);
    const before=body.references.length;
    await views.refreshReferences(body,false,false,false,item);
    const cached=await views.storage.getAsync(item,'References-API');
    return {bugReproduced:before===5 && body.references.length===1 && cached.references.length===1, before,after:body.references.length,cachedAfter:cached.references.length,cachedPartial:cached.snapshot.partial};
  }finally{api.getReferenceList=oldList;}
});

await probe('Rapid source refresh preserves the newer pane result',async()=>{
  const item=await make('Audit stale response guard '+stamp);item.setField('DOI','10.1234/stale-audit');await item.saveTx();
  const oldList=api.getReferenceList;let release;
  try{
    const body=await panel(item,'API');
    api.getReferenceList=async()=>new Promise(resolve=>{release=resolve;});
    const first=views.refreshReferences(body,false,false,false,item);
    for(let i=0;!release&&i<100;i++)await delay(10);
    check(release,'Old request did not start');
    api.getReferenceList=async()=>({references:[row('Newer result')],source:'Newer'});
    await views.refreshReferences(body,true,false,false,item);
    release({references:[row('Stale result')],source:'Stale'});await first;await delay(100);
    return {invariantPassed:body.references[0]?.title==='Newer result',finalTitle:body.references[0]?.title};
  }finally{api.getReferenceList=oldList;}
});

await probe('Parsed GB/T volume issue and pages are lost before native import',async()=>{
  const parent=await make('GBT metadata parent '+stamp);
  const text='张三, 李四. 二维材料中的谷极化研究'+stamp+'[J]. 物理学报, 2024, 73(4): 12-18.';
  const ref=views.utils.refText2Info(text);
  const result=await views.importReferences(parent,[ref],{downloadOA:false,createSubCollection:false,createManifestNote:false});
  check(result.importedCount===1,'Expected a native new item');
  const volume=ref._item.getField('volume'),issue=ref._item.getField('issue'),pages=ref._item.getField('pages');
  return {bugReproduced:!volume&&!issue&&!pages,expected:{volume:'73',issue:'4',pages:'12-18'},parsedTitle:ref.title,saved:{volume,issue,pages}};
});


await views.storage.flush();report.finished=new Date().toISOString();report.passed=report.tests.filter(row=>row.ok).length;report.failed=report.tests.filter(row=>!row.ok).length;report.errors=Zotero.getErrors(true).map(String);await save();
