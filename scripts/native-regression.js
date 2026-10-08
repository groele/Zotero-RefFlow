// Runs inside a real Zotero 10 window via the toolkit debug bridge.
// Library writes are guarded to the explicitly named isolated test data directory.
if (!/refnexus-z10-/.test(Zotero.DataDirectory.dir)) throw new Error('Refusing to test in the main library');
const report = { version: Zotero.version, at: new Date().toISOString(), tests: [], metrics: {} };
const views = Zotero.ZoteroRefNexus?.views;
report.implementation={taskCoordinator:Boolean(views?.referenceTasks),pdfDiagnostics:Boolean(views?.utils?.PDF?.getDiagnostics)};
const check = (ok, message) => { if (!ok) throw new Error(message); };
const delay = ms => Zotero.Promise.delay(ms);
const test = async (name, fn) => {
  const start = Date.now();
  try { const detail = await fn(); report.tests.push({ name, ok: true, ms: Date.now()-start, detail }); }
  catch (error) { report.tests.push({ name, ok: false, ms: Date.now()-start, error: String(error), stack: error?.stack }); }
  await Zotero.File.putContentsAsync(cfg.output, JSON.stringify(report, null, 2));
};
check(views, 'Plugin views unavailable');
window.Zotero_Tabs.select('zotero-pane');
const items = {};
for (const name of ['single','columns','author-year','numbered-prose','large']) {
  const item = new Zotero.Item('journalArticle');
  item.setField('title', `RefNexus Native ${name} ${Date.now()}`);
  await item.saveTx();
  const attachment = await Zotero.Attachments.importFromFile({ file: cfg.fixtures + (Zotero.isWin ? '\\' : '/') + name + '.pdf', parentItemID: item.id });
  items[name] = { item, attachment };
}
const select = async name => {
  window.Zotero_Tabs.select('zotero-pane');
  await window.ZoteroPane.selectItem(items[name].item.id);
  await delay(150);
  const section = window.document.querySelector('item-pane-custom-section[data-pane*="refnexus"]');
  const body = section?.querySelector('[data-type="body"]');
  check(body, 'Native item-pane body unavailable');
  return { section, body };
};
await test('native section heading has a localized title', async () => {
  const { section } = await select('single');
  await window.document.l10n.translateFragment(section);
  const title = section.querySelector('.title')?.textContent;
  check(title?.trim(), 'Empty native pane title');
  return { title };
});
for (const [name, count] of [['single',4],['columns',6],['author-year',3],['numbered-prose',0],['large',12]]) {
  await test(`PDF ${name} extraction`, async () => {
    const reader = await Zotero.Reader.open(items[name].attachment.id);
    await delay(2500);
    const start = Date.now();
    const refs = await views.utils.PDF.getReferences(reader, false);
    report.metrics[name] = { ms:Date.now()-start, count:refs.length, order:refs.map(r=>r.number) };
    check(refs.length === count, `Expected ${count} entries, got ${refs.length}`);
    if (name==='columns') {
      check(refs.map(r=>r.number).join(',')==='1,2,3,4,5,6', 'Two-column order is interleaved');
      check(refs.every((r,i)=>r.text.includes(`10.1234/fixture${i+1}`)), 'Continuation text attached to the wrong column entry');
    }
    return {count:refs.length, first:refs[0]?.text};
  });
}
await test('DOI extraction stops at prose boundaries', async () => {
  const doi = views.utils.getIdentifiers('DOI: 10.1234/example. Journal A 2024').DOI;
  check(doi==='10.1234/example', `Contaminated DOI: ${doi}`);
  return {doi};
});
await test('late response cannot populate a different selected item', async () => {
  const api = views.utils.API;
  const original = api.getDOIInfoByCrossref;
  items.single.item.setField('DOI','10.1234/native-single'); await items.single.item.saveTx();
  api.getDOIInfoByCrossref = async () => { await delay(400); return {references:[{ title:'STALE FIRST ITEM',text:'STALE FIRST ITEM citation 2024.',identifiers:{DOI:'10.1234/native-stale'} }]}; };
  try {
    const {body} = await select('single'); body.setAttribute('source','API');
    const pending = views.refreshReferences(body,false,false,false,items.single.item);
    await delay(100); await select('columns'); await pending;
    const current = window.document.querySelector('item-pane-custom-section[data-pane*="refnexus"] [data-type="body"]');
    check(!current.querySelector('#related-grid').textContent.includes('STALE'), 'Old item references rendered after selection changed');
  } finally { api.getDOIInfoByCrossref=original; }
});
await test('changing source invalidates the pending response', async () => {
  const original = views.utils.API.getDOIInfoByCrossref;
  views.utils.API.getDOIInfoByCrossref = async () => { await delay(250); return {references:[{title:'STALE SOURCE',text:'STALE SOURCE citation 2024.',identifiers:{}}]}; };
  try {
    const {body} = await select('single'); body.setAttribute('source','API');
    const pending=views.refreshReferences(body,false,false,false,items.single.item);
    await delay(50); const source=body.querySelector('select'); source.value='PDF'; source.dispatchEvent(new window.Event('change',{bubbles:true})); await pending;
    check(!body.querySelector('#related-grid').textContent.includes('STALE'), 'Online response displayed under PDF source');
  } finally {views.utils.API.getDOIInfoByCrossref=original;}
});
await test('library matching refuses a conflicting DOI', async () => {
  const wrong=new Zotero.Item('journalArticle'); wrong.setField('title','Native conflicting DOI fixture'); wrong.setField('DOI','10.1234/conflicting-one'); await wrong.saveTx();
  const ref={title:'Native conflicting DOI fixture',identifiers:{DOI:'10.1234/conflicting-two'}};
  const found=await views.utils.searchLibraryItem(ref,wrong.libraryID);
  check(!found, 'Matched an item with a different DOI');
});
report.finished = new Date().toISOString();
report.passed=report.tests.filter(t=>t.ok).length;
report.failed=report.tests.filter(t=>!t.ok).length;
await Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
