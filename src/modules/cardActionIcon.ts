export function actionIcon(action:HTMLButtonElement,state:'add'|'open'|'busy'|'error',label:string){
    const doc=action.ownerDocument,ns='http://www.w3.org/2000/svg';
    action.dataset.actionState=state;action.title=label;action.setAttribute('aria-label',label);
    const svg=doc.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 16 16');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
    svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.5');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
    if(state==='busy')for(const x of [3,8,13]){const circle=doc.createElementNS(ns,'circle');circle.setAttribute('cx',String(x));circle.setAttribute('cy','8');circle.setAttribute('r','1');circle.setAttribute('fill','currentColor');circle.setAttribute('stroke','none');svg.append(circle);}
    else{const path=doc.createElementNS(ns,'path');path.setAttribute('d',state==='add'?'M8 3v10M3 8h10':state==='open'?'M4 12 12 4M5 4h7v7':'M8 3.5v6M8 12h0');svg.append(path);}
    action.replaceChildren(svg);
  }
