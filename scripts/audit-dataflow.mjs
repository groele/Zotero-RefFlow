import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const roots=['src','addon','build/addon'];
const retiredMembers=new Set(['getSelectedCollection','getSelectedCollectionID','getSelectedLibraryID','collectionTreeRow','CookieSandbox','fulltextWord','PDFViewerApplication','_iframeWindow','_readers']);
const retiredURLs=[/semanticscholar\.org\/api\/1\//i,/semanticscholar\.org\/graph\/v1\/id_translator/i,/readpaper\.com\/api\//i,/rest\.prod\.connectedpapers\.com\/id_translator/i];
const files=[];
const walk=dir=>{if(!fs.existsSync(dir))return;for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const name=path.join(dir,entry.name);if(entry.isDirectory())walk(name);else if(/\.(ts|js|mjs)$/.test(name))files.push(name);}};
roots.forEach(walk);
const report={at:new Date().toISOString(),scope:roots,files:files.length,retired:[],calls:[],urlPatterns:[],internalMembers:[]};
for(const file of files){
  const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  const locate=node=>({file:file.replaceAll('\\','/'),line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1});
  const visit=node=>{
    if(ts.isPropertyAccessExpression(node)||ts.isElementAccessExpression(node)){
      const member=ts.isPropertyAccessExpression(node)?node.name.text:ts.isStringLiteral(node.argumentExpression)?node.argumentExpression.text:'';
      if(retiredMembers.has(member))report.retired.push({...locate(node),member});
      if(file.startsWith('src')&&member.startsWith('_'))report.internalMembers.push({...locate(node),member});
    }
    if(ts.isCallExpression(node)){
      const expression=node.expression.getText(source);
      if(file.startsWith('src')&&expression.startsWith('Zotero.'))report.calls.push({...locate(node),expression});
    }
    if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)){
      if(retiredURLs.some(pattern=>pattern.test(node.text)))report.retired.push({...locate(node),url:node.text});
      if(file.startsWith('src')&&/^https?:\/\//.test(node.text))report.urlPatterns.push({...locate(node),url:node.text});
    }
    ts.forEachChild(node,visit);
  };visit(source);
}
const output=process.argv[2]||'docs/evidence/dataflow-2026-10-12/interface-audit.json';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({files:report.files,retired:report.retired,hostCalls:report.calls.length,internalMembers:report.internalMembers.length,output},null,2));
if(report.retired.length)process.exitCode=1;
