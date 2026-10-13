/** UTF-8 size without depending on window globals or importing platform encoders. */
export function utf8Bytes(text:string):number {
  let bytes=0;
  for(let i=0;i<text.length;i++){
    const code=text.charCodeAt(i);
    if(code<0x80)bytes++;else if(code<0x800)bytes+=2;
    else if(code>=0xd800&&code<=0xdbff&&text.charCodeAt(i+1)>=0xdc00&&text.charCodeAt(i+1)<=0xdfff){bytes+=4;i++;}
    else bytes+=3;
  }
  return bytes;
}
export function encodeData(value:unknown):string|undefined {
  try{return JSON.stringify(value,(key,value)=>key==="_item"||key==="_itemID"?undefined:value);}
  catch{return undefined;}
}
