import {capabilities,policy,audit,dateNow as now,id,expireOffers,moneyValid,diagnosticValid} from './marketplace-domain.js';
import {readUpload} from './upload.js';
import {validDate,uuid} from './seller-domain.js';
export async function marketplace(request,env,url,h){
 const {json,ApiError,exigerUtilisateur,lireJson}=h,fail=(s,m)=>{throw new ApiError(s,m);};
 const q=(s,...p)=>env.DB.prepare(s).bind(...p),path=url.pathname.slice('/api/marketplace'.length),method=request.method;
 const rules=await policy(env);
 if(path==='/rules'&&method==='GET')return json({version:rules.version,offerHours:rules.offer_hours,confirmationHours:rules.confirmation_hours,withdrawalAllowed:!!rules.withdrawal_allowed,contractEnabled:false,minPhotos:rules.min_photos,identityRequired:!!rules.identity_required,identityProcedure:rules.identity_procedure,notice:'Modèles et règles à valider par un juriste tunisien. L’acceptation du vendeur et la confirmation des deux parties sont distinctes. La finalisation a lieu hors plateforme.'});
 const user=await exigerUtilisateur(request,env),caps=await capabilities(env,user);
 if(!['GET','HEAD'].includes(method)){const gate=await q('INSERT INTO marketplace_api_attempts(user_id,at) SELECT ?,? WHERE (SELECT COUNT(*) FROM marketplace_api_attempts WHERE user_id=? AND at>?)<120',user.id,now(),user.id,new Date(Date.now()-60000).toISOString()).run();if(!gate.meta.changes)fail(429,'Trop de requêtes : réessaie dans une minute.');}
 const admin=()=>{if(!caps.admin)fail(403,'Accès administrateur requis.');};
 const moderator=()=>{if(!caps.moderator)fail(403,'Accès modérateur requis.');};
 const checked=r=>{if(r.meta.changes<1)fail(409,'État modifié ou opération indisponible. Recharge la page.');};
 const body=()=>lireJson(request);
 const reason=b=>{if(typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>2000)fail(400,'Motif requis (2000 caractères maximum).');return b.reason.trim();};
 await expireOffers(env);
 if(path==='/me'&&method==='GET')return json({capabilities:caps,userId:user.id,profiles:{buyer:!!user.buyer_enabled,seller:!!user.seller_enabled}});
 if(path==='/policy'){
  admin();if(method==='GET')return json({policy:rules});
  if(method==='PUT'){
   const b=await body();
   if(!/^[\w.-]{1,80}$/.test(b.version||'')||b.version===rules.version||![b.offerHours,b.confirmationHours].every(v=>Number.isInteger(v)&&v>=1&&v<=720)||!Number.isInteger(b.minPhotos)||b.minPhotos<7||b.minPhotos>20||!Number.isInteger(b.retentionDays)||b.retentionDays<30||b.retentionDays>3650||typeof b.withdrawalAllowed!=='boolean'||typeof b.contractEnabled!=='boolean'||typeof b.identityRequired!=='boolean')fail(400,'Règles invalides ou version non renouvelée.');
   if(b.contractEnabled)fail(409,'La confirmation contractuelle est hors périmètre du Lot 1.');
   if(b.identityRequired&&(!b.identityProcedure||b.confirmLegalReview!==true))fail(400,'Procédure de collecte validée requise.');
   await env.DB.batch([q('UPDATE marketplace_policy SET version=?,offer_hours=?,confirmation_hours=?,withdrawal_allowed=?,contract_enabled=?,legal_review_reference=?,min_photos=?,retention_days=?,identity_required=?,identity_procedure=? WHERE id=1',b.version,b.offerHours,b.confirmationHours,b.withdrawalAllowed?1:0,b.contractEnabled?1:0,String(b.legalReviewReference||'').slice(0,200),b.minPhotos,b.retentionDays,b.identityRequired?1:0,String(b.identityProcedure||'').slice(0,2000)),q('INSERT INTO audit_logs(actor_id,action,resource_id,at) VALUES(?,?,?,?)',user.id,'policy.changed',b.version,now())]);return json({ok:true});
  }
 }
 if(path==='/roles'&&method==='PUT'){
  admin();const b=await body();if(!Number.isInteger(b.userId)||!['garage','moderator'].includes(b.role)||typeof b.enabled!=='boolean')fail(400,'Rôle invalide.');
  await env.DB.batch([b.enabled?q('INSERT OR IGNORE INTO marketplace_roles VALUES(?,?)',b.userId,b.role):q('DELETE FROM marketplace_roles WHERE user_id=? AND role=?',b.userId,b.role),q('INSERT INTO audit_logs(actor_id,action,resource_id,at) VALUES(?,?,?,?)',user.id,'role.'+(b.enabled?'granted':'revoked'),String(b.userId),now())]);return json({ok:true});
 }
 if(path==='/suspensions'&&method==='PUT'){
  admin();const b=await body();if(!Number.isInteger(b.userId)||b.userId===user.id||typeof b.suspended!=='boolean')fail(400,'Compte ou état invalide.');const why=reason(b);
  await env.DB.batch([b.suspended?q('INSERT INTO marketplace_suspensions VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET reason=excluded.reason,actor_id=excluded.actor_id,at=excluded.at',b.userId,why,user.id,now()):q('DELETE FROM marketplace_suspensions WHERE user_id=?',b.userId),q('INSERT INTO audit_logs(actor_id,action,resource_id,at) VALUES(?,?,?,?)',user.id,b.suspended?'account.suspended':'account.restored',String(b.userId),now())]);return json({ok:true});
 }
 if(path==='/notifications'&&method==='GET')return json({notifications:(await q('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100',user.id).all()).results});
 const notif=path.match(/^\/notifications\/(\d+)\/read$/);
 if(notif&&method==='POST'){await q('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?',now(),+notif[1],user.id).run();return json({ok:true});}
 if(path==='/consents'){
  if(method==='GET')return json({consents:(await q('SELECT purpose,version,resource_id,at FROM user_consents WHERE user_id=? ORDER BY id DESC',user.id).all()).results});
  if(method==='POST'){const b=await body();if(!['seller_terms','privacy_notice'].includes(b.purpose)||b.version!==rules.version||b.confirmed!==true)fail(400,'Consentement explicite et version actuelle requis.');await q('INSERT INTO user_consents(user_id,purpose,version,at) VALUES(?,?,?,?)',user.id,b.purpose,b.version,now()).run();return json({ok:true});}
 }
 if(path==='/privacy'){
  if(method==='GET')return json({requests:(await q('SELECT * FROM privacy_requests WHERE user_id=? ORDER BY created_at DESC',user.id).all()).results,consents:(await q('SELECT purpose,version,at FROM user_consents WHERE user_id=?',user.id).all()).results});
  if(method==='POST'){const b=await body();if(!['access','correction','deletion'].includes(b.kind))fail(400,'Demande invalide.');const requestId=id();await q('INSERT INTO privacy_requests(id,user_id,kind,message,created_at,updated_at) VALUES(?,?,?,?,?,?)',requestId,user.id,b.kind,reason(b),now(),now()).run();await audit(env,user,'privacy.requested',requestId);return json({id:requestId},201);}
 }
 if(path==='/reports'){
  if(method==='GET'){moderator();await audit(env,user,'moderation.read','reports');return json({reports:(await q('SELECT * FROM moderation_reports ORDER BY created_at DESC LIMIT 200').all()).results});}
  if(method==='POST'){
   const b=await body();if(!['listing','dispute','complaint'].includes(b.category))fail(400,'Catégorie invalide.');
   let offer=null;if(b.offerId){offer=await q('SELECT * FROM vehicle_offers WHERE id=? AND (buyer_id=? OR seller_id=?)',b.offerId,user.id,user.id).first();if(!offer)fail(404,'Offre introuvable.');}
   if(b.category==='dispute'&&!offer)fail(400,'Une offre personnelle doit être indiquée pour un litige.');
   if(b.submissionId&&!await q('SELECT id FROM seller_submissions WHERE id=?',b.submissionId).first())fail(404,'Annonce introuvable.');
   const rid=id();await env.DB.batch([q('INSERT INTO moderation_reports(id,user_id,submission_id,offer_id,category,message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',rid,user.id,b.submissionId||offer?.submission_id||null,offer?.id||null,b.category,reason(b),now(),now()),...(offer?[q("UPDATE transactions SET status='disputed',updated_at=? WHERE offer_id=? AND status='contract_confirmed'",now(),offer.id)]:[]),q('INSERT INTO audit_logs(actor_id,action,resource_id,at) VALUES(?,?,?,?)',user.id,'report.created',rid,now())]);return json({id:rid},201);
  }
 }
 const resolve=path.match(/^\/(reports|privacy)\/([a-f0-9]{32})$/);
 if(resolve&&method==='PUT'){
  if(resolve[1]==='privacy')admin();else moderator();const b=await body();if(!['reviewing','resolved','rejected'].includes(b.status))fail(400,'État invalide.');const why=reason(b);
  const table=resolve[1]==='privacy'?'privacy_requests':'moderation_reports';checked(await q(`UPDATE ${table} SET status=?,resolution=?,updated_at=?${resolve[1]==='reports'?',reviewed_by=?':''} WHERE id=?`,b.status,why,now(),...(resolve[1]==='reports'?[user.id]:[]),resolve[2]).run());await audit(env,user,'report.'+b.status,resolve[2]);return json({ok:true});
 }
 if(path==='/dashboard'&&method==='GET'){
  moderator();await audit(env,user,'dashboard.private_read','marketplace');
  const tables=caps.admin?['audit_logs','privacy_requests']:[];const extra={};for(const t of tables)extra[t]=(await q(`SELECT * FROM ${t} ORDER BY ${t==='audit_logs'?'id':'created_at'} DESC LIMIT 200`).all()).results;
  return json({...extra,sellers:(await q('SELECT p.user_id,p.name,p.seller_type,p.professional_number,x.at AS suspended_at FROM seller_profiles p LEFT JOIN marketplace_suspensions x ON x.user_id=p.user_id').all()).results,garages:(await q('SELECT * FROM partner_garages').all()).results,offers:(await q('SELECT id,vehicle_id,submission_id,buyer_id,seller_id,amount_minor,currency,status,created_at FROM vehicle_offers ORDER BY created_at DESC LIMIT 200').all()).results});
 }
 const availability=path.match(/^\/listings\/([a-f0-9]{32})\/availability$/);
 if(availability&&method==='POST'){
  const b=await body();if(!['available','unavailable','sold'].includes(b.availability))fail(400,'Disponibilité invalide.');
  if(b.availability==='sold'&&b.confirmExternalCompletion!==true)fail(428,'Confirme la finalisation effective de la vente hors plateforme.');
  const token=id(),rs=await env.DB.batch([
   q(`UPDATE seller_submissions SET mutation_token=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND stage='published' AND NOT EXISTS(SELECT 1 FROM vehicle_offers WHERE submission_id=seller_submissions.id AND status='accepted' AND ?<>'sold')`,token,now(),availability[1],user.id,b.availability),
   q('UPDATE seller_financials SET availability=? WHERE submission_id=? AND EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)',b.availability,availability[1],availability[1],token),
   q("UPDATE vehicles SET data=json_set(data,'$.availability',?),removed=?,updated_at=? WHERE reference=? AND EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)",b.availability,b.availability==='sold'?1:0,now(),'SV-'+availability[1],availability[1],token),
   q("UPDATE vehicle_offers SET status='cancelled',actor_id=?,reason='vehicle_unavailable',revision=revision+1,updated_at=? WHERE submission_id=? AND status='pending' AND ?<>'available' AND EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)",user.id,now(),availability[1],b.availability,availability[1],token),
   q('INSERT INTO audit_logs(actor_id,action,resource_id,at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)',user.id,'availability.'+b.availability,availability[1],now(),availability[1],token)
  ]);checked(rs[0]);return json({ok:true});
 }
 const revalidate=path.match(/^\/listings\/([a-f0-9]{32})\/revalidate$/);
 if(revalidate&&method==='POST'){
  const r=await q('SELECT * FROM seller_submissions WHERE id=? AND user_id=?',revalidate[1],user.id).first();if(!r)fail(404,'Annonce introuvable.');
  const b=await body(),token=id();if(!Number.isInteger(b.revision))fail(400,'Révision requise.');
  const rs=await env.DB.batch([
   q("UPDATE seller_submissions SET stage='draft',status='draft',diagnostic_verified_at=NULL,public_data=NULL,mutation_token=?,mutation_actor=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND stage IN ('approved','published') AND NOT EXISTS(SELECT 1 FROM vehicle_offers WHERE submission_id=? AND status IN ('accepted'))",token,user.id,now(),r.id,b.revision,r.id),
   q('UPDATE vehicles SET removed=1 WHERE reference=? AND EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)','SV-'+r.id,r.id,token),
   q("UPDATE seller_diagnostics SET diagnostic_status='under_review',verified_at=NULL,verified_by=NULL WHERE submission_id=? AND EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)",r.id,r.id,token),
   q("UPDATE vehicle_offers SET status='cancelled',actor_id=?,reason='listing_revalidation',revision=revision+1,updated_at=? WHERE submission_id=? AND status='pending' AND EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)",user.id,now(),r.id,r.id,token)
  ]);checked(rs[0]);return json({ok:true});
 }
 if(path==='/assignments'){
  if(method==='POST'){
   admin();const b=await body();if(!Number.isInteger(b.garageId)||!Number.isInteger(b.userId)||!await q("SELECT 1 FROM marketplace_roles WHERE user_id=? AND role='garage'",b.userId).first()||!await q("SELECT 1 FROM partner_garages WHERE id=? AND active=1 AND valid_until>=date('now')",b.garageId).first()||!await q("SELECT id FROM seller_submissions WHERE id=? AND stage IN ('draft','corrections')",b.submissionId).first())fail(400,'Partenaire, compte habilité et dossier modifiable requis.');
   await q('INSERT INTO garage_assignments VALUES(?,?,?,?,?) ON CONFLICT(submission_id) DO UPDATE SET garage_id=excluded.garage_id,user_id=excluded.user_id,assigned_by=excluded.assigned_by,at=excluded.at',b.submissionId,b.garageId,b.userId,user.id,now()).run();await audit(env,user,'garage.assigned',b.submissionId);return json({ok:true});
  }
  if(method==='GET'){
   if(!caps.garage&&!caps.admin)fail(403,'Habilitation partenaire requise.');
   if(caps.admin)await audit(env,user,'garage.assignment_read','assignments');
   const rows=await q(`SELECT a.submission_id,a.garage_id,s.data FROM garage_assignments a JOIN seller_submissions s ON s.id=a.submission_id WHERE ${caps.admin?'1=1':'a.user_id=?'}`,...(caps.admin?[]:[user.id])).all();
   return json({assignments:rows.results.map(r=>{const d=JSON.parse(r.data);return {submissionId:r.submission_id,garageId:r.garage_id,make:d.make,model:d.model,vin:d.vin,mileageKm:d.mileageKm};})});
  }
 }
 const diagnosis=path.match(/^\/diagnostics\/([a-f0-9]{32})$/);
 if(diagnosis&&method==='PUT'){
  if(!caps.garage)fail(403,'Habilitation partenaire requise.');
  const b=await body(),a=await q("SELECT a.*,s.data,s.revision FROM garage_assignments a JOIN seller_submissions s ON s.id=a.submission_id JOIN partner_garages g ON g.id=a.garage_id WHERE a.submission_id=? AND a.user_id=? AND s.stage IN ('draft','corrections') AND g.active=1 AND g.valid_until>=date('now')",diagnosis[1],user.id).first();if(!a)fail(404,'Dossier attribué et modifiable introuvable.');
  if(!validDate(b.inspectionDate||'',true)||!validDate(b.validUntil||'')||b.validUntil<b.inspectionDate||!Number.isInteger(b.mileageKm)||b.mileageKm<0||typeof b.observations!=='string'||!b.observations.trim()||typeof b.reportReference!=='string'||!b.reportReference.trim())fail(400,'Données techniques et dates valides requises.');
  const d=JSON.parse(a.data),observations=Object.fromEntries(['engine','transmission','brakes','suspension','steering','electronics','battery','body','tyres','defects'].map(k=>[k,b.observations.slice(0,2000)])),token=id();
  Object.assign(d,{garageId:a.garage_id,diagnosticDate:b.inspectionDate,diagnosticVin:d.vin||'',diagnosticReference:b.reportReference.slice(0,120),diagnosticMileageKm:b.mileageKm,observations});
  const rs=await env.DB.batch([q("UPDATE seller_submissions SET data=?,mutation_token=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND stage IN ('draft','corrections')",JSON.stringify(d),token,now(),a.submission_id,a.revision),q(`INSERT INTO seller_diagnostics(submission_id,garage_id,report_reference,inspected_vin,mileage_km,inspection_date,observations,valid_until,reservations,diagnostic_status) SELECT id,?,?,?,?,?,?,?,?,'submitted' FROM seller_submissions WHERE id=? AND mutation_token=? ON CONFLICT(submission_id) DO UPDATE SET garage_id=excluded.garage_id,report_reference=excluded.report_reference,inspected_vin=excluded.inspected_vin,mileage_km=excluded.mileage_km,inspection_date=excluded.inspection_date,observations=excluded.observations,valid_until=excluded.valid_until,reservations=excluded.reservations,diagnostic_status='submitted',verified_at=NULL,verified_by=NULL`,a.garage_id,d.diagnosticReference,d.vin||'',b.mileageKm,b.inspectionDate,JSON.stringify(observations),b.validUntil,String(b.reservations||'').slice(0,2000),a.submission_id,token)]);checked(rs[0]);await audit(env,user,'diagnostic.updated',a.submission_id);return json({ok:true});
 }
 if(diagnosis&&method==='POST'){
  if(!caps.garage)fail(403,'Habilitation partenaire requise.');
  const a=await q("SELECT a.*,s.revision FROM garage_assignments a JOIN seller_submissions s ON s.id=a.submission_id JOIN partner_garages g ON g.id=a.garage_id WHERE a.submission_id=? AND a.user_id=? AND s.stage IN ('draft','corrections') AND g.active=1 AND g.valid_until>=date('now')",diagnosis[1],user.id).first();if(!a)fail(404,'Dossier attribué et modifiable introuvable.');
  if(!env.SELLER_DOCUMENTS)fail(503,'Stockage privé non configuré.');
  const gate=await q('INSERT INTO seller_upload_attempts(user_id,at) SELECT ?,? WHERE (SELECT COUNT(*) FROM seller_upload_attempts WHERE user_id=? AND at>?)<20',user.id,now(),user.id,new Date(Date.now()-60000).toISOString()).run();if(!gate.meta.changes)fail(429,'Trop de fichiers.');
  const {bytes,type}=await readUpload(request,'diagnostic',false,fail),fid=id(),token=id(),key=`seller/${a.submission_id}/${fid}`;
  await env.SELLER_DOCUMENTS.put(key,bytes,{httpMetadata:{contentType:type}});
  try{const rs=await env.DB.batch([
   q("UPDATE seller_submissions SET revision=revision+1,mutation_token=?,updated_at=?,data=json_set(data,'$.garageId',?) WHERE id=? AND revision=? AND stage IN ('draft','corrections') AND EXISTS(SELECT 1 FROM garage_assignments WHERE submission_id=? AND user_id=?) AND (SELECT COUNT(*) FROM seller_files WHERE submission_id=?)<40",token,now(),a.garage_id,a.submission_id,a.revision,a.submission_id,user.id,a.submission_id),
   q("INSERT INTO seller_files(id,submission_id,kind,storage_key,content_type,size,created_at) SELECT ?,id,'diagnostic',?,?,?,? FROM seller_submissions WHERE id=? AND mutation_token=?",fid,key,type,bytes.length,now(),a.submission_id,token),
   q("UPDATE seller_diagnostics SET diagnostic_status='submitted',verified_by=NULL,verified_at=NULL WHERE submission_id=? AND EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)",a.submission_id,a.submission_id,token)
  ]);checked(rs[0]);}catch(e){await env.SELLER_DOCUMENTS.delete(key);throw e;}
  await audit(env,user,'diagnostic.uploaded',a.submission_id);return json({id:fid},201);
 }
 if(path==='/partners'&&method==='PUT'){
  admin();const b=await body();if(!['partner','mandated','authorized'].includes(b.sourceType)||typeof b.authorizationReference!=='string'||!b.authorizationReference.trim())fail(400,'Source et référence d’autorisation administrative requises.');
  checked(await q('UPDATE partner_garages SET source_type=?,authorization_reference=? WHERE id=?',b.sourceType,b.authorizationReference.slice(0,200),b.garageId).run());await audit(env,user,'partner.authorized',String(b.garageId));return json({ok:true});
 }
 fail(404,'Route marketplace inconnue.');
}
