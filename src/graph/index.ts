import {validateGraph,graphColor} from '../modules/graphModel';

const ns='http://www.w3.org/2000/svg';
const svg=document.querySelector<SVGSVGElement>('#graph')!;
const status=document.querySelector<HTMLElement>('#status')!;
const empty=document.querySelector<HTMLElement>('#empty')!;
const detail=document.querySelector<HTMLElement>('#detail')!;
const zh=navigator.language.toLowerCase().startsWith('zh');
if(zh){document.documentElement.lang='zh-CN';document.querySelector('header strong span')!.textContent='文献关系图';document.querySelector('#reset')!.textContent='适应视图';document.querySelector('footer small')!.textContent='连线表示研究相似性；红色节点表示已有 Zotero 条目。';svg.setAttribute('aria-label','研究相似性关系图');}
let data:any={nodes:{},edges:[]},selected='',hover='',scale=1,panX=0,panY=0;
const layer=document.createElementNS(ns,'g');svg.append(layer);
const circles=new Map<string,SVGCircleElement>();
const emit=(type:string,paperId:string)=>window.dispatchEvent(new CustomEvent('refflow-graph-event',{detail:{version:1,type,paperId}}));
const transform=()=>layer.setAttribute('transform',`translate(${panX},${panY}) translate(500,300) scale(${scale}) translate(-500,-300)`);
const reset=()=>{scale=1;panX=panY=0;transform();};
document.querySelector('#reset')!.addEventListener('click',reset);
document.querySelector('#zoom-in')!.addEventListener('click',()=>{scale=Math.min(4,scale*1.25);transform();});
document.querySelector('#zoom-out')!.addEventListener('click',()=>{scale=Math.max(.3,scale/1.25);transform();});
let drag:{x:number;y:number;px:number;py:number}|undefined;
svg.addEventListener('pointerdown',event=>{if((event.target as Element).closest('circle'))return;drag={x:event.clientX,y:event.clientY,px:panX,py:panY};svg.setPointerCapture(event.pointerId);});
svg.addEventListener('pointermove',event=>{if(!drag)return;const box=svg.getBoundingClientRect();panX=drag.px+(event.clientX-drag.x)*1000/Math.max(1,box.width);panY=drag.py+(event.clientY-drag.y)*600/Math.max(1,box.height);transform();});
svg.addEventListener('pointerup',()=>{drag=undefined;});
svg.addEventListener('pointercancel',()=>{drag=undefined;});
function setState(state:{selected?:string;hover?:string}){
  if(state.selected!==undefined)selected=state.selected;if(state.hover!==undefined)hover=state.hover;
  for(const [id,circle] of circles){circle.classList.toggle('selected',id===selected);circle.classList.toggle('hover',id===hover);circle.setAttribute('aria-pressed',String(id===selected));}
  const node=Object.values(data.nodes).find((row:any)=>row.paperId===(hover||selected)) as any;
  detail.textContent=node?[node.title,node.year,(node.authors||[]).slice(0,3).map((a:any)=>a.name).join(' / ')].filter(Boolean).join(' · '):'';
}
function clear(message=zh?'先添加起始文献，再构建关系图。':'Add a paper as an origin, then build its graph.'){
  data={nodes:{},edges:[]};layer.replaceChildren();circles.clear();selected=hover='';empty.hidden=false;empty.textContent=message;detail.textContent='';status.textContent=zh?'尚未加载关系图':'No graph loaded';reset();
}
function setGraph(raw:any,options:{origins?:string[];retrievedAt?:string}={}){
  const next=validateGraph(raw);data=next;layer.replaceChildren();circles.clear();reset();
  const entries=Object.entries(next.nodes),positions=new Map<string,[number,number]>();
  const provided=entries.every(([,node]:any)=>Array.isArray(node.pos)&&node.pos.length>=2&&node.pos.slice(0,2).every(Number.isFinite));
  const xs=entries.map(([,node]:any)=>provided?node.pos[0]:0),ys=entries.map(([,node]:any)=>provided?node.pos[1]:0);
  const lowX=Math.min(...xs),lowY=Math.min(...ys),rangeX=Math.max(1,Math.max(...xs)-lowX),rangeY=Math.max(1,Math.max(...ys)-lowY);
  const factor=Math.min(840/rangeX,470/rangeY),centerX=(Math.max(...xs)+lowX)/2,centerY=(Math.max(...ys)+lowY)/2;
  entries.forEach(([key,node]:any,index)=>{const angle=index*2.399963229728653,radius=230*Math.sqrt((index+1)/Math.max(1,entries.length));
    positions.set(key,provided?[500+(node.pos[0]-centerX)*factor,300+(node.pos[1]-centerY)*factor]:[500+radius*Math.cos(angle)*1.7,300+radius*Math.sin(angle)]);
  });
  const edgeLayer=document.createElementNS(ns,'g');edgeLayer.classList.add('edges');layer.append(edgeLayer);
  for(const [a,b,weight] of next.edges){const start=positions.get(a)!,end=positions.get(b)!,line=document.createElementNS(ns,'line');
    for(const [key,value] of Object.entries({x1:start[0],y1:start[1],x2:end[0],y2:end[1],'stroke-opacity':Math.max(.08,Math.min(.5,weight*2))}))line.setAttribute(key,String(value));edgeLayer.append(line);
  }
  const nodes=document.createElementNS(ns,'g');layer.append(nodes);
  entries.forEach(([key,node]:any,index)=>{const point=positions.get(key)!,circle=document.createElementNS(ns,'circle');
    const radius=4+Math.min(9,Math.log2(1+Math.max(0,Number(node.citationCount)||0)));
    circle.setAttribute('cx',String(point[0]));circle.setAttribute('cy',String(point[1]));circle.setAttribute('r',String(radius));circle.setAttribute('fill',graphColor(node));
    circle.setAttribute('role','button');circle.setAttribute('tabindex','0');circle.setAttribute('aria-label',`${node.title}${node.year?`, ${node.year}`:''}`);
    const title=document.createElementNS(ns,'title');title.textContent=node.title;circle.append(title);
    circle.addEventListener('click',()=>{setState({selected:node.paperId});emit('select',node.paperId);});
    circle.addEventListener('mouseenter',()=>{setState({hover:node.paperId});emit('hover',node.paperId);});circle.addEventListener('mouseleave',()=>{setState({hover:''});emit('hover','');});
    circle.addEventListener('focus',()=>setState({hover:node.paperId}));circle.addEventListener('blur',()=>setState({hover:''}));
    circle.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();circle.dispatchEvent(new MouseEvent('click'));}
      else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const step=['ArrowLeft','ArrowUp'].includes(event.key)?-1:1;const id=(entries[(index+step+entries.length)%entries.length][1] as any).paperId;circles.get(id)?.focus();}
    });nodes.append(circle);circles.set(node.paperId,circle);
  });
  empty.hidden=entries.length>0;status.textContent=`${entries.length} ${zh?'篇文献':'papers'} · ${next.edges.length} ${zh?'条相似关系':'similarity links'} · Connected Papers${options.retrievedAt?' · '+new Date(options.retrievedAt).toLocaleTimeString():''}`;
  setState({selected:'',hover:''});
}
const bridge={version:1,setGraph,setState,clear,get graphdata(){return data;}};
(window as any).RefFlowGraph=bridge;
// Read-only diagnostic alias for existing native acceptance tools; no Vue internals.
Object.defineProperty(window,'app',{value:{get graphdata(){return data;},paper_to_color:graphColor}});
clear();
