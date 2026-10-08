import {config} from "../../package.json";
import {getString} from "../utils/locale";
import type Views from "./views";
import type TipUI from "./tip";

/** Compact reference cards and selection behavior aligned with the supplied XPI. */
export default class ReferenceCards {
  private refs:ItemBaseInfo[]=[];
  private selected=new Set<ItemBaseInfo>();
  private anchor=0;
  private disposed=false;
  private searchTimer?:number;
  private rows:HTMLElement[]=[];
  private observer?:IntersectionObserver;
  private matchQueue:Array<()=>Promise<void>>=[];
  private matchActive=0;
  private hoverTimer?:number;
  private tip?:TipUI;

  constructor(private views:Views,private body:HTMLElement,private grid:HTMLElement,private search:HTMLInputElement) {
    search.addEventListener("input",()=>{window.clearTimeout(this.searchTimer);this.searchTimer=window.setTimeout(()=>this.filter(),80);});
    grid.setAttribute("role","listbox");grid.setAttribute("aria-multiselectable","true");
    grid.addEventListener("contextmenu",event=>{event.preventDefault();this.menu(event);});
  }
  dispose(){this.disposed=true;window.clearTimeout(this.searchTimer);this.clear();}
  clear(){this.observer?.disconnect();this.matchQueue=[];window.clearTimeout(this.hoverTimer);this.tip?.clear();this.tip=undefined;this.selected.clear();this.refs=[];this.rows=[];this.grid.replaceChildren();this.search.value="";}
  private drainMatches(){while(this.matchActive<4&&this.matchQueue.length){const match=this.matchQueue.shift()!;this.matchActive++;void match().catch(error=>ztoolkit.log(error)).finally(()=>{this.matchActive--;if(!this.disposed)this.drainMatches();});}}

