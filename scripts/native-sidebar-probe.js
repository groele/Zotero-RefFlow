if(!/refnexus-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const doc=window.document;
const item=new Zotero.Item('journalArticle');item.setField('title','Sidebar layout diagnostic');await item.saveTx();
window.Zotero_Tabs.select('zotero-pane');await window.ZoteroPane.selectItem(item.id);await Zotero.Promise.delay(500);
const geometry=node=>{if(!node)return null;const r=node.getBoundingClientRect(),s=window.getComputedStyle(node);return {tag:node.localName,id:node.id,orient:node.getAttribute('orient'),display:s.display,flexDirection:s.flexDirection,x:r.x,y:r.y,width:r.width,height:r.height,children:[...node.children].map(e=>({tag:e.localName,id:e.id,orient:e.getAttribute('orient')}))};};
const content=doc.getElementById('zotero-item-pane-content');
const snapshot=()=>({host:geometry(content.parentElement),content:geometry(content),rail:geometry(doc.querySelector('#zotero-item-pane item-pane-sidenav')),panel:geometry(doc.getElementById('connected-papers-relatedsplit-after'))});
const before=snapshot();
if(!cfg.withoutPlugin){content.parentElement.setAttribute('orient','horizontal');doc.getElementById('refnexus-graph-style')?.remove();doc.getElementById('connected-papers-relatedsplit-after')?.remove();await Zotero.Promise.delay(150);}
await Zotero.File.putContentsAsync(cfg.output,JSON.stringify({version:Zotero.version,before,after:snapshot(),finished:new Date().toISOString()},null,2));
