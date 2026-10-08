export interface ReferenceResult {references:ItemBaseInfo[];source:string;expected?:number;partial?:boolean;attempts?:string[];}
export interface ReferenceProvider {name:string;run:()=>Promise<ReferenceResult|undefined>;}

export function referenceGaps(references:ItemBaseInfo[]):boolean {
  const numbers=references.map(ref=>ref.number).filter((value):value is number=>Number.isInteger(value));
  if(numbers.length!==references.length||numbers.length<2)return false;
  return numbers[0]!==1 || numbers.some((number,index)=>index>0&&number!==numbers[index-1]+1);
}

/** Stop on a usable list; replace an incomplete list as a whole, never mix numbering. */
export async function retrieveReferenceList(providers:ReferenceProvider[],signal?:AbortSignal,onProgress?:(source:string)=>void):Promise<ReferenceResult> {
  let best:ReferenceResult={references:[],source:"Auto"};
  const attempts:string[]=[];
  for(const provider of providers) {
    if(signal?.aborted){const error=new Error("Reference retrieval cancelled");error.name="AbortError";throw error;}
    onProgress?.(provider.name);
    try {
      const result=await provider.run();
      if(signal?.aborted){const error=new Error("Reference retrieval cancelled");error.name="AbortError";throw error;}
      const refs=result?.references||[];
      attempts.push(`${provider.name}: ${refs.length}`);
      if(!refs.length)continue;
      const partial=Boolean(result?.partial || (result?.expected && refs.length<result.expected) || referenceGaps(refs));
      const candidate={...result!,partial};
      if(!best.references.length || refs.length>best.references.length)best=candidate;
      if(!partial)return {...best,attempts};
    } catch(error:any) {
      if(error?.name==="AbortError"||signal?.aborted)throw error;
      attempts.push(`${provider.name}: ${String(error?.message||error).slice(0,160)}`);
    }
  }
  return {...best,attempts};
}