  private parent():Zotero.Item{return Zotero.Items.get(Number(this.body.getAttribute("data-refnexus-item-id"))) as Zotero.Item;}
  private label():HTMLElement{return this.body.querySelector("#reference-num")!;}
  private visible(){return this.rows.filter(row=>!row.hidden);}
  private subset():ItemBaseInfo[]{return this.selected.size?[...this.selected]:this.visible().map(row=>(row as any).reference);}
  private updateSelection(){for(const row of this.rows){const selected=this.selected.has((row as any).reference);row.classList.toggle("selected",selected);row.setAttribute("aria-selected",String(selected));}}
  private select(index:number,event:MouseEvent|KeyboardEvent){
    const ref=this.refs[index];
    if(event.shiftKey){if(!event.ctrlKey&&!event.metaKey)this.selected.clear();for(let i=Math.min(index,this.anchor);i<=Math.max(index,this.anchor);i++)if(!this.rows[i]?.hidden)this.selected.add(this.refs[i]);}
    else if(event.ctrlKey||event.metaKey){if(this.selected.has(ref))this.selected.delete(ref);else this.selected.add(ref);this.anchor=index;}
    else{this.selected.clear();this.selected.add(ref);this.anchor=index;}
    this.updateSelection();
  }
  private filter(){
    const tokens=this.search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    for(const row of this.rows){const ref=(row as any).reference as ItemBaseInfo;const hay=[ref.text,ref.title,...(ref.authors||[]),ref.year,ref.publicationVenue,ref.identifiers?.DOI].join(" ").toLocaleLowerCase();row.hidden=!tokens.every(token=>hay.includes(token));if(row.hidden)this.selected.delete(ref);}
    this.updateSelection();this.label().textContent=`${this.visible().length} / ${this.rows.length} · ${this.body.getAttribute("data-refnexus-result-source")||""}`;
  }
  async render(refs:ItemBaseInfo[],current:()=>boolean){
    this.clear();this.refs=refs;this.disposed=false;
    const fragment=this.body.ownerDocument.createDocumentFragment();
    const parent=this.parent();
    const original:ItemBaseInfo[]=(this.body as any).references||refs;
    const positions=new Map(original.map((ref,index)=>[ref,index+1]));
    const numbers=refs.map((ref,index)=>Number.isSafeInteger(Number(ref.number))&&Number(ref.number)>0?Number(ref.number):(positions.get(ref)||index+1));
    this.grid.style.setProperty("--refnexus-number-width",`${numbers.reduce((width,number)=>Math.max(width,String(number).length+1),2)}ch`);
    if((window as any).IntersectionObserver)this.observer=new (window as any).IntersectionObserver((entries:IntersectionObserverEntry[])=>{
      for(const entry of entries)if(entry.isIntersecting){this.observer?.unobserve(entry.target);const row=entry.target as HTMLElement,ref=(row as any).reference;
        this.matchQueue.push(async()=>{if(!current()||!row.isConnected)return;const found=await this.views.utils.searchLibraryItem(ref,parent.libraryID);if(!current()||!row.isConnected||!found)return;
          row.querySelector(".reference-action")!.textContent="↗";(row.querySelector(".reference-action") as HTMLElement).title=getString("cards-show-library");(row.querySelector(".reference-state") as HTMLElement).style.backgroundColor="var(--color-accent, #3678b5)";row.style.opacity="1";
        });
      }this.drainMatches();
    },{rootMargin:"80px"});

    for(let index=0;index<refs.length;index++) {
      const ref=refs[index],doc=this.body.ownerDocument;
      const row=doc.createElement("div");row.className="reference-item";row.tabIndex=0;row.setAttribute("role","option");row.setAttribute("aria-selected","false");(row as any).reference=ref;
      row.setAttribute("aria-posinset",String(index+1));row.setAttribute("aria-setsize",String(refs.length));
      const marker=doc.createElement("div");marker.className="reference-marker";
      const number=doc.createElement("span");number.className="reference-number";number.textContent=`${numbers[index]}.`;number.title=`${getString("cards-number-label")} ${numbers[index]}`;
      row.dataset.referenceNumber=String(numbers[index]);row.setAttribute("aria-label",`${number.title}: ${ref.title||ref.text||""}`);
      const dot=doc.createElement("span");dot.className="reference-state";
      const age=Math.max(0,new Date().getFullYear()-Number(ref.year||2000));dot.style.backgroundColor=ref._item?"var(--color-accent, #3678b5)":`hsl(210 30% ${Math.min(85,40+age*2)}%)`;dot.title=ref._item?getString("cards-in-library"):String(ref.year||"");
      const content=doc.createElement("div");content.className="reference-description";
      const text=doc.createElement("span");text.className="reference-text";text.textContent=ref.text||ref.title||"";text.title=text.textContent||"";
      const title=doc.createElement("strong");title.className="reference-title";title.textContent=ref.title||ref.text||"";title.title=title.textContent||"";
      const about=doc.createElement("span");about.className="reference-about";about.textContent=[(ref.authors||[]).slice(0,3).join(" / "),ref.year,ref.publicationVenue,(ref as any).citationCount!==undefined?`${getString("cards-cited")} ${(ref as any).citationCount}`:""].filter(Boolean).join(" · ");
      if(ref.retraction?.isRetracted){const warning=doc.createElement("span");warning.className="reference-retracted";warning.textContent=getString("relatedbox-retracted-badge");warning.title=ref.retraction.reason||"";content.append(warning);}
      content.append(text,title,about);
      const action=doc.createElement("button");action.type="button";action.className="reference-action";action.textContent=ref._item?"↗":"+";action.title=getString(ref._item?"cards-show-library":"cards-import");
      action.addEventListener("click",async event=>{
        event.stopPropagation();action.disabled=true;
        try {
          const parent=this.parent();const found=await this.views.utils.searchLibraryItem(ref,parent.libraryID);
          if(found)this.views.utils.selectItemInLibrary(found);
          else await this.views.importReferences(parent,[ref],{downloadOA:false,createSubCollection:false,createManifestNote:false});
          if(ref._item){action.textContent="↗";action.title=getString("cards-show-library");dot.style.backgroundColor="var(--color-accent, #3678b5)";}
        }catch(error){if(row.isConnected)this.label().textContent=String(error);ztoolkit.log(error);}finally{action.disabled=false;}
      });
      row.style.opacity=ref._item?"1":String(Zotero.Prefs.get(`${config.addonRef}.notInLibarayOpacity`)||"1");
      title.addEventListener("mouseenter",()=>{if(!Zotero.Prefs.get(`${config.addonRef}.isShowTip`))return;window.clearTimeout(this.hoverTimer);this.hoverTimer=window.setTimeout(()=>{if(!current()||!row.isConnected)return;this.tip=this.views.showTipUI(title.getBoundingClientRect() as any,{...ref,primaryVenue:ref.publicationVenue,identifiers:ref.identifiers||{}} as any,"left",ref.identifiers?.DOI,true);},Math.max(100,Math.min(2000,Number(Zotero.Prefs.get(`${config.addonRef}.showTipAfterMillisecond`))||233)));});
      title.addEventListener("mouseleave",()=>{window.clearTimeout(this.hoverTimer);if(this.tip){window.clearTimeout(this.tip.tipTimer);this.tip.tipTimer=window.setTimeout(()=>this.tip?.clear(),500);}});
      marker.append(number,dot);row.append(marker,content,action);
      row.addEventListener("click",event=>this.select(index,event));
      row.addEventListener("dblclick",()=>this.open(ref));
      row.addEventListener("contextmenu",event=>{if(!this.selected.has(ref))this.select(index,event);});
      row.addEventListener("keydown",event=>{
        if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="a"){event.preventDefault();for(const node of this.visible())this.selected.add((node as any).reference);this.updateSelection();}
        else if(event.key==="Enter"){event.preventDefault();this.open(ref);}
        else if(["ArrowUp","ArrowDown"].includes(event.key)){event.preventDefault();const visible=this.visible();const next=visible[Math.max(0,Math.min(visible.length-1,visible.indexOf(row)+(event.key==="ArrowDown"?1:-1)))];if(next){next.focus();this.select(this.rows.indexOf(next),event);}}
      });
      this.rows.push(row);fragment.append(row);
      if(index%40===39){await Zotero.Promise.delay(0);if(!current()||this.disposed)return;}
    }
    if(current()&&!this.disposed){this.grid.append(fragment);for(const row of this.rows)this.observer?.observe(row);}
  }
  private open(ref:ItemBaseInfo){if(ref._item)this.views.utils.selectItemInLibrary(ref._item);else{const url=ref.url||(ref.identifiers?.DOI?`https://doi.org/${ref.identifiers.DOI}`:undefined);if(url&&/^https?:\/\//i.test(url))Zotero.launchURL(url);}}
  menu(event?:MouseEvent){
    const parentAtOpen=this.parent(),refsAtOpen=this.subset(),allAtOpen=[...this.refs];
    const doc:any=this.body.ownerDocument,popup=doc.createXULElement("menupopup") as any;popup.setAttribute("data-refnexus-menu","references");
    const add=(key:string,action:()=>any,checked?:boolean)=>{const item=doc.createXULElement("menuitem");item.setAttribute("label",getString(key));if(checked!==undefined){item.setAttribute("type","checkbox");item.setAttribute("checked",String(checked));}item.addEventListener("command",()=>Promise.resolve(action()).catch(error=>{this.label().textContent=String(error);ztoolkit.log(error);}));popup.append(item);};
    const separator=()=>popup.append(doc.createXULElement("menuseparator"));
    add("cards-copy-text",()=>this.views.utils.copyText(this.subset().map(ref=>ref.text||ref.title).join("\n"),false));
    add("cards-copy-doi",()=>this.views.utils.copyText(this.subset().map(ref=>ref.identifiers?.DOI).filter(Boolean).join("\n"),false));
    add("cards-copy-url",()=>this.views.utils.copyText(this.subset().map(ref=>ref.url||(ref.identifiers?.DOI?`https://doi.org/${ref.identifiers.DOI}`:"")).filter(Boolean).join("\n"),false));
    add("cards-open",()=>this.subset().slice(0,20).forEach(ref=>this.open(ref)));
    separator();
    const importRefs=async(all:boolean)=>{const parent=parentAtOpen,id=parent.id;const refs=all?allAtOpen:refsAtOpen;if(!refs.length)return;await this.views.importReferences(parent,refs,{downloadOA:Boolean(Zotero.Prefs.get(`${config.addonRef}.downloadOA`)),createSubCollection:true,createManifestNote:true});if(Number(this.body.getAttribute("data-refnexus-item-id"))===id)await this.views.refreshReferences(this.body as any,true,false,false,parent);};
    add("cards-import-selected",()=>importRefs(false));add("cards-import-all",()=>importRefs(true));
    add("relatedbox-rollback",async()=>{const parent=parentAtOpen;const matches=[...String(parent.getField("extra")||"").matchAll(/^refnexus_batch_parent: (refnexus_batch_\w+)$/gm)];const id=matches[matches.length-1]?.[1];if(id){await this.views.rollbackReferences(parent,id);if(Number(this.body.getAttribute("data-refnexus-item-id"))===parent.id)await this.views.refreshReferences(this.body as any,true,false,false,parent);}});
    separator();
    for(const source of ["Auto","PDF","Web","API"])add(source==="Auto"?"cards-source-auto":source==="Web"?"cards-source-web":source==="PDF"?"cards-source-pdf":"cards-source-online",()=>{this.body.querySelector<HTMLSelectElement>("select")!.value=source;this.body.querySelector("select")!.dispatchEvent(new (window as any).Event("change"));},this.body.getAttribute("source")===source);
    for(const sort of ["Original","Recency","Cited Count"])add(sort==="Original"?"cards-sort-original":sort==="Recency"?"cards-sort-recency":"cards-sort-cited",async()=>{Zotero.Prefs.set(`${config.addonRef}.sortBy`,sort);await this.views.refreshReferences(this.body as any,true);},Zotero.Prefs.get(`${config.addonRef}.sortBy`)===sort);
    add("relatedbox-download-oa",()=>Zotero.Prefs.set(`${config.addonRef}.downloadOA`,!Zotero.Prefs.get(`${config.addonRef}.downloadOA`)),Boolean(Zotero.Prefs.get(`${config.addonRef}.downloadOA`)));
    popup.addEventListener("popuphidden",()=>popup.remove(),{once:true});doc.documentElement.append(popup);
    if(event)popup.openPopupAtScreen(event.screenX,event.screenY,true);else popup.openPopup(this.body.closest("item-pane-custom-section"),"after_end",0,0,false,false);
  }
}
