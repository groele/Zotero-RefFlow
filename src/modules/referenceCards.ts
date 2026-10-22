import {config} from "../../package.json";
import {getString} from "../utils/locale";
import type Views from "./views";
import type TipUI from "./tip";
import {referenceIdentity} from "./referenceIdentity";
import { cleanupSync } from "../utils/lifecycle";

/** Compact reference cards and selection behavior aligned with the supplied XPI. */
export default class ReferenceCards {
  private refs:ItemBaseInfo[]=[];
  private selected=new Set<ItemBaseInfo>();
  private anchor=0;
  private disposed=false;
  private searchTimer?:ReturnType<typeof globalThis.setTimeout>;
  private rows:HTMLElement[]=[];
  private observer?:IntersectionObserver;
  private matchQueue:Array<()=>Promise<void>>=[];
  private matchActive=0;
  private matchedRows=new WeakSet<HTMLElement>();
  private hoverTimer?:ReturnType<typeof globalThis.setTimeout>;
  private tip?:TipUI;
  private empty?:HTMLElement;
  private generation=0;
  private matchGeneration=0;
  private matchCurrent?:()=>boolean;
  private providerRetractions=new WeakMap<ItemBaseInfo,ItemBaseInfo["retraction"]>();
  private menus=new Set<Element>();
  private cleanup:Array<()=>void>=[];
  private listCurrent?:()=>boolean;
  private windowStart=0;
  private virtual=false;
  private readonly rowHeight=144;
  private searchIndex=new WeakMap<ItemBaseInfo,string>();

