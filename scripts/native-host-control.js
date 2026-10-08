if(!/refnexus-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
await Zotero.Promise.delay(1000);
const status=[];
for(const url of ['https://api.openalex.org/works/doi:10.1038%2Fnphys1170?select=id,related_works','https://api.openalex.org/works?filter=cites:W2124801294&per_page=100']){try{const res=await Zotero.HTTP.request('GET',url,{successCodes:false,responseType:'json',errorDelayMax:0,timeout:10000});status.push({url,status:res.status,meta:res.response?.meta,error:res.response?.error,message:res.response?.message});}catch(e){status.push({url,error:String(e)});}}

const messages=Services.console.getMessageArray().map(entry=>{let data={message:entry.message};try{const err=entry.QueryInterface(Ci.nsIScriptError);data={message:err.errorMessage,source:err.sourceName,line:err.lineNumber,category:err.category};}catch{}return data;});
await Zotero.File.putContentsAsync(cfg.output,JSON.stringify({version:Zotero.version,hasRefNexus:Boolean(Zotero.ZoteroRefNexus),errors:Zotero.getErrors(true),errorDetails:Zotero.getErrors(false).map(e=>({message:e.message,stack:String(e.stack),source:e.sourceName,line:e.lineNumber})),console:messages,status},null,2));
