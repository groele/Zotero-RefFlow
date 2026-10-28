if(!/refflow-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const views=Zotero.ZoteroRefFlow.views,win=Zotero.getMainWindow(),report={host:Zotero.version,tests:[]};
const check=(v,m)=>{if(!v)throw new Error(m)},wait=async(fn)=>{for(let i=0;i<250;i++){if(fn())return;await Zotero.Promise.delay(20);}throw new Error('Timed out');};
const test=async(name,fn)=>{try{report.tests.push({name,ok:true,detail:await fn()});}catch(e){report.tests.push({name,ok:false,error:String(e),stack:e.stack});}await Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));};
Zotero.Prefs.set('refflow.autoRefresh',false);Zotero.Prefs.set('refflow.saveAPIReferences',false);Zotero.Prefs.set('refflow.prioritySource','Web');win.Zotero_Tabs.select('zotero-pane');
const item=new Zotero.Item('journalArticle');item.setField('title','Settings on-demand test');item.setField('DOI','10.1234/settings-action');await item.saveTx({skipSelect:true});await win.ZoteroPane.selectItem(item.id);
let body;await wait(()=>{body=win.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');return body?._cards && Number(body.getAttribute('data-refflow-item-id'))===item.id;});body.closest('item-pane-custom-section').querySelector('collapsible-section').open=true;
const api=views.utils.API,oldOnline=api.getReferenceList,oldPub=api.publisherReferences.getReferences,oldCopy=views.utils.copyText;let copied='',calls=0;
const actions=['copy-text','copy-doi','copy-url','open','import-selected','import-all','rollback'];
try{
 await test('Settings contains switches instead of execution buttons',async()=>{
  const pref=Zotero.Utilities.Internal.openPreferences('refflow-preferences');await wait(()=>pref.document.getElementById('zotero-prefpane-refflow'));const root=pref.document.getElementById('zotero-prefpane-refflow');root.querySelector('#refflow-actions-title').closest('details').open=true;
  check(root.querySelectorAll('[data-refflow-quick-action]').length===7,'Seven switches missing');check(!root.querySelector('button[data-refflow-action]'),'Old execution buttons remain');
  for(const action of actions){const toggle=root.querySelector(`[data-refflow-quick-action="${action}"]`);await wait(()=>toggle.checked===true);toggle.click();await wait(()=>Zotero.Prefs.get('refflow.quickAction.'+action)===false);
    body._cards.menu();let popup=win.document.querySelector('[data-refflow-menu="references"]');check(!popup.querySelector(`[data-refflow-quick-action="${action}"]`),'Disabled action still visible: '+action);popup.hidePopup();
    toggle.click();await wait(()=>Zotero.Prefs.get('refflow.quickAction.'+action)===true);body._cards.menu();popup=win.document.querySelector('[data-refflow-menu="references"]');check(popup.querySelector(`[data-refflow-quick-action="${action}"]`),'Enabled action missing: '+action);popup.hidePopup();
  }
  return {switches:7,disabledAndRestored:7};
 });
 await test('About and version metadata appear in one section',async()=>{
 const pref=Zotero.Utilities.Internal.openPreferences('refflow-preferences');await wait(()=>pref.document.getElementById('zotero-prefpane-refflow'));const root=pref.document.getElementById('zotero-prefpane-refflow');
 check(!root.querySelector('.refflow-pref-footer'),'Duplicate version footer remains');const about=root.querySelector('#refflow-about');check(about.querySelector('.refflow-about-build'),'Build metadata missing');check(about.querySelector('#refflow-download-link'),'Download link missing');check(root.querySelectorAll('#refflow-project-link').length===1,'Project link repeated');return {singleAbout:true,metadata:true};
 });
 await test('Empty action groups disappear and preference survives reopening settings',async()=>{
  const pref=Zotero.Utilities.Internal.openPreferences('refflow-preferences');await wait(()=>pref.document.getElementById('zotero-prefpane-refflow'));let root=pref.document.getElementById('zotero-prefpane-refflow');root.querySelector('#refflow-actions-title').closest('details').open=true;
  for(const action of actions){const t=root.querySelector(`[data-refflow-quick-action="${action}"]`);await wait(()=>t.checked===true);t.click();await wait(()=>Zotero.Prefs.get('refflow.quickAction.'+action)===false);}
  body._cards.menu();const menu=win.document.querySelector('[data-refflow-menu="references"]');check(!menu.querySelector('[data-refflow-group="cards-menu-copy"]')&&!menu.querySelector('[data-refflow-group="cards-menu-import"]'),'Empty groups remain');check(!menu.querySelector('[data-refflow-quick-action]'),'Disabled actions remain');menu.hidePopup();pref.close();
  const reopened=Zotero.Utilities.Internal.openPreferences('refflow-preferences');await wait(()=>reopened.document.getElementById('zotero-prefpane-refflow'));root=reopened.document.getElementById('zotero-prefpane-refflow');await wait(()=>[...root.querySelectorAll('[data-refflow-quick-action]')].every(t=>t.checked===false));reopened.close();return {emptyGroupsHidden:true,persisted:true};
 });
}finally{for(const action of actions)Zotero.Prefs.set('refflow.quickAction.'+action,true);}
report.finished=new Date().toISOString();report.passed=report.tests.filter(t=>t.ok).length;report.failed=report.tests.filter(t=>!t.ok).length;await Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
