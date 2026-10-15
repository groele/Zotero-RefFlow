/** Validated provider data, independent of the embedded rendering implementation. */
export function validateGraph(value:any):Graph {
  if(!value||!value.nodes||typeof value.nodes!=='object'||Array.isArray(value.nodes))throw new Error('Invalid graph nodes');
  const entries=Object.entries(value.nodes);if(entries.length>2000)throw new Error('Graph exceeds 2000 nodes');
  const nodes:Record<string,any>={};
  for(const [key,row] of entries){const node=row as any;
    if(!key||!node||typeof node.title!=='string'||!node.title.trim())throw new Error('Invalid graph publication');
    nodes[key]={...node,paperId:node.paperId||node.paper_id||node.id||key,authors:Array.isArray(node.authors)?node.authors.filter((author:any)=>typeof author?.name==='string'):[]};
  }
  const edges=value.edges??[];if(!Array.isArray(edges)||edges.length>20000)throw new Error('Invalid graph edges or edge limit exceeded');
  for(const edge of edges)if(!Array.isArray(edge)||!nodes[edge[0]]||!nodes[edge[1]]||!Number.isFinite(edge[2]))throw new Error('Graph edge refers to an invalid node');
  const related=(rows:any)=>Array.isArray(rows)?rows.filter(row=>row&&typeof row.title==='string').map(row=>({...row,paperId:row.paperId||row.paper_id||row.id,
    local_citations:Array.isArray(row.local_citations)?row.local_citations:[],local_references:Array.isArray(row.local_references)?row.local_references:[]})):[];
  return {...value,nodes,edges,common_references:related(value.common_references),common_citations:related(value.common_citations),common_authors:Array.isArray(value.common_authors)?value.common_authors:[]} as Graph;
}
export function graphColor(paper:any):string {return paper._itemID?'#bd3b45':`hsl(${175+Math.max(0,Math.min(35,(Number(paper.year)||2000)-1990))} 48% 42%)`;}
