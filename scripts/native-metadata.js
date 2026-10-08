if(!/refnexus-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const report={version:Zotero.version,tests:[]},check=(ok,message)=>{if(!ok)throw new Error(message);},delay=ms=>Zotero.Promise.delay(ms);
const test=async(name,fn)=>{try{report.tests.push({name,ok:true,detail:await fn()});}catch(error){report.tests.push({name,ok:false,error:String(error)});}};
const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
await test('installed production XPI exposes derivative maintainer and homepage',async()=>{
 const addon=await AddonManager.getAddonByID('refnexus@polygon.org');const expected=JSON.parse(await Zotero.File.getContentsAsync(cfg.workspace+'\\package.json')).version;check(addon.isActive&&addon.version===expected,'Wrong active version');
 check(addon.creator?.name==='groele','Wrong addon maintainer: '+addon.creator?.name);check(addon.homepageURL==='https://github.com/groele/Zotero-diy/tree/main/RefNexus-Zotero10','Wrong addon homepage');
 return {version:addon.version,maintainer:addon.creator.name,homepage:addon.homepageURL};
});
await test('native preferences show source attribution and correct project links',async()=>{
 const pref=Zotero.Utilities.Internal.openPreferences('refnexus-preferences');
 try{
  let about;for(let i=0;i<100;i++){about=pref.document.getElementById('refnexus-about');if(about)break;await delay(100);}
  check(about,'About section missing');await pref.document.l10n.translateFragment(about);await delay(150);
  check(about.textContent.includes('groele')&&about.textContent.includes('Polygon / MuiseDestiny')&&about.textContent.includes('AGPL-3.0-or-later'),'Source credits or maintainer missing');
  const expected=['https://github.com/groele/Zotero-diy/tree/main/RefNexus-Zotero10','https://github.com/groele/Zotero-diy/issues','https://github.com/MuiseDestiny/zotero-reference','https://github.com/groele/Zotero-diy/blob/main/RefNexus-Zotero10/docs/RELEASE-NOTES.md'];
  const actual=[...about.querySelectorAll('a')].map(a=>a.href);check(JSON.stringify(actual)===JSON.stringify(expected),'Wrong settings links');
  check([...about.querySelectorAll('a')].every(a=>a.textContent.trim()),'Empty accessible link label');
  check(about.textContent.includes('groele/Zotero-diy')&&about.textContent.includes('Zotero 10'),'Update authority or compatibility explanation missing');
  check(pref.document.querySelector('a[href="https://openalex.org/settings/api"]'),'Free API key entry missing');return {attribution:about.textContent.trim(),links:actual};
 }finally{pref.close();}
});
report.finished=new Date().toISOString();report.passed=report.tests.filter(t=>t.ok).length;report.failed=report.tests.filter(t=>!t.ok).length;await Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
