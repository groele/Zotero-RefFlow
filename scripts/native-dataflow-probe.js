if(!/refnexus-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated profile required');
const report={version:Zotero.version,structuredAPI:typeof Zotero.PDFWorker?.getStructuredDocumentText,results:[]};
for(const name of ['single','columns','author-year','numbered-prose','large']) {
  const item=new Zotero.Item('journalArticle');item.setField('title','Dataflow native structured '+name);await item.saveTx();
  const attachment=await Zotero.Attachments.importFromFile({file:cfg.fixtures+'\\'+name+'.pdf',parentItemID:item.id});
  try {
    const start=Date.now(),pack=await Zotero.SDT.getReader(attachment.id,{isPriority:true}),data=pack?await pack.materialize():null;
    const path=cfg.output.replace(/\.json$/,'-'+name+'-structured.json');await Zotero.File.putContentsAsync(path,JSON.stringify(data,null,2));
    report.results.push({name,itemID:attachment.id,keys:Object.keys(data||{}),ms:Date.now()-start,path});
  }catch(error){report.results.push({name,error:String(error),stack:error.stack});}
  await Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
}
report.finished=new Date().toISOString();report.passed=report.results.filter(r=>!r.error).length;report.failed=report.results.filter(r=>r.error).length;await Zotero.File.putContentsAsync(cfg.output,JSON.stringify(report,null,2));
