import {capabilities,policy,financial,decimal,toMinor,audit,diagnosticValid} from './marketplace-domain.js';
import {readUpload} from './upload.js';
import {PHOTO_KINDS,FILE_LABELS,SYSTEMS,COUNTRY_CODES,EDITABLE,now,uuid,reference,legacy,text,normalize,missing,publicLot,drainDeletions,purgeSeller,validDate} from './seller-domain.js';
export {purgeSeller};

export function sellerRoutes(path){return path.startsWith('/api/seller/')||path.startsWith('/api/admin/seller/');}
export async function routeSeller(request,env,url,h){
 const {json,ApiError,exigerUtilisateur,sha256,CGV_VERSION}=h;
 const fail=(status,message)=>{throw new ApiError(status,message);};
 const lireJson=async req=>{
  if(!(req.headers.get('Content-Type')||'').startsWith('application/json'))fail(415,'Format attendu : JSON.');
  const reader=req.body?.getReader();if(!reader)fail(400,'Corps JSON requis.');
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256*1024){await reader.cancel();fail(413,'Dossier JSON trop volumineux (256 Ko maximum).');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'JSON illisible.');}
  if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'Objet JSON attendu.');return body;
 };
 const user=await exigerUtilisateur(request,env),admin=url.pathname.startsWith('/api/admin/seller/'),caps=await capabilities(env,user);
 if(admin&&!caps.moderator)fail(403,'Accès de contrôle requis.');
 const restricted=['garages','document-rules','cleanup'];
 if(admin&&!caps.admin&&((request.method!=='GET'&&restricted.some(p=>url.pathname.includes('/'+p)))||url.pathname.endsWith('/publish')||url.pathname.endsWith('/archive')))fail(403,'Accès administrateur requis.');
 const path=url.pathname.replace(admin?'/api/admin/seller/':'/api/seller/',''),method=request.method;
 const query=(sql,...args)=>env.DB.prepare(sql).bind(...args);
 const changed=r=>{if(r.meta.changes<1)fail(409,'Le dossier a changé. Recharge la page.');};
 const revision=b=>{if(!Number.isInteger(b.revision)||b.revision<0)fail(400,'Révision requise.');return b.revision;};
 const load=async id=>{const r=await query('SELECT * FROM seller_submissions WHERE id=?',id).first();if(!r||(!admin&&r.user_id!==user.id))fail(404,'Dossier introuvable.');return {...r,status:r.stage};};
 const files=async id=>(await query(`SELECT id,CASE WHEN document_type='identity' THEN 'identity' ELSE kind END AS kind,content_type,size,created_at,position,is_primary FROM seller_files WHERE submission_id=? ORDER BY position,created_at,id`,id).all()).results;
 const editable=r=>{if(!EDITABLE.includes(r.stage)||r.purged_at)fail(409,'Dossier verrouillé.');};
 const result=async r=>{
  const row={...r,status:r.stage};
  if(admin)await audit(env,user,'listing.private_read',r.id);
  const f=await financial(env,r.id),diag=await query('SELECT * FROM seller_diagnostics WHERE submission_id=?',r.id).first();
  const d=JSON.parse(row.data);if(f&&d.reservePriceMinor!=null)d.publicReserveAmount=decimal(d.reservePriceMinor,f.currency);if(f)Object.assign(d,{priceAmount:decimal(f.asking_minor,f.currency),priceCurrency:f.currency,minimumAmount:f.minimum_minor===null?'':decimal(f.minimum_minor,f.currency),availableFrom:f.available_from,availability:f.availability,deliveryTerms:f.delivery_terms});
  if(diag){d.diagnosticValidUntil=diag.valid_until||'';d.diagnosticReservations=diag.reservations;} let listingState=row.stage==='archived'?'archived':'active';
  if(['published','archived'].includes(row.stage)){
   const v=await query("SELECT removed,EXISTS(SELECT 1 FROM seller_financials WHERE submission_id=? AND availability='sold') AS sold FROM vehicles WHERE reference=?",r.id,reference(r.id)).first();
   listingState=v?.sold?'sold':row.stage==='archived'||!v||v.removed?'archived':'active';
  }
  const events=(await query('SELECT id,actor_id,action,from_stage,to_stage,message,at FROM seller_validation_events WHERE submission_id=? ORDER BY id',r.id).all()).results;
  return {...row,diagnostic:diag,data:d,public_data:undefined,mutation_token:undefined,listingState,files:await files(r.id),events};
 };
 const transition=async(row,stage,b,extra={})=>{
  const token=uuid(),date=now();
  const statements=[query(`UPDATE seller_submissions SET stage=?,status=?,revision=revision+1,feedback=?,updated_at=?,mutation_actor=?,mutation_token=?,
   reviewed_by=?,reviewed_at=?,diagnostic_verified_at=?,public_summary=?,public_data=? WHERE id=? AND revision=? AND stage=? ${['approved','published'].includes(stage)?"AND EXISTS(SELECT 1 FROM partner_garages g WHERE g.id=json_extract(seller_submissions.data,'$.garageId') AND g.active=1 AND g.valid_until>=date('now') AND g.professional_number<>'')":''}`,
   stage,legacy(stage),text(b.feedback,2000),date,user.id,token,admin?user.id:row.reviewed_by,admin?date:row.reviewed_at,
   extra.verifiedAt??row.diagnostic_verified_at,extra.summary??row.public_summary,extra.publicData??row.public_data,row.id,revision(b),row.stage)];
  if(stage==='submitted')statements.push(query('UPDATE seller_submissions SET submitted_at=? WHERE id=? AND mutation_token=?',date,row.id,token));
  if(stage==='approved')statements.push(query("UPDATE seller_diagnostics SET diagnostic_status='approved' WHERE submission_id=? AND valid_until>=date('now') AND EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)",row.id,row.id,token));
  if(['submitted','reviewing','rejected','corrections'].includes(stage))statements.push(query('UPDATE seller_diagnostics SET diagnostic_status=? WHERE submission_id=? AND EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)',({submitted:'submitted',reviewing:'under_review',rejected:'rejected',corrections:'rejected'})[stage],row.id,row.id,token));
  if(stage==='approved')statements.push(query('UPDATE seller_diagnostics SET verified_by=?,verified_at=? WHERE submission_id=? AND EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)',user.id,date,row.id,row.id,token));
  if(stage==='published')statements.push(query(`INSERT INTO vehicles(reference,data,removed,updated_at,updated_by)
    SELECT ?,public_data,0,?,? FROM seller_submissions WHERE id=? AND mutation_token=? ON CONFLICT(reference) DO UPDATE SET data=excluded.data,removed=0,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,reference(row.id),date,user.id,row.id,token));
  const results=await env.DB.batch(statements);changed(results[0]);return json({submission:await result(await load(row.id))});
 };
 if(path==='profile'&&!admin){
  if(method==='GET')return json({profile:await query('SELECT * FROM seller_profiles WHERE user_id=?',user.id).first()});
  if(method==='PUT'){
   const b=await lireJson(request),name=text(b.name),phone=text(b.phone,50),address=text(b.address,500),type=b.sellerType||'individual',number=text(b.professionalNumber,80);
   if(!name||!phone||!address||!['individual','professional'].includes(type)||(type==='professional'&&!number))fail(400,'Coordonnées complètes et numéro professionnel le cas échéant requis.');
   await query(`INSERT INTO seller_profiles(user_id,name,phone,address,updated_at,seller_type,professional_number) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,phone=excluded.phone,address=excluded.address,updated_at=excluded.updated_at,seller_type=excluded.seller_type,professional_number=excluded.professional_number`,user.id,name,phone,address,now(),type,number).run();
   return json({profile:await query('SELECT * FROM seller_profiles WHERE user_id=?',user.id).first()});
  }
 }
 if(path==='garages'){
  if(method==='GET')return json({garages:(await query(`SELECT * FROM partner_garages ${admin?'':"WHERE active=1 AND valid_until>=? AND professional_number<>''"} ORDER BY name`,...(admin?[]:[now().slice(0,10)])).all()).results});
  if(method==='POST'&&admin){
   const b=await lireJson(request),name=text(b.name),address=text(b.address,500),contact=text(b.contact,200),number=text(b.professionalNumber,80);
   if(!name||!address||!contact||!number||!validDate(b.validUntil||''))fail(400,'Raison sociale, adresse, contact, numéro professionnel et validité requis.');
   return json({garage:await query('INSERT INTO partner_garages(name,address,contact,professional_number,valid_until) VALUES(?,?,?,?,?) RETURNING *',name,address,contact,number,b.validUntil).first()},201);
  }
 }
 const gm=path.match(/^garages\/(\d+)$/);
 if(gm&&method==='PUT'&&admin){
  const b=await lireJson(request);if(typeof b.active!=='boolean')fail(400,'État du garage invalide.');
  if(b.validUntil&&!validDate(b.validUntil))fail(400,'Date de validité invalide.');
  changed(await query('UPDATE partner_garages SET active=?,valid_until=COALESCE(?,valid_until),professional_number=COALESCE(?,professional_number) WHERE id=?',b.active?1:0,b.validUntil||null,b.professionalNumber?text(b.professionalNumber,80):null,Number(gm[1])).run());return json({ok:true});
 }
 if(path==='document-rules'){
  if(method==='GET')return json({rules:(await query('SELECT country_code,seller_type,kind,required,updated_at FROM seller_document_rules ORDER BY country_code,seller_type,kind').all()).results});
  if(method==='POST'&&admin){
   const b=await lireJson(request),country=b.countryCode,type=b.sellerType,kind=b.kind;
   if((country!=='*'&&!COUNTRY_CODES.has(country))||!['*','individual','professional'].includes(type)||!Object.hasOwn(FILE_LABELS,kind)||kind==='identity'||PHOTO_KINDS.includes(kind)||typeof b.required!=='boolean')fail(400,'Règle documentaire invalide.');
   await query('INSERT INTO seller_document_rules(country_code,seller_type,kind,required,updated_by,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(country_code,seller_type,kind) DO UPDATE SET required=excluded.required,updated_by=excluded.updated_by,updated_at=excluded.updated_at',country,type,kind,b.required?1:0,user.id,now()).run();
   return json({ok:true});
  }
  fail(405,'Méthode non autorisée.');
 }
 if(path==='cleanup'&&method==='POST'&&admin)return json({deleted:await purgeSeller(env,(await policy(env)).retention_days)});
 if(path==='offers')fail(410,'Utiliser les offres privées /api/marketplace/offers.');
 if(path==='submissions'){
  if(method==='GET'){
   const rows=admin?await query(`SELECT s.*,p.name AS seller_name,p.phone AS seller_phone,p.address AS seller_address,p.seller_type,p.professional_number,u.email AS seller_email FROM seller_submissions s JOIN users u ON u.id=s.user_id LEFT JOIN seller_profiles p ON p.user_id=s.user_id WHERE s.purged_at IS NULL ORDER BY s.updated_at DESC`).all():await query('SELECT * FROM seller_submissions WHERE user_id=? AND purged_at IS NULL ORDER BY updated_at DESC',user.id).all();
   return json({submissions:await Promise.all(rows.results.map(result))});
  }
  if(method==='POST'&&!admin){
   if(!await query('SELECT user_id FROM seller_profiles WHERE user_id=?',user.id).first())fail(400,'Complète ton profil vendeur.');
   const id=uuid();await query('INSERT INTO seller_submissions(id,user_id,created_at,updated_at,mutation_actor) VALUES(?,?,?,?,?)',id,user.id,now(),now(),user.id).run();
   await query("INSERT INTO seller_validation_events(submission_id,actor_id,action,from_stage,to_stage,at) VALUES(?,?,'created','','draft',?)",id,user.id,now()).run();
   return json({submission:await result(await load(id))},201);
  }
 }
 const access=path.match(/^file-access\/([a-f0-9]{32})$/);
 let fileId=null;
 if(access&&method==='GET'){
  const token=await query('SELECT file_id FROM seller_file_access WHERE token_hash=? AND user_id=? AND expires_at>?',await sha256(access[1]),user.id,now()).first();
  if(!token)fail(404,'Accès temporaire expiré ou invalide.');fileId=token.file_id;
 }
 const fm=path.match(/^files\/([a-f0-9]{32})(?:\/(access))?$/);
 if(fileId||fm){
  const f=await query('SELECT * FROM seller_files WHERE id=?',fileId||fm[1]).first();if(!f)fail(404,'Pièce introuvable.');
  const owner=await load(f.submission_id);
  if(fm?.[2]==='access'&&method==='POST'){
   const token=uuid(),expiresAt=new Date(Date.now()+5*60000).toISOString();
   await query('INSERT INTO seller_file_access(token_hash,file_id,user_id,expires_at) VALUES(?,?,?,?)',await sha256(token),f.id,user.id,expiresAt).run();
   return json({url:`${admin?'/api/admin/seller/':'/api/seller/'}file-access/${token}`,expiresAt});
  }
  if(method==='DELETE'&&!admin){
   editable(owner);const b=await lireJson(request),token=uuid();
   const r=await env.DB.batch([
    query('UPDATE seller_submissions SET revision=revision+1,mutation_token=?,updated_at=? WHERE id=? AND revision=? AND stage=?',token,now(),owner.id,revision(b),owner.stage),
    query('DELETE FROM seller_files WHERE id=? AND EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)',f.id,owner.id,token)
   ]);changed(r[0]);await drainDeletions(env);return json({ok:true});
  }
  if(method==='GET'){
   if(admin)await audit(env,user,'document.read',f.id);
   if(!env.SELLER_DOCUMENTS)fail(503,'Stockage privé indisponible.');const object=await env.SELLER_DOCUMENTS.get(f.storage_key);if(!object)fail(404,'Pièce introuvable.');
   const preview=url.searchParams.get('preview')==='1'&&PHOTO_KINDS.includes(f.kind),ext={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[f.content_type];
   return new Response(object.body,{headers:{'Content-Type':f.content_type,'Content-Disposition':`${preview?'inline':'attachment'}; filename="${f.kind}-${f.id}.${ext}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
  }
  fail(405,'Méthode non autorisée.');
 }
 const sm=path.match(/^submissions\/([a-f0-9]{32})(?:\/(files|photos|submit|review|publish|archive))?$/);
 if(!sm)fail(404,'Route vendeur inconnue.');
 const row=await load(sm[1]),action=sm[2];
 if(!action&&method==='GET')return json({submission:await result(row),missing:await missing(env,row,await files(row.id))});
 if(!action&&method==='PUT'&&!admin){
  editable(row);const b=await lireJson(request),src=b.data||{},d=normalize(src,fail),token=uuid(),date=now();
  let asking=null,minimum=null;try{if(src.priceAmount)asking=toMinor(src.priceAmount,src.priceCurrency||'TND');if(src.minimumAmount)minimum=toMinor(src.minimumAmount,src.priceCurrency||'TND');}catch{fail(400,'Montant décimal invalide pour la devise.');}
  if(asking!==null&&asking<=0||minimum!==null&&(asking===null||minimum>asking))fail(400,'Prix minimum ou prix demandé invalide.');
  if(src.availableFrom&&!validDate(src.availableFrom))fail(400,'Date de disponibilité invalide.');
  if(src.diagnosticValidUntil&&!validDate(src.diagnosticValidUntil))fail(400,'Validité du diagnostic invalide.');
  if(src.availability&&!['available','unavailable','sold'].includes(src.availability))fail(400,'Disponibilité invalide.');
  const statements=[query('UPDATE seller_submissions SET data=?,revision=revision+1,updated_at=?,mutation_token=?,mutation_actor=? WHERE id=? AND revision=? AND stage=?',JSON.stringify(d),date,token,user.id,row.id,revision(b),row.stage)];
  statements.push(query('DELETE FROM seller_financials WHERE submission_id=? AND EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)',row.id,row.id,token));
  if(asking!==null)statements.push(query('INSERT INTO seller_financials(submission_id,currency,asking_minor,minimum_minor,available_from,availability,delivery_terms) SELECT id,?,?,?,?,?,? FROM seller_submissions WHERE id=? AND mutation_token=?',src.priceCurrency||'TND',asking,minimum,src.availableFrom||'',src.availability||'available',text(src.deliveryTerms,2000),row.id,token));
  statements.push(query('DELETE FROM seller_vin_claims WHERE submission_id=? AND EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)',row.id,row.id,token));
  if(/^[A-HJ-NPR-Z0-9]{17}$/.test(d.vin))statements.push(query('INSERT INTO seller_vin_claims(vin,submission_id) SELECT ?,id FROM seller_submissions WHERE id=? AND mutation_token=?',d.vin,row.id,token));
  statements.push(query(`INSERT INTO seller_diagnostics(submission_id,garage_id,report_reference,inspected_vin,mileage_km,inspection_date,observations)
   SELECT id,?,?,?,?,?,? FROM seller_submissions WHERE id=? AND mutation_token=?
   ON CONFLICT(submission_id) DO UPDATE SET garage_id=excluded.garage_id,report_reference=excluded.report_reference,inspected_vin=excluded.inspected_vin,mileage_km=excluded.mileage_km,inspection_date=excluded.inspection_date,observations=excluded.observations,verified_by=NULL,verified_at=NULL`,d.garageId||null,d.diagnosticReference,d.diagnosticVin,d.diagnosticMileageKm,d.diagnosticDate,JSON.stringify(d.observations),row.id,token));
  statements.push(query("UPDATE seller_diagnostics SET diagnostic_status='missing',valid_until=?,reservations=? WHERE submission_id=? AND EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)",src.diagnosticValidUntil||null,text(src.diagnosticReservations,2000),row.id,row.id,token));
  statements.push(query('DELETE FROM seller_damages WHERE submission_id=? AND EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)',row.id,row.id,token));
  for(const x of d.damages)statements.push(query('INSERT INTO seller_damages(id,submission_id,zone,damage_type,severity,description,photo_ids) SELECT ?,id,?,?,?,?,? FROM seller_submissions WHERE id=? AND mutation_token=?',uuid(),x.zone,x.type,x.severity,x.description,JSON.stringify(x.photoIds),row.id,token));
  try{const rs=await env.DB.batch(statements);changed(rs[0]);}catch(e){if(String(e).includes('UNIQUE'))fail(409,'Ce VIN est déjà associé à un dossier actif.');if(String(e).includes('FOREIGN KEY'))fail(400,'Garage inconnu.');throw e;}
  return json({submission:await result(await load(row.id))});
 }
 if(action==='photos'&&method==='PUT'&&!admin){
  editable(row);const b=await lireJson(request),photos=(await files(row.id)).filter(f=>PHOTO_KINDS.includes(f.kind));
  if(!Array.isArray(b.order)||b.order.length!==photos.length||new Set(b.order).size!==photos.length||b.order.some(id=>!photos.some(f=>f.id===id))||!b.order.includes(b.main))fail(400,'Ordre ou photo principale invalide.');
  const token=uuid(),rs=await env.DB.batch([
   query('UPDATE seller_submissions SET revision=revision+1,mutation_token=?,updated_at=? WHERE id=? AND revision=? AND stage=?',token,now(),row.id,revision(b),row.stage),
   ...b.order.map((id,i)=>query('UPDATE seller_files SET position=?,is_primary=? WHERE id=? AND submission_id=? AND EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)',i,id===b.main?1:0,id,row.id,row.id,token))
  ]);changed(rs[0]);return json({submission:await result(await load(row.id))});
 }
 if(action==='files'&&method==='POST'&&!admin){
  editable(row);if(!env.SELLER_DOCUMENTS)fail(503,'Stockage privé non configuré.');
  const gate=await query('INSERT INTO seller_upload_attempts(user_id,at) SELECT ?,? WHERE (SELECT COUNT(*) FROM seller_upload_attempts WHERE user_id=? AND at>?)<20',user.id,now(),user.id,new Date(Date.now()-60000).toISOString()).run();
  if(gate.meta.changes!==1)fail(429,'20 tentatives d’envoi par minute maximum. Réessaie dans une minute.');
  const kind=url.searchParams.get('kind'),type=request.headers.get('Content-Type')?.split(';')[0];
  if(kind==='identity'&&!(await policy(env)).identity_required)fail(409,'Collecte d’identité non activée sans procédure validée.');
  if(!Object.hasOwn(FILE_LABELS,kind))fail(400,'Catégorie inconnue.');
  if(kind==='diagnostic'?type!=='application/pdf':!['application/pdf','image/jpeg','image/png','image/webp'].includes(type)||(PHOTO_KINDS.includes(kind)&&type==='application/pdf'))fail(415,'Format de pièce invalide.');
  if((await files(row.id)).length>=40)fail(400,'40 pièces maximum.');
  const {bytes}=await readUpload(request,kind,PHOTO_KINDS.includes(kind),fail),size=bytes.length;
  const id=uuid(),key=`seller/${row.id}/${id}`,token=uuid();await env.SELLER_DOCUMENTS.put(key,bytes,{httpMetadata:{contentType:type}});
  try{
   const rs=await env.DB.batch([
    query('UPDATE seller_submissions SET revision=revision+1,mutation_token=?,updated_at=? WHERE id=? AND revision=? AND stage=? AND (SELECT COUNT(*) FROM seller_files WHERE submission_id=?)<40',token,now(),row.id,row.revision,row.stage,row.id),
    query('INSERT INTO seller_files(id,submission_id,kind,document_type,storage_key,content_type,size,created_at,position) SELECT ?,id,?,?,?,?,?,?,(SELECT COUNT(*) FROM seller_files WHERE submission_id=?) FROM seller_submissions WHERE id=? AND mutation_token=?',id,kind==='identity'?'other':kind,kind==='identity'?'identity':'',key,type,size,now(),row.id,row.id,token)
   ]);changed(rs[0]);
  }catch(e){await env.SELLER_DOCUMENTS.delete(key);throw e;}
  return json({submission:await result(await load(row.id))},201);
 }
 if(action==='submit'&&method==='POST'&&!admin){
  editable(row);const rules=await policy(env);for(const purpose of ['seller_terms','privacy_notice'])if(!await query('SELECT 1 FROM user_consents WHERE user_id=? AND purpose=? AND version=?',user.id,purpose,rules.version).first())fail(428,'Lecture explicite des conditions vendeurs et de confidentialité requise.');
  const b=await lireJson(request),errors=await missing(env,row,await files(row.id));
  if(errors.length)return json({error:'Dossier incomplet.',missing:errors},400);
  const claim=await query('SELECT submission_id FROM seller_vin_claims WHERE vin=?',JSON.parse(row.data).vin).first();if(claim?.submission_id!==row.id)fail(409,'Ce VIN doit être associé à ce dossier avant soumission.');
  return transition(row,'submitted',b);
 }
 if(action==='review'&&method==='POST'&&admin){
  const b=await lireJson(request);revision(b);
  if(!['submitted','reviewing'].includes(row.stage))fail(409,'Ce dossier ne peut plus être traité.');
  if(!['reviewing','corrections','rejected','approved'].includes(b.decision))fail(400,'Décision invalide.');
  if(b.decision==='reviewing'&&row.stage!=='submitted')fail(409,'Vérification déjà commencée.');
  if(['corrections','rejected'].includes(b.decision)&&!text(b.feedback,2000))fail(400,'Motif requis.');
  if(b.decision==='approved'){
   if(row.stage!=='reviewing')fail(409,'Commence la vérification avant d’approuver.');
   if(b.diagnosticAuthentic!==true||b.documentsChecked!==true||b.vinChecked!==true)fail(400,'Confirme la vérification réelle du diagnostic, du VIN et du dossier.');
   const errors=await missing(env,row,await files(row.id));if(errors.length)return json({error:'Dossier incomplet ou agrément expiré.',missing:errors},400);
   return transition(row,'approved',b,{verifiedAt:now(),summary:text(b.publicSummary,3000)});
  }
  return transition(row,b.decision,b);
 }
 if(action==='publish'&&method==='POST'&&admin){
  const b=await lireJson(request);if(row.stage!=='approved'||!row.diagnostic_verified_at||!await diagnosticValid(env,row.id))fail(409,'Approbation préalable requise.');
  const errors=await missing(env,row,await files(row.id));if(errors.length)return json({error:'Dossier à revalider.',missing:errors},400);
  let lot;try{lot=await publicLot(env,row,await files(row.id));if(!lot)fail(409,'Diagnostic expiré.');}catch(e){if(e.message==='publication-price')fail(400,'Prix demandé et devise requis.');if(e.message==='private-identifiers')fail(400,'Retire le VIN et la plaque du contenu destiné au public avant publication.');throw e;}
  return transition(row,'published',b,{publicData:JSON.stringify(lot)});
 }
 if(action==='archive'&&method==='POST'){
  const b=await lireJson(request);if(row.stage==='published'&&!admin)fail(403,'Le retrait d’une annonce publiée doit être vérifié par l’administration.');
  if(['submitted','reviewing','approved'].includes(row.stage))fail(409,'Dossier en cours de traitement.');
  if(row.stage==='archived')fail(409,'Dossier déjà archivé.');
  const token=uuid(),date=now(),rs=await env.DB.batch([
   query("UPDATE seller_submissions SET stage='archived',status='approved',revision=revision+1,mutation_token=?,mutation_actor=?,updated_at=? WHERE id=? AND revision=? AND stage=?",token,user.id,date,row.id,revision(b),row.stage),
   query('UPDATE vehicles SET removed=1,updated_at=? WHERE reference=? AND EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)',date,reference(row.id),row.id,token),
   query('DELETE FROM seller_vin_claims WHERE submission_id=? AND EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)',row.id,row.id,token)
  ]);changed(rs[0]);return json({submission:await result(await load(row.id))});
 }
 fail(405,'Méthode non autorisée.');
}
export async function sellerMedia(env,id,head=false){
 const f=await env.DB.prepare(`SELECT f.* FROM seller_files f JOIN seller_submissions s ON s.id=f.submission_id JOIN vehicles v ON v.reference='SV-'||s.id
  WHERE f.id=? AND s.stage='published' AND s.diagnostic_verified_at IS NOT NULL AND v.removed=0 AND NOT EXISTS(SELECT 1 FROM marketplace_suspensions x WHERE x.user_id=s.user_id) AND EXISTS(SELECT 1 FROM seller_diagnostics d JOIN partner_garages g ON g.id=d.garage_id WHERE d.submission_id=s.id AND d.diagnostic_status='approved' AND d.valid_until>=date('now') AND g.active=1 AND g.valid_until>=date('now'))`).bind(id).first();
 if(!f||!PHOTO_KINDS.includes(f.kind)||!env.SELLER_DOCUMENTS)return new Response('Introuvable',{status:404});
 const object=await env.SELLER_DOCUMENTS[head?'head':'get'](f.storage_key);if(!object)return new Response('Introuvable',{status:404});
 return new Response(head?null:object.body,{headers:{'Content-Type':f.content_type,'Cache-Control':'public, max-age=60','X-Content-Type-Options':'nosniff'}});
}
export async function verifiedSellerLots(env,items){
 const rows=await env.DB.prepare("SELECT id,public_data FROM seller_submissions WHERE stage='published' AND diagnostic_verified_at IS NOT NULL").all();
 const signature=lot=>JSON.stringify(['make','model','trim','year','mileageKm','fuel','bodyType','transmission','color','powerHp','engineCc','doors','seats','condition','photos','specs','equipment','damages','diagnostic'].map(k=>lot[k]??null));
 const verified=new Map(rows.results.filter(r=>r.public_data).map(r=>[reference(r.id),signature(JSON.parse(r.public_data))]));
 return items.map(item=>{const lot={...item.lot};delete lot.diagnosticVerified;if(verified.get(lot.reference)===signature(lot))lot.diagnosticVerified=true;return {...item,lot};});
}
