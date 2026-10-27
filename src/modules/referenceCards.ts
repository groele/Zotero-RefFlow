import {config} from "../../package.json";
import {getString} from "../utils/locale";
import type Views from "./views";
import type TipUI from "./tip";
import BatchImporter from "./batchImporter";
import BatchResults from "./batchResults";
import JournalStatus from "./journalStatus";
import {JournalCommitPendingError,JournalUnavailableError} from "./batchJournal";
import {referenceIdentity} from "./referenceIdentity";
import { cleanupSync } from "../utils/lifecycle";
import {importFailureText,importErrorText,importSummaryText} from './importErrors';

/** Compact reference cards and selection behavior aligned with the supplied XPI. */
export default class ReferenceCards {
  private migratedParents=new Set<number>();
  private refs:ItemBaseInfo[]=[];
  private batchResults:BatchResults;
  private journalStatus:JournalStatus;
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
  private virtualCount=0;
  private virtual=false;
  private rowHeight=144;
  private searchIndex=new WeakMap<ItemBaseInfo,string>();

  constructor(private views:Views,private body:HTMLElement,private grid:HTMLElement,private search:HTMLInputElement,listLabel='Reference list') {
    this.batchResults=new BatchResults(views,body,grid);this.journalStatus=new JournalStatus(views,body,grid);
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
      const start=Math.min(Math.max(0,Math.floor(grid.scrollTop/this.rowHeight)-8),Math.max(0,this.virtualCount-60));
      if(Math.abs(start-this.windowStart)<8)return;
      this.windowStart=start;void this.render(this.refs,this.listCurrent);
    };
    grid.addEventListener('scroll',onScroll,{passive:true});this.cleanup.push(()=>grid.removeEventListener('scroll',onScroll));
    this.cleanup.push(()=>search.removeEventListener("input",onInput),()=>search.removeEventListener("keydown",onKeyDown),()=>grid.removeEventListener("contextmenu",onContextMenu));
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.cleanup.forEach(cleanupSync);this.cleanup=[];for(const menu of this.menus)cleanupSync(()=>menu.remove());this.menus.clear();globalThis.clearTimeout(this.searchTimer);this.clear();}
  clear(preserveResults=false){if(!preserveResults){this.batchResults.clear();this.journalStatus.clear();}this.generation++;this.matchGeneration++;this.matchCurrent=undefined;this.listCurrent=undefined;this.windowStart=0;this.virtualCount=0;this.observer?.disconnect();this.matchQueue=[];globalThis.clearTimeout(this.searchTimer);globalThis.clearTimeout(this.hoverTimer);this.clearTip();this.selected.clear();this.refs=[];this.rows=[];this.empty?.remove();this.empty=undefined;this.grid.replaceChildren();this.search.value="";}
  private clearTip(){const tip=this.tip;this.tip=undefined;if(tip){globalThis.clearTimeout(tip.tipTimer);tip.clear();}}
  private drainMatches(){while(this.matchActive<4&&this.matchQueue.length){const match=this.matchQueue.shift()!;this.matchActive++;void match().catch(error=>ztoolkit.log(error)).finally(()=>{this.matchActive--;if(!this.disposed)this.drainMatches();});}}
  private actionIcon(action:HTMLButtonElement,state:'add'|'open'|'busy'|'error',label:string){
    const doc=action.ownerDocument,ns='http://www.w3.org/2000/svg';
    action.dataset.actionState=state;action.title=label;action.setAttribute('aria-label',label);
    const svg=doc.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 16 16');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
    svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.5');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
    if(state==='busy')for(const x of [3,8,13]){const circle=doc.createElementNS(ns,'circle');circle.setAttribute('cx',String(x));circle.setAttribute('cy','8');circle.setAttribute('r','1');circle.setAttribute('fill','currentColor');circle.setAttribute('stroke','none');svg.append(circle);}
    else{const path=doc.createElementNS(ns,'path');path.setAttribute('d',state==='add'?'M8 3v10M3 8h10':state==='open'?'M4 12 12 4M5 4h7v7':'M8 3.5v6M8 12h0');svg.append(path);}
    action.replaceChildren(svg);
  }
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
      const action=row.querySelector<HTMLButtonElement>(".reference-action")!;
      this.actionIcon(action,found?'open':'add',getString(found?"cards-show-library":"cards-import"));
      const dot=row.querySelector<HTMLElement>('.reference-state')!;
      dot.style.backgroundColor=found?"var(--color-accent, #3678b5)":"var(--color-secondary, #9ca3af)";dot.title=found?getString('cards-in-library'):String(ref.year||'');
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
    const visible=this.visible();visible.forEach((row,index)=>{row.setAttribute('aria-posinset',String(index+1));row.setAttribute('aria-setsize',String(visible.length));});
    this.updateSelection();this.label().textContent=`${visible.length} / ${this.rows.length} · ${this.body.getAttribute("data-refflow-result-source")||""}`;
    if(this.empty)this.empty.hidden=this.visible().length>0||this.rows.length===0;
  }
  async render(refs:ItemBaseInfo[],current:()=>boolean){
    if(this.disposed)return;
    const parent=this.parent();
    if(parent?.id&&!this.migratedParents.has(parent.id)&&String(parent.getField('extra')||'').includes('refnexus_record_')){
      try{await BatchImporter.migrateLegacy(parent);this.migratedParents.add(parent.id);}catch(error){ztoolkit.log('Batch journal migration failed',error);new ztoolkit.ProgressWindow(getString('cards-batch-storage-error')).createLine({text:getString('cards-batch-storage-preserved'),type:'fail'}).show();}
      if(this.disposed||!current())return;
    }
    const query=this.search.value;
    const selected=new Set([...this.selected].map(referenceIdentity));
    const active=this.grid.ownerDocument.activeElement as HTMLElement|null;
    const focused=active?.closest?.('.reference-item') as any;
    const focusKey=focused&&this.grid.contains(focused)?referenceIdentity(focused.reference):undefined;
    const focusAction=active?.classList.contains('reference-action');
    const anchorKey=this.refs[this.anchor]?referenceIdentity(this.refs[this.anchor]):undefined;
    const scrollTop=this.grid.scrollTop;
    this.virtual=refs.length>200;
    if(this.virtual){const fontSize=parseFloat(this.body.ownerDocument.defaultView?.getComputedStyle(this.grid)?.fontSize||'13')||13;this.rowHeight=Math.max(144,Math.ceil(fontSize*10.5+24));}
    const indices=refs.map((ref,index)=>index).filter(index=>!this.virtual||this.matches(refs[index]));
    const start=this.virtual?Math.min(this.windowStart,Math.max(0,indices.length-60)):0;
    const displayIndices=this.virtual?indices.slice(start,start+60):indices;
    this.clear(true);this.search.value=query;this.refs=refs;
    this.listCurrent=current;this.windowStart=start;this.virtualCount=indices.length;
    const externalCurrent=current,generation=this.generation;
    current=()=>externalCurrent()&&this.generation===generation&&!this.disposed;
    this.matchCurrent=current;
    const fragment=this.body.ownerDocument.createDocumentFragment();
    this.grid.style.maxHeight=this.virtual?'65vh':'';
    const spacer=(height:number)=>{const node=this.body.ownerDocument.createElement('div');node.style.height=`${height}px`;node.style.flexShrink='0';node.setAttribute('aria-hidden','true');return node;};
    if(this.virtual)fragment.append(spacer(start*this.rowHeight));
    const original:ItemBaseInfo[]=(this.body as any).references||refs;
    const positions=new Map(original.map((ref,index)=>[ref,index+1]));
    const numbers=refs.map((ref,index)=>Number.isSafeInteger(Number(ref.number))&&Number(ref.number)>0?Number(ref.number):(positions.get(ref)||index+1));
    this.grid.style.setProperty("--refflow-number-width",`${numbers.reduce((width,number)=>Math.max(width,String(number).length+1),2)}ch`);
    if((this.body.ownerDocument.defaultView as any).IntersectionObserver)this.observer=new (this.body.ownerDocument.defaultView as any).IntersectionObserver((entries:IntersectionObserverEntry[])=>{
      for(const entry of entries)if(entry.isIntersecting){this.observer?.unobserve(entry.target);
        this.queueLibraryMatch(entry.target as HTMLElement,parent,current);
      }this.drainMatches();
    },{rootMargin:"80px"});

    for(const [offset,index] of displayIndices.entries()) {
      const ref=refs[index],doc=this.body.ownerDocument;
      const row=doc.createElement("div");row.className="reference-item";row.tabIndex=0;row.setAttribute("role","option");row.setAttribute("aria-selected","false");(row as any).reference=ref;
      if(this.virtual){row.style.height=`${this.rowHeight}px`;row.style.flexShrink='0';row.style.boxSizing='border-box';row.style.overflow='hidden';}
      row.setAttribute("aria-posinset",String(this.virtual?start+offset+1:index+1));row.setAttribute("aria-setsize",String(this.virtual?indices.length:refs.length));
      const citation=doc.createElement('div');citation.className='reference-citation';
      const marker=doc.createElement("div");marker.className="reference-marker";
      const number=doc.createElement("span");number.className="reference-number";number.textContent=`${numbers[index]}.`;number.title=`${getString("cards-number-label")} ${numbers[index]}`;
      row.dataset.referenceNumber=String(numbers[index]);row.setAttribute("aria-label",`${number.title}: ${ref.title||ref.text||""}`);
      const dot=doc.createElement("span");dot.className="reference-state";
      const age=Math.max(0,new Date().getFullYear()-Number(ref.year||2000));dot.style.backgroundColor=ref._item?"var(--color-accent, #3678b5)":`hsl(210 30% ${Math.min(85,40+age*2)}%)`;dot.title=ref._item?getString("cards-in-library"):String(ref.year||"");
      const content=doc.createElement("div");content.className="reference-description";
      const heading=doc.createElement('div');heading.className='reference-heading';
      const text=doc.createElement("span");text.className="reference-text";text.textContent=ref.text||ref.title||"";text.title=text.textContent||"";
      const title=doc.createElement("strong");title.className="reference-title";title.textContent=ref.title||ref.text||"";title.title=title.textContent||"";
      if(this.virtual){title.style.display='-webkit-box';title.style.setProperty('-webkit-box-orient','vertical');title.style.setProperty('-webkit-line-clamp','2');title.style.overflow='hidden';}
      const about=doc.createElement("span");about.className="reference-about";about.textContent=[(ref.authors||[]).slice(0,3).join(" / "),ref.year,ref.publicationVenue,(ref as any).citationCount!==undefined?`${getString("cards-cited")} ${(ref as any).citationCount}`:""].filter(Boolean).join(" · ");
      about.title=about.textContent;
      if(this.virtual){about.style.display='-webkit-box';about.style.setProperty('-webkit-box-orient','vertical');about.style.setProperty('-webkit-line-clamp','2');about.style.overflow='hidden';}
      const metadata=doc.createElement('div');metadata.className='reference-metadata';metadata.append(about);metadata.hidden=!about.textContent;
      if(ref.retraction?.isRetracted){const warning=doc.createElement("span");warning.className="reference-retracted";warning.textContent=getString("relatedbox-retracted-badge");warning.title=ref.retraction.reason||"";content.append(warning);}
      const action=doc.createElement("button");action.type="button";action.className="reference-action";this.actionIcon(action,ref._item?'open':'add',getString(ref._item?"cards-show-library":"cards-import"));
      action.addEventListener('dblclick',event=>event.stopPropagation());
      action.addEventListener("click",async event=>{
        event.stopPropagation();if(action.disabled||!current()||!row.isConnected)return;
        const parent=this.parent();if(!parent||parent.deleted)return;
        const collections=this.views.utils.importCollections(parent,this.body.ownerDocument.defaultView!);
        const active=()=>current()&&row.isConnected&&this.parent()?.id===parent.id;
        action.disabled=true;action.setAttribute('aria-busy','true');row.dataset.importRevision=String(Number(row.dataset.importRevision||0)+1);
        this.actionIcon(action,'busy',getString('cards-importing-doi'));
        try {
          const found=await this.views.utils.searchLibraryItem({...ref,_item:undefined},parent.libraryID);
          if(!active())return;
          if(found){ref._item=found;await this.views.utils.selectItemInLibrary(found, this.body.ownerDocument.defaultView!);}
          else {const result=await this.batchResults.run(parent,[ref],{owner:this.body,collections,downloadOA:false,createSubCollection:false,createManifestNote:false},[index+1]);
            if(result.cancelled)throw new Error(getString('cards-import-cancelled'));
            if(result.failedCount)throw new Error(importFailureText(result.failures[0]));
            if(active())this.label().textContent=importSummaryText(result);
          }
          if(active()&&ref._item){this.actionIcon(action,'open',getString("cards-show-library"));dot.style.backgroundColor="var(--color-accent, #3678b5)";dot.title=getString("cards-in-library");row.style.opacity="1";this.invalidateLibraryMatches();}
        }catch(error){if(error instanceof JournalCommitPendingError||error instanceof JournalUnavailableError)void this.journalStatus.show();if(active()){const message=importErrorText(error);this.label().textContent=message;this.actionIcon(action,'error',message);}ztoolkit.log(error);}finally{row.dataset.importRevision=String(Number(row.dataset.importRevision||0)+1);action.disabled=false;action.removeAttribute('aria-busy');}
      });
      action.setAttribute("aria-label",action.title);
      row.style.opacity=ref._item?"1":String(Zotero.Prefs.get(`${config.addonRef}.notInLibarayOpacity`)||"1");
      title.addEventListener("mouseenter",()=>{if(!Zotero.Prefs.get(`${config.addonRef}.isShowTip`))return;globalThis.clearTimeout(this.hoverTimer);this.hoverTimer=globalThis.setTimeout(()=>{if(!current()||!row.isConnected)return;this.clearTip();this.tip=this.views.showTipUI(title.getBoundingClientRect() as any,{...ref,primaryVenue:ref.publicationVenue,identifiers:ref.identifiers||{}} as any,"left",ref.identifiers?.DOI,true,this.body.ownerDocument.defaultView!);},Math.max(100,Math.min(2000,Number(Zotero.Prefs.get(`${config.addonRef}.showTipAfterMillisecond`))||233)));});
      title.addEventListener("mouseleave",()=>{globalThis.clearTimeout(this.hoverTimer);if(this.tip){const tip=this.tip;globalThis.clearTimeout(tip.tipTimer);tip.tipTimer=globalThis.setTimeout(()=>{if(this.tip===tip)this.clearTip();},tip.removeTipAfterMillisecond);}});
      marker.append(number);citation.append(marker,text);heading.append(dot,title,action);content.append(heading,metadata);row.append(citation,content);
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
        else if(event.key===" "){event.preventDefault();this.select(index,event);}
        else if(["ArrowUp","ArrowDown","Home","End","PageUp","PageDown"].includes(event.key)){
          event.preventDefault();const visible=this.virtual?this.filtered():this.visible().map(node=>(node as any).reference);
          const viewport=Math.min(this.grid.clientHeight,(this.grid.ownerDocument.defaultView?.innerHeight||this.grid.clientHeight)*0.65);
          const height=this.virtual?this.rowHeight:Math.max(1,row.getBoundingClientRect().height);
          const position=visible.indexOf(ref),page=Math.max(1,Math.floor(viewport/height));
          const target=event.key==='Home'?0:event.key==='End'?visible.length-1:position+(event.key==='PageDown'?page:event.key==='PageUp'?-page:event.key==='ArrowDown'?1:-1);
          const refNext=visible[Math.max(0,Math.min(visible.length-1,target))];
          if(!refNext)return;
          const focus=()=>{const next=this.rows.find(node=>(node as any).reference===refNext);if(next){next.focus({preventScroll:true});next.scrollIntoView({block:"nearest"});this.select(this.refs.indexOf(refNext),event);}};
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
    const collectionsAtOpen=this.views.utils.importCollections(parentAtOpen,this.body.ownerDocument.defaultView!);
    const samePanel=()=>!this.disposed&&this.body.isConnected&&Number(this.body.getAttribute("data-refflow-item-id"))===parentAtOpen.id;
    const doc:any=this.body.ownerDocument,popup=doc.createXULElement("menupopup") as any;popup.setAttribute("data-refflow-menu","references");
    const add=(key:string,action:()=>any,checked?:boolean)=>{const item=doc.createXULElement("menuitem");item.setAttribute("label",getString(key));if(checked!==undefined){item.setAttribute("type","checkbox");item.checked=checked;}item.addEventListener("command",()=>Promise.resolve().then(()=>{if(samePanel())return action();}).catch(error=>{if(samePanel()){this.label().textContent=importErrorText(error);if(error instanceof JournalCommitPendingError||error instanceof JournalUnavailableError)void this.journalStatus.show();}ztoolkit.log(error);}));popup.append(item);};
    const separator=()=>popup.append(doc.createXULElement("menuseparator"));
    add("cards-copy-text",()=>this.views.utils.copyText(refsAtOpen.map(ref=>ref.text||ref.title).join("\n"),false));
    add("cards-copy-doi",()=>this.views.utils.copyText(refsAtOpen.map(ref=>ref.identifiers?.DOI).filter(Boolean).join("\n"),false));
    add("cards-copy-url",()=>this.views.utils.copyText(refsAtOpen.map(ref=>ref.url||(ref.identifiers?.DOI?`https://doi.org/${ref.identifiers.DOI}`:"")).filter(Boolean).join("\n"),false));
    add("cards-open",()=>refsAtOpen.slice(0,20).forEach(ref=>this.open(ref)));
    separator();
    const importRefs=async(all:boolean)=>{const parent=parentAtOpen;const refs=all?allAtOpen:refsAtOpen;if(!refs.length)return;const result=await this.batchResults.run(parent,refs,{owner:this.body,collections:collectionsAtOpen,downloadOA:Boolean(Zotero.Prefs.get(`${config.addonRef}.downloadOA`)),createSubCollection:true,createManifestNote:true},refs.map(ref=>allAtOpen.indexOf(ref)+1));if(samePanel()){this.invalidateLibraryMatches();this.label().textContent=(result.cancelled?getString('cards-import-cancelled'):importSummaryText(result))+(result.failedCount?' · '+importFailureText(result.failures[0]):'');}};
    add("cards-import-selected",()=>importRefs(false));add("cards-import-all",()=>importRefs(true));
    add("relatedbox-rollback",async()=>{const parent=parentAtOpen;const id=await BatchImporter.latestBatchID(parent).catch(error=>{ztoolkit.log('Failed to read rollback journal',error);throw new Error(getString('cards-rollback-failed'));});if(id){const count=await this.views.rollbackReferences(parent,id);if(samePanel()){this.batchResults.clear();this.invalidateLibraryMatches();this.label().textContent=getString('cards-rollback-summary',{args:{count}});}}});
    separator();
    for(const source of ["Auto","PDF","Web","API"])add(source==="Auto"?"cards-source-auto":source==="Web"?"cards-source-web":source==="PDF"?"cards-source-pdf":"cards-source-online",()=>{if(!samePanel())return;this.body.querySelector<HTMLSelectElement>("select")!.value=source;this.body.querySelector("select")!.dispatchEvent(new (this.body.ownerDocument.defaultView as any).Event("change"));},this.body.getAttribute("source")===source);
    for(const sort of ["Original","Recency","Cited Count"])add(sort==="Original"?"cards-sort-original":sort==="Recency"?"cards-sort-recency":"cards-sort-cited",async()=>{if(!samePanel())return;Zotero.Prefs.set(`${config.addonRef}.sortBy`,sort);await this.views.sortReferences(this.body);},Zotero.Prefs.get(`${config.addonRef}.sortBy`)===sort);
    add("relatedbox-download-oa",()=>Zotero.Prefs.set(`${config.addonRef}.downloadOA`,!Zotero.Prefs.get(`${config.addonRef}.downloadOA`)),Boolean(Zotero.Prefs.get(`${config.addonRef}.downloadOA`)));
    separator();add('cards-journal-inspect',()=>this.journalStatus.show());
    this.menus.add(popup);
    popup.addEventListener("popuphidden",()=>{this.menus.delete(popup);popup.remove();},{once:true});doc.documentElement.append(popup);
    if(event)popup.openPopupAtScreen(event.screenX,event.screenY,true);else popup.openPopup(this.body.closest("item-pane-custom-section"),"after_end",0,0,false,false);
  }
}
