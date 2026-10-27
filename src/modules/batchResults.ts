import type Views from './views';
import type {BatchImportOptions,BatchImportResult} from './batchImporter';
import {getString} from '../utils/locale';
import {importErrorText,importFailureText,importSummaryText} from './importErrors';

/** Per-pane, runtime-only recovery. Never infer a new destination on retry. */
export default class BatchResults {
  private panel?:HTMLDetailsElement;
  private generation=0;
  constructor(private views:Views,private body:HTMLElement,private grid:HTMLElement){}
  clear(){this.generation++;this.panel?.remove();this.panel=undefined;}
  async run(parent:Zotero.Item,refs:ItemBaseInfo[],options:BatchImportOptions,positions=refs.map((_,i)=>i+1),focus=false):Promise<BatchImportResult>{
    const generation=++this.generation;
    const current=()=>generation===this.generation&&this.body.isConnected&&Number(this.body.getAttribute('data-refflow-item-id'))===parent.id&&!parent.deleted;
    // Capture metadata and membership before the request can yield to selection changes.
    const snapshot=refs.map(ref=>({...ref,identifiers:{...ref.identifiers},authors:[...(ref.authors||[])]}));
    const captured={...options,collections:options.collections?[...options.collections]:undefined};
    const old=this.panel;
    old?.setAttribute('aria-busy','true');
    const oldRetry=old?.querySelector<HTMLButtonElement>('[data-batch-action="retry"]');if(oldRetry)oldRetry.disabled=true;
    try{
      const result=await this.views.importReferences(parent,refs,captured);
      if(!current())return result;
      const label=this.body.querySelector('#reference-num');if(label)label.textContent=(result.cancelled?getString('cards-import-cancelled')+' · ':'')+importSummaryText(result);
      const doc=this.body.ownerDocument,panel=doc.createElement('details');panel.className='refflow-batch-results';panel.open=result.failedCount>0||Boolean(result.downloadFailedCount);panel.dataset.parentId=String(parent.id);
      const summary=doc.createElement('summary');summary.textContent=getString('cards-batch-results')+' · '+importSummaryText(result);summary.tabIndex=0;panel.append(summary);
      const status=doc.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent=result.cancelled?getString('cards-import-cancelled'):importSummaryText(result);panel.append(status);
      const usable=()=>this.panel===panel&&this.body.isConnected&&Number(this.body.getAttribute('data-refflow-item-id'))===parent.id&&!parent.deleted;
      const failed=result.failures.filter(f=>Number.isSafeInteger(f.index)&&f.index>=0&&f.index<snapshot.length);
      if(failed.length){
        const list=doc.createElement('ol');list.className='refflow-batch-failures';
        let shown=0;const more=doc.createElement('button');more.type='button';more.dataset.batchAction='more';
        const appendPage=()=>{for(const failure of failed.slice(shown,shown+100)){const row=doc.createElement('li');row.value=positions[failure.index];
          const title=doc.createElement('strong');title.textContent=failure.title||snapshot[failure.index].title||snapshot[failure.index].text||'';
          const doi=doc.createElement('div');doi.textContent=failure.doi||getString('cards-batch-no-doi');
          const reason=doc.createElement('div');reason.textContent=importFailureText(failure);row.append(title,doi,reason);list.append(row);
        }shown=Math.min(shown+100,failed.length);more.hidden=shown>=failed.length;more.textContent=getString('cards-batch-more',{args:{remaining:failed.length-shown}});};
        appendPage();more.addEventListener('click',()=>{if(usable())appendPage();});panel.append(list,more);
        const actions=doc.createElement('div');actions.className='refflow-batch-actions';
        const copy=doc.createElement('button');copy.type='button';copy.dataset.batchAction='copy';copy.textContent=getString('cards-batch-copy-doi');
        const dois=[...new Set(failed.map(f=>f.doi).filter(Boolean))];copy.disabled=!dois.length;
        copy.addEventListener('click',()=>{if(usable()){this.views.utils.copyText(dois.join('\n'),false);status.textContent=getString('cards-batch-copied');}});
        const retry=doc.createElement('button');retry.type='button';retry.dataset.batchAction='retry';retry.textContent=getString('cards-batch-retry');
        retry.addEventListener('click',()=>{
          if(retry.disabled||!usable())return;
          const nextOptions={...captured,collections:result.subCollection?[result.subCollection.id]:captured.collections,createSubCollection:result.subCollection?false:captured.createSubCollection};
          void this.run(parent,failed.map(f=>snapshot[f.index]),nextOptions,failed.map(f=>positions[f.index]),true).then(()=>{if(this.body.isConnected&&Number(this.body.getAttribute('data-refflow-item-id'))===parent.id)(this.body as any)._cards?.invalidateLibraryMatches();}).catch(error=>{ztoolkit.log(error);});
        });actions.append(copy,retry);panel.append(actions);
        const hint=doc.createElement('p');hint.textContent=getString('cards-batch-retry-hint');panel.append(hint);
      }
      if(result.downloadFailedCount){const note=doc.createElement('p');note.textContent=getString('cards-batch-pdf-hint');panel.append(note);}
      old?.remove();this.panel=panel;this.grid.before(panel);
      if(focus)summary.focus();
      return result;
    }catch(error){
      if(current()){
        const status=old?.querySelector<HTMLElement>('[role="status"]');if(status)status.textContent=importErrorText(error);
        const label=this.body.querySelector('#reference-num');if(label)label.textContent=importErrorText(error);
      }
      throw error;
    }finally{if(current()){old?.removeAttribute('aria-busy');if(oldRetry)oldRetry.disabled=false;}}
  }
}
