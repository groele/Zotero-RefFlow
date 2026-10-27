import batchJournal from './batchJournal';
import type Views from './views';
import {getString} from '../utils/locale';
import {importErrorText} from './importErrors';

/** Read-only diagnostics; retry writes only when this process holds commit evidence. */
export default class JournalStatus {
  private panel?:HTMLElement;
  private generation=0;
  constructor(private views:Views,private body:HTMLElement,private grid:HTMLElement){}
  clear(){this.generation++;this.panel?.remove();this.panel=undefined;}
  async show(){
    const generation=++this.generation,parentID=this.body.getAttribute('data-refflow-item-id');
    const current=()=>generation===this.generation&&this.body.isConnected&&this.body.getAttribute('data-refflow-item-id')===parentID;
    const diagnostics=await batchJournal.diagnostics();if(!current())return;
    const doc=this.body.ownerDocument,panel=doc.createElement('div');panel.className='refflow-journal-status';
    const status=doc.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    status.textContent=getString(diagnostics.state==='ready'?'cards-journal-ready':diagnostics.canRetry?'cards-journal-committed':'cards-journal-unknown');panel.append(status);
    if(diagnostics.backupAvailable){const backup=doc.createElement('p');backup.textContent=getString('cards-journal-backup');panel.append(backup);}
    const copy=doc.createElement('button');copy.type='button';copy.textContent=getString('cards-journal-copy');copy.dataset.journalAction='copy';copy.addEventListener('click',()=>{if(current())this.views.utils.copyText(JSON.stringify(diagnostics,null,2),false);});panel.append(copy);
    if(diagnostics.canRetry){const retry=doc.createElement('button');retry.type='button';retry.textContent=getString('cards-journal-retry');retry.dataset.journalAction='retry';retry.addEventListener('click',async()=>{
      if(retry.disabled||!current())return;retry.disabled=true;panel.setAttribute('aria-busy','true');
      try{await batchJournal.retryCommitted();if(current())await this.show();}catch(error){if(current())status.textContent=importErrorText(error);}finally{panel.removeAttribute('aria-busy');if(current())retry.disabled=false;}
    });panel.append(retry);}
    this.panel?.remove();this.panel=panel;this.grid.before(panel);
  }
}
