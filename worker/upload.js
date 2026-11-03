// Validation bornée et retrait des métadonnées sans dépendance de décodage externe.
export async function readUpload(request,kind,photo,fail){
 const type=request.headers.get('Content-Type')?.split(';')[0];
 if(kind==='diagnostic'?type!=='application/pdf':!['application/pdf','image/jpeg','image/png','image/webp'].includes(type)||(photo&&type==='application/pdf'))fail(415,'Format de pièce invalide.');
 const reader=request.body?.getReader();if(!reader)fail(400,'Fichier vide.');
 const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10*1024*1024){await reader.cancel();fail(413,'10 Mo maximum.');}chunks.push(value);}
 let bytes=join(chunks);const ascii=(a,b)=>String.fromCharCode(...bytes.slice(a,b));
 const valid=type==='application/pdf'?ascii(0,5)==='%PDF-':type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:type==='image/png'?[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v):ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP';
 if(!valid)fail(415,'Le contenu ne correspond pas au format annoncé.');
 if(type==='application/pdf'){
  const pdf=new TextDecoder('latin1').decode(bytes).replace(/#([0-9a-f]{2})/gi,(_,h)=>String.fromCharCode(parseInt(h,16)));
  if(!pdf.includes('%%EOF')||/\/(?:JavaScript|JS\b|Launch|EmbeddedFile|RichMedia|XFA|Encrypt|OpenAction|AA\b)/i.test(pdf))fail(415,'PDF actif, chiffré, incomplet ou avec pièces intégrées refusé.');
 }else{try{bytes=stripMetadata(bytes,type);}catch{fail(415,'Image endommagée ou structure non prise en charge.');}}
 return {bytes,type};
}
function join(parts){const r=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let i=0;for(const p of parts){r.set(p,i);i+=p.length;}return r;}
export function stripMetadata(b,type){
 const v=new DataView(b.buffer,b.byteOffset,b.byteLength),str=(p,n)=>String.fromCharCode(...b.slice(p,p+n));
 if(type==='image/png'){
  const out=[b.slice(0,8)];let p=8,end=false;
  while(p<b.length){if(p+12>b.length)throw 0;const n=v.getUint32(p),k=str(p+4,4);if(p+n+12>b.length)throw 0;
   if(!['eXIf','tEXt','zTXt','iTXt','tIME'].includes(k))out.push(b.slice(p,p+n+12));p+=n+12;if(k==='IEND'){end=true;break;}}
  if(!end)throw 0;return join(out);
 }
 if(type==='image/jpeg'){
  const out=[b.slice(0,2)];let p=2;
  while(p<b.length){if(b[p++]!==255)throw 0;while(b[p]===255)p++;const k=b[p++];if(k===0xda){if(b[b.length-2]!==255||b[b.length-1]!==217)throw 0;out.push(b.slice(p-2));return join(out);}
   if(k===0xd9){out.push(new Uint8Array([255,217]));return join(out);}if(p+2>b.length)throw 0;const n=v.getUint16(p);if(n<2||p+n>b.length)throw 0;
   if(!(k>=0xe1&&k<=0xef)&&k!==0xfe)out.push(b.slice(p-2,p+n));p+=n;
  }throw 0;
 }
 const out=[b.slice(0,12)];let p=12,seen=false;
 while(p+8<=b.length){const k=str(p,4),n=v.getUint32(p+4,true),end=p+8+n+(n%2);if(end>b.length)throw 0;
  if(!['EXIF','XMP ','ICCP'].includes(k)){const c=b.slice(p,end);if(k==='VP8X')c[8]&=~0x2c;out.push(c);if(['VP8 ','VP8L','ANMF'].includes(k))seen=true;}p=end;}
 if(!seen||p!==b.length)throw 0;const result=join(out);new DataView(result.buffer).setUint32(4,result.length-8,true);return result;
}