  constructor(private views:Views,private body:HTMLElement,private grid:HTMLElement,private search:HTMLInputElement,listLabel='Reference list') {
    const onInput=()=>{globalThis.clearTimeout(this.searchTimer);this.searchTimer=globalThis.setTimeout(()=>this.filter(),80);};
    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();globalThis.clearTimeout(this.searchTimer);search.value="";this.filter();}};
    const onContextMenu=(event:MouseEvent)=>{event.preventDefault();this.menu(event);};
    search.addEventListener("input",onInput);
    search.addEventListener("keydown",onKeyDown);
    grid.setAttribute("role","listbox");grid.setAttribute("aria-multiselectable","true");
    grid.addEventListener("contextmenu",onContextMenu);
    grid.setAttribute('aria-label',listLabel);
    const onScroll=()=>{
      if(!this.virtual||!this.listCurrent?.())return;
      const start=Math.max(0,Math.floor(grid.scrollTop/this.rowHeight)-8);
      if(Math.abs(start-this.windowStart)<8)return;
      this.windowStart=start;void this.render(this.refs,this.listCurrent);
    };
    grid.addEventListener('scroll',onScroll,{passive:true});this.cleanup.push(()=>grid.removeEventListener('scroll',onScroll));
    this.cleanup.push(()=>search.removeEventListener("input",onInput),()=>search.removeEventListener("keydown",onKeyDown),()=>grid.removeEventListener("contextmenu",onContextMenu));
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.cleanup.forEach(cleanupSync);this.cleanup=[];for(const menu of this.menus)cleanupSync(()=>menu.remove());this.menus.clear();globalThis.clearTimeout(this.searchTimer);this.clear();}
  clear(){this.generation++;this.matchGeneration++;this.matchCurrent=undefined;this.observer?.disconnect();this.matchQueue=[];globalThis.clearTimeout(this.searchTimer);globalThis.clearTimeout(this.hoverTimer);this.tip?.clear();this.tip=undefined;this.selected.clear();this.refs=[];this.rows=[];this.empty?.remove();this.empty=undefined;this.grid.replaceChildren();this.search.value="";}
  private drainMatches(){while(this.matchActive<4&&this.matchQueue.length){const match=this.matchQueue.shift()!;this.matchActive++;void match().catch(error=>ztoolkit.log(error)).finally(()=>{this.matchActive--;if(!this.disposed)this.drainMatches();});}}
  private queueLibraryMatch(row:HTMLElement,parent:Zotero.Item,current:()=>boolean){
    if(this.matchedRows.has(row))return;
    this.matchedRows.add(row);
    const ref=(row as any).reference;
    if(!this.providerRetractions.has(ref))this.providerRetractions.set(ref,ref.retraction?{...ref.retraction}:undefined);
    const generation=this.matchGeneration,importRevision=row.dataset.importRevision;
    this.matchQueue.push(async()=>{
      if(!current()||!row.isConnected)return;
      const found=await this.views.utils.searchLibraryItem({...ref,_item:undefined},parent.libraryID);
      if(!current()||!row.isConnected||generation!==this.matchGeneration||importRevision!==row.dataset.importRevision||row.querySelector('.reference-action')?.hasAttribute('aria-busy'))return;
      ref._item=found;
      const local=found?this.views.utils.API.retractionChecker.checkLocal(ref.identifiers?.DOI,found):undefined;
      const provider=this.providerRetractions.get(ref);
      ref.retraction=provider?.isRetracted?provider:local?.isRetracted?local:provider;
      const action=row.querySelector<HTMLElement>(".reference-action")!;
      action.textContent=found?"↗":"+";action.title=getString(found?"cards-show-library":"cards-import");action.setAttribute("aria-label",action.title);
      (row.querySelector(".reference-state") as HTMLElement).style.backgroundColor=found?"var(--color-accent, #3678b5)":"var(--color-secondary, #9ca3af)";
      row.style.opacity=found?"1":String(Zotero.Prefs.get(`${config.addonRef}.notInLibarayOpacity`)||"1");
      let warning=row.querySelector<HTMLElement>(".reference-retracted");
      if(ref.retraction?.isRetracted){if(!warning){warning=row.ownerDocument.createElement("span");warning.className="reference-retracted";row.querySelector(".reference-description")!.prepend(warning);}warning.textContent=getString("relatedbox-retracted-badge");warning.title=ref.retraction.reason||"";}
      else warning?.remove();
    });
  }

  public invalidateLibraryMatches() {
    if(this.disposed || !this.matchCurrent?.() || !this.body.isConnected)return;
    const parent=this.parent();if(!parent || parent.deleted)return;
    this.matchGeneration++;this.matchQueue=[];this.matchedRows=new WeakSet();
    for(const [index,row] of this.rows.entries()){
      if((row as any).reference._item?.deleted)(row as any).reference._item=undefined;
      if(index<8)this.queueLibraryMatch(row,parent,this.matchCurrent);
      else this.observer?.observe(row);
    }
    this.drainMatches();
  }

  private parent():Zotero.Item{return Zotero.Items.get(Number(this.body.getAttribute("data-refflow-item-id"))) as Zotero.Item;}
  private label():HTMLElement{return this.body.querySelector("#reference-num")!;}
  private visible(){return this.rows.filter(row=>!row.hidden);}
  private matches(ref:ItemBaseInfo):boolean {
    let hay=this.searchIndex.get(ref);if(hay===undefined){hay=[ref.text,ref.title,...(ref.authors||[]),ref.year,ref.publicationVenue,ref.identifiers?.DOI].join(' ').toLocaleLowerCase();this.searchIndex.set(ref,hay);}
    return this.search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).every(token=>hay!.includes(token));
  }
  private filtered(){return this.refs.filter(ref=>this.matches(ref));}
  private subset():ItemBaseInfo[]{return this.selected.size?[...this.selected]:this.filtered();}
  private updateSelection(){for(const row of this.rows){const selected=this.selected.has((row as any).reference);row.classList.toggle("selected",selected);row.setAttribute("aria-selected",String(selected));}}
  private select(index:number,event:MouseEvent|KeyboardEvent){
    const ref=this.refs[index];
    if(event.shiftKey){if(!event.ctrlKey&&!event.metaKey)this.selected.clear();for(let i=Math.min(index,this.anchor);i<=Math.max(index,this.anchor);i++)if(this.matches(this.refs[i]))this.selected.add(this.refs[i]);}
    else if(event.ctrlKey||event.metaKey){if(this.selected.has(ref))this.selected.delete(ref);else this.selected.add(ref);this.anchor=index;}
    else{this.selected.clear();this.selected.add(ref);this.anchor=index;}
    this.updateSelection();
  }
  private filter(){
    if(this.virtual){this.windowStart=0;this.grid.scrollTop=0;for(const ref of this.selected)if(!this.matches(ref))this.selected.delete(ref);if(this.listCurrent)void this.render(this.refs,this.listCurrent);return;}
    const tokens=this.search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    for(const row of this.rows){const ref=(row as any).reference as ItemBaseInfo;const hay=[ref.text,ref.title,...(ref.authors||[]),ref.year,ref.publicationVenue,ref.identifiers?.DOI].join(" ").toLocaleLowerCase();row.hidden=!tokens.every(token=>hay.includes(token));if(row.hidden)this.selected.delete(ref);}
    this.updateSelection();this.label().textContent=`${this.visible().length} / ${this.rows.length} · ${this.body.getAttribute("data-refflow-result-source")||""}`;
    if(this.empty)this.empty.hidden=this.visible().length>0||this.rows.length===0;
  }
  async render(refs:ItemBaseInfo[],current:()=>boolean){
    if(this.disposed)return;
    const query=this.search.value;
    const selected=new Set([...this.selected].map(referenceIdentity));
    const active=this.grid.ownerDocument.activeElement as HTMLElement|null;
    const focused=active?.closest?.('.reference-item') as any;
    const focusKey=focused&&this.grid.contains(focused)?referenceIdentity(focused.reference):undefined;
    const focusAction=active?.classList.contains('reference-action');
    const anchorKey=this.refs[this.anchor]?referenceIdentity(this.refs[this.anchor]):undefined;
    const scrollTop=this.grid.scrollTop;
    this.virtual=refs.length>200;
    const indices=refs.map((ref,index)=>index).filter(index=>!this.virtual||this.matches(refs[index]));
    const start=this.virtual?Math.min(this.windowStart,Math.max(0,indices.length-1)):0;
    const displayIndices=this.virtual?indices.slice(start,start+60):indices;
    this.clear();this.search.value=query;this.refs=refs;
    this.listCurrent=current;this.windowStart=start;
    const externalCurrent=current,generation=this.generation;
    current=()=>externalCurrent()&&this.generation===generation&&!this.disposed;
    this.matchCurrent=current;
    const fragment=this.body.ownerDocument.createDocumentFragment();
    this.grid.style.maxHeight=this.virtual?'65vh':'';
    const spacer=(height:number)=>{const node=this.body.ownerDocument.createElement('div');node.style.height=`${height}px`;node.style.flexShrink='0';node.setAttribute('aria-hidden','true');return node;};
    if(this.virtual)fragment.append(spacer(start*this.rowHeight));
    const parent=this.parent();
    const original:ItemBaseInfo[]=(this.body as any).references||refs;
    const positions=new Map(original.map((ref,index)=>[ref,index+1]));
    const numbers=refs.map((ref,index)=>Number.isSafeInteger(Number(ref.number))&&Number(ref.number)>0?Number(ref.number):(positions.get(ref)||index+1));
    this.grid.style.setProperty("--refflow-number-width",`${numbers.reduce((width,number)=>Math.max(width,String(number).length+1),2)}ch`);
    if((this.body.ownerDocument.defaultView as any).IntersectionObserver)this.observer=new (this.body.ownerDocument.defaultView as any).IntersectionObserver((entries:IntersectionObserverEntry[])=>{
      for(const entry of entries)if(entry.isIntersecting){this.observer?.unobserve(entry.target);
        this.queueLibraryMatch(entry.target as HTMLElement,parent,current);
      }this.drainMatches();
    },{rootMargin:"80px"});

    for(const index of displayIndices) {
      const ref=refs[index],doc=this.body.ownerDocument;
      const row=doc.createElement("div");row.className="reference-item";row.tabIndex=0;row.setAttribute("role","option");row.setAttribute("aria-selected","false");(row as any).reference=ref;
      if(this.virtual){row.style.height=`${this.rowHeight}px`;row.style.flexShrink='0';row.style.boxSizing='border-box';row.style.overflow='hidden';}
      row.setAttribute("aria-posinset",String(index+1));row.setAttribute("aria-setsize",String(refs.length));
      const marker=doc.createElement("div");marker.className="reference-marker";
      const number=doc.createElement("span");number.className="reference-number";number.textContent=`${numbers[index]}.`;number.title=`${getString("cards-number-label")} ${numbers[index]}`;
      row.dataset.referenceNumber=String(numbers[index]);row.setAttribute("aria-label",`${number.title}: ${ref.title||ref.text||""}`);
      const dot=doc.createElement("span");dot.className="reference-state";
      const age=Math.max(0,new Date().getFullYear()-Number(ref.year||2000));dot.style.backgroundColor=ref._item?"var(--color-accent, #3678b5)":`hsl(210 30% ${Math.min(85,40+age*2)}%)`;dot.title=ref._item?getString("cards-in-library"):String(ref.year||"");
      const content=doc.createElement("div");content.className="reference-description";
      const text=doc.createElement("span");text.className="reference-text";text.textContent=ref.text||ref.title||"";text.title=text.textContent||"";
      const title=doc.createElement("strong");title.className="reference-title";title.textContent=ref.title||ref.text||"";title.title=title.textContent||"";
      if(this.virtual){title.style.display='-webkit-box';title.style.setProperty('-webkit-box-orient','vertical');title.style.setProperty('-webkit-line-clamp','2');title.style.overflow='hidden';}
      const about=doc.createElement("span");about.className="reference-about";about.textContent=[(ref.authors||[]).slice(0,3).join(" / "),ref.year,ref.publicationVenue,(ref as any).citationCount!==undefined?`${getString("cards-cited")} ${(ref as any).citationCount}`:""].filter(Boolean).join(" · ");
      if(ref.retraction?.isRetracted){const warning=doc.createElement("span");warning.className="reference-retracted";warning.textContent=getString("relatedbox-retracted-badge");warning.title=ref.retraction.reason||"";content.append(warning);}
      content.append(text,title,about);
      const action=doc.createElement("button");action.type="button";action.className="reference-action";action.textContent=ref._item?"↗":"+";action.title=getString(ref._item?"cards-show-library":"cards-import");
      action.addEventListener("click",async event=>{
        event.stopPropagation();if(action.disabled)return;action.disabled=true;action.setAttribute('aria-busy','true');row.dataset.importRevision=String(Number(row.dataset.importRevision||0)+1);
        action.textContent='…';action.title=getString('cards-importing-doi');action.setAttribute('aria-label',action.title);
        try {
          const parent=this.parent();const found=await this.views.utils.searchLibraryItem(ref,parent.libraryID);
          if(found){ref._item=found;this.views.utils.selectItemInLibrary(found, this.body.ownerDocument.defaultView!);}
          else {const result=await this.views.importReferences(parent,[ref],{downloadOA:false,createSubCollection:false,createManifestNote:false});
            if(result.cancelled)throw new Error(getString('cards-import-cancelled'));
            if(result.failedCount)throw new Error(result.failures[0]?.reason||getString('cards-import-failed'));
          }
          if(ref._item){action.textContent="↗";action.title=getString("cards-show-library");action.setAttribute("aria-label",action.title);dot.style.backgroundColor="var(--color-accent, #3678b5)";dot.title=getString("cards-in-library");row.style.opacity="1";}
        }catch(error){if(row.isConnected){this.label().textContent=String(error);action.textContent='!';action.title=String(error);action.setAttribute('aria-label',String(error));}ztoolkit.log(error);}finally{row.dataset.importRevision=String(Number(row.dataset.importRevision||0)+1);action.disabled=false;action.removeAttribute('aria-busy');}
      });
      action.setAttribute("aria-label",action.title);
      row.style.opacity=ref._item?"1":String(Zotero.Prefs.get(`${config.addonRef}.notInLibarayOpacity`)||"1");
      title.addEventListener("mouseenter",()=>{if(!Zotero.Prefs.get(`${config.addonRef}.isShowTip`))return;globalThis.clearTimeout(this.hoverTimer);this.hoverTimer=globalThis.setTimeout(()=>{if(!current()||!row.isConnected)return;this.tip=this.views.showTipUI(title.getBoundingClientRect() as any,{...ref,primaryVenue:ref.publicationVenue,identifiers:ref.identifiers||{}} as any,"left",ref.identifiers?.DOI,true,this.body.ownerDocument.defaultView!);},Math.max(100,Math.min(2000,Number(Zotero.Prefs.get(`${config.addonRef}.showTipAfterMillisecond`))||233)));});
      title.addEventListener("mouseleave",()=>{globalThis.clearTimeout(this.hoverTimer);if(this.tip){globalThis.clearTimeout(this.tip.tipTimer);this.tip.tipTimer=globalThis.setTimeout(()=>this.tip?.clear(),this.tip.removeTipAfterMillisecond);}});
      marker.append(number,dot);row.append(marker,content,action);
      row.addEventListener("click",event=>this.select(index,event));
      row.addEventListener("dblclick",()=>this.open(ref));
      row.addEventListener("contextmenu",event=>{if(!this.selected.has(ref))this.select(index,event);});
      row.addEventListener("keydown",event=>{
        // A focused action button must retain native Enter/Space activation.
        if(event.target!==row)return;
        if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="a"){event.preventDefault();for(const item of this.filtered())this.selected.add(item);this.updateSelection();}
        else if(event.key==="Enter"){event.preventDefault();this.open(ref);}
        else if(event.key==="Escape"){event.preventDefault();this.selected.clear();this.updateSelection();}
        else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="c"){event.preventDefault();this.views.utils.copyText(this.subset().map(ref=>ref.text||ref.title).join("\n"),false);}
        else if(["ArrowUp","ArrowDown"].includes(event.key)){
          event.preventDefault();const visible=this.virtual?this.filtered():this.visible().map(node=>(node as any).reference);
          const refNext=visible[Math.max(0,Math.min(visible.length-1,visible.indexOf(ref)+(event.key==='ArrowDown'?1:-1)))];
          const focus=()=>{const next=this.rows.find(node=>(node as any).reference===refNext);if(next){next.focus();this.select(this.refs.indexOf(refNext),event);}};
          if(this.virtual&&!this.rows.some(node=>(node as any).reference===refNext)&&this.listCurrent){this.windowStart=Math.max(0,visible.indexOf(refNext)-8);this.grid.scrollTop=this.windowStart*this.rowHeight;void this.render(this.refs,this.listCurrent).then(focus);}else focus();
        }
      });
      this.rows.push(row);fragment.append(row);
      if(!this.virtual&&index%40===39){await Zotero.Promise.delay(0);if(!current()||this.disposed)return;}
    }
    if(current()&&!this.disposed){
      if(this.virtual)fragment.append(spacer(Math.max(0,indices.length-start-displayIndices.length)*this.rowHeight));
      this.grid.append(fragment);if(this.virtual)this.grid.scrollTop=scrollTop;
      this.empty=this.body.ownerDocument.createElement("p");this.empty.className="refflow-empty-result";this.empty.setAttribute("role","status");this.empty.textContent=getString("cards-no-search-results");this.empty.hidden=true;this.grid.after(this.empty);
      for(const ref of refs)if(selected.has(referenceIdentity(ref)))this.selected.add(ref);
      this.anchor=Math.max(0,refs.findIndex(ref=>referenceIdentity(ref)===anchorKey));
      this.updateSelection();
      if(query&&!this.virtual)this.filter();
      if(this.virtual){this.label().textContent=`${indices.length} / ${this.refs.length} · ${this.body.getAttribute('data-refflow-result-source')||''}`;this.empty.hidden=indices.length>0||!this.refs.length;}
      const now=this.grid.ownerDocument.activeElement;
      if(focusKey&&(!now||now===this.grid.ownerDocument.body||now===this.grid.ownerDocument.documentElement)){
        const row=this.rows.find(row=>!row.hidden&&referenceIdentity((row as any).reference)===focusKey);
        (focusAction?row?.querySelector<HTMLElement>('.reference-action'):row)?.focus();
      }
      // Native background windows may delay intersection callbacks. Match only
      // the first screen's bounded rows eagerly; keep long lists lazy.
      for(const [index,row] of this.rows.entries()){
        if(index<8)this.queueLibraryMatch(row,parent,current);
        else this.observer?.observe(row);
      }
      this.drainMatches();
    }
  }
  updateStatus(){if(this.search.value.trim()&&!this.virtual)this.filter();}
  private open(ref:ItemBaseInfo){if(ref._item)this.views.utils.selectItemInLibrary(ref._item, this.body.ownerDocument.defaultView!);else{const url=ref.url||(ref.identifiers?.DOI?`https://doi.org/${ref.identifiers.DOI}`:undefined);if(url&&/^https?:\/\//i.test(url))Zotero.launchURL(url);}}
  menu(event?:MouseEvent){
    if(this.disposed)return;
    const parentAtOpen=this.parent(),refsAtOpen=this.subset(),allAtOpen=[...this.refs];
    const samePanel=()=>!this.disposed&&this.body.isConnected&&Number(this.body.getAttribute("data-refflow-item-id"))===parentAtOpen.id;
    const doc:any=this.body.ownerDocument,popup=doc.createXULElement("menupopup") as any;popup.setAttribute("data-refflow-menu","references");
    const add=(key:string,action:()=>any,checked?:boolean)=>{const item=doc.createXULElement("menuitem");item.setAttribute("label",getString(key));if(checked!==undefined){item.setAttribute("type","checkbox");item.checked=checked;}item.addEventListener("command",()=>Promise.resolve().then(()=>{if(!this.disposed)return action();}).catch(error=>{this.label().textContent=String(error);ztoolkit.log(error);}));popup.append(item);};
    const separator=()=>popup.append(doc.createXULElement("menuseparator"));
    add("cards-copy-text",()=>this.views.utils.copyText(refsAtOpen.map(ref=>ref.text||ref.title).join("\n"),false));
    add("cards-copy-doi",()=>this.views.utils.copyText(refsAtOpen.map(ref=>ref.identifiers?.DOI).filter(Boolean).join("\n"),false));
    add("cards-copy-url",()=>this.views.utils.copyText(refsAtOpen.map(ref=>ref.url||(ref.identifiers?.DOI?`https://doi.org/${ref.identifiers.DOI}`:"")).filter(Boolean).join("\n"),false));
    add("cards-open",()=>refsAtOpen.slice(0,20).forEach(ref=>this.open(ref)));
    separator();
    const importRefs=async(all:boolean)=>{const parent=parentAtOpen,id=parent.id;const refs=all?allAtOpen:refsAtOpen;if(!refs.length)return;const result=await this.views.importReferences(parent,refs,{downloadOA:Boolean(Zotero.Prefs.get(`${config.addonRef}.downloadOA`)),createSubCollection:true,createManifestNote:true});if(Number(this.body.getAttribute("data-refflow-item-id"))===id){this.invalidateLibraryMatches();this.label().textContent=getString(result.cancelled?'cards-import-cancelled':'cards-import-summary',{args:{added:result.importedCount,existing:result.existingCount,failed:result.failedCount}})+(result.failedCount?' · '+result.failures[0]?.reason:'');}};
    add("cards-import-selected",()=>importRefs(false));add("cards-import-all",()=>importRefs(true));
    add("relatedbox-rollback",async()=>{const parent=parentAtOpen;const matches=[...String(parent.getField("extra")||"").matchAll(/^refnexus_batch_parent: (refnexus_batch_\w+)$/gm)];const id=matches[matches.length-1]?.[1];if(id){await this.views.rollbackReferences(parent,id);if(Number(this.body.getAttribute("data-refflow-item-id"))===parent.id)await this.views.refreshReferences(this.body as any,true,false,false,parent);}});
    separator();
    for(const source of ["Auto","PDF","Web","API"])add(source==="Auto"?"cards-source-auto":source==="Web"?"cards-source-web":source==="PDF"?"cards-source-pdf":"cards-source-online",()=>{if(!samePanel())return;this.body.querySelector<HTMLSelectElement>("select")!.value=source;this.body.querySelector("select")!.dispatchEvent(new (this.body.ownerDocument.defaultView as any).Event("change"));},this.body.getAttribute("source")===source);
    for(const sort of ["Original","Recency","Cited Count"])add(sort==="Original"?"cards-sort-original":sort==="Recency"?"cards-sort-recency":"cards-sort-cited",async()=>{if(!samePanel())return;Zotero.Prefs.set(`${config.addonRef}.sortBy`,sort);await this.views.sortReferences(this.body);},Zotero.Prefs.get(`${config.addonRef}.sortBy`)===sort);
    add("relatedbox-download-oa",()=>Zotero.Prefs.set(`${config.addonRef}.downloadOA`,!Zotero.Prefs.get(`${config.addonRef}.downloadOA`)),Boolean(Zotero.Prefs.get(`${config.addonRef}.downloadOA`)));
    this.menus.add(popup);
    popup.addEventListener("popuphidden",()=>{this.menus.delete(popup);popup.remove();},{once:true});doc.documentElement.append(popup);
    if(event)popup.openPopupAtScreen(event.screenX,event.screenY,true);else popup.openPopup(this.body.closest("item-pane-custom-section"),"after_end",0,0,false,false);
  }
}
