import {capabilities,policy,audit,id,dateNow as now,moneyValid} from './marketplace-domain.js';
import {offerVehicle,proposalActive,reserveTerms,expireProposals,RESERVE_ERROR} from './proposal-domain.js';
export function proposalRoute(path){return /^\/api\/marketplace\/(?:offers(?:\/|$)|proposal-vehicles\/|offer-ownership$)/.test(path);}
export async function proposals(request,env,url,h){
 const {json,ApiError,exigerUtilisateur,lireJson,catalogueComplet}=h;
 const fail=(s,m)=>{throw new ApiError(s,m);},q=(sql,...p)=>env.DB.prepare(sql).bind(...p);
 const path=url.pathname.slice('/api/marketplace'.length),method=request.method,rules=await policy(env);
 await expireProposals(env);
 const lookup=path.match(/^\/proposal-vehicles\/([A-Za-z0-9._-]{1,64})$/);
 if(lookup&&method==='GET'){
  const row=await offerVehicle(env,lookup[1]);let lot=row&&!row.removed?JSON.parse(row.data):null;
  if(!row){const item=(await catalogueComplet(request,env)).find(x=>x.lot.reference===lookup[1]&&!x.removed);lot=item?.lot;}
  if(!lot)fail(404,'Annonce introuvable.');
  if(row?.submission_id&&(row.stage!=='published'||!row.diagnostic_valid||row.owner_suspended))fail(404,'Annonce introuvable.');
  const terms=reserveTerms(lot),enabled=proposalActive(row)&&!row?.proposal_accepted&&!!terms;
  return json({vehicle:{reference:lot.reference,make:lot.make,model:lot.model,currency:lot.currency||lot.priceCurrency||'TND',...terms,active:!!enabled},rules:{version:rules.version,offerHours:rules.offer_hours,withdrawalAllowed:!!rules.withdrawal_allowed},notice:'Proposition privée examinée manuellement. Aucune vente ni aucun paiement automatique après acceptation. Conditions à valider par un juriste.'});
 }
 const user=await exigerUtilisateur(request,env),caps=await capabilities(env,user);
 const changed=r=>{if(r.meta.changes<1)fail(409,'État modifié ou proposition indisponible. Rechargez la page.');};
 const present=r=>({...r,reference:r.vehicle_id,offered_amount:r.amount_minor,amountMinor:r.amount_minor,reservePriceAtSubmission:r.reserve_price_at_submission,buyerMessage:r.buyer_message,rules_snapshot:JSON.parse(r.rules_snapshot),transaction:undefined,counterparty:undefined});
 if(path==='/offer-ownership'&&method==='POST'){
  if(!caps.admin)fail(403,'Accès administrateur requis.');
  const b=await lireJson(request);if(!/^[A-Za-z0-9._-]{1,64}$/.test(b.vehicleId||'')||b.vehicleId.startsWith('SV-')||!Number.isInteger(b.sellerId))fail(400,'Référence importée et compte vendeur requis.');
  if(!await q('SELECT user_id FROM seller_profiles WHERE user_id=?',b.sellerId).first())fail(400,'Le compte doit posséder un profil vendeur.');
  const item=(await catalogueComplet(request,env)).find(x=>x.lot.reference===b.vehicleId);if(!item)fail(404,'Annonce introuvable.');
  const rs=await env.DB.batch([
   q('INSERT OR IGNORE INTO vehicles(reference,data,removed,updated_at,updated_by) VALUES(?,?,?,?,?)',b.vehicleId,JSON.stringify(item.lot),item.removed?1:0,now(),user.id),
   q("INSERT INTO vehicle_offer_owners(vehicle_id,seller_id,assigned_by,assigned_at) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM vehicle_offers WHERE vehicle_id=? AND status IN ('pending','accepted')) ON CONFLICT(vehicle_id) DO UPDATE SET seller_id=excluded.seller_id,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at",b.vehicleId,b.sellerId,user.id,now(),b.vehicleId)
  ]);changed(rs[1]);await audit(env,user,'proposal.owner_assigned',b.vehicleId);return json({ok:true});
 }
 if(path==='/offers'){
  if(method==='GET'){
   const side=url.searchParams.get('side')||'buyer',offset=Number(url.searchParams.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)fail(400,'Page invalide.');
   if(!['buyer','seller','admin'].includes(side))fail(400,'Vue inconnue.');if(side==='admin'&&!caps.moderator)fail(403,'Accès de contrôle requis.');
   const rows=await q(`SELECT * FROM vehicle_offers WHERE ${side==='admin'?'1=1':side==='seller'?'seller_id=?':'buyer_id=?'} ORDER BY created_at DESC,id DESC LIMIT 100 OFFSET ?`,...(side==='admin'?[]:[user.id]),offset).all();
   if(side==='admin')await audit(env,user,'proposals.private_read','offers');return json({offers:rows.results.map(present),nextOffset:rows.results.length===100?offset+100:null});
  }
  if(method==='POST'){
   const gate=await q('INSERT INTO marketplace_api_attempts(user_id,at) SELECT ?,? WHERE (SELECT COUNT(*) FROM marketplace_api_attempts WHERE user_id=? AND at>?)<10',user.id,now(),user.id,new Date(Date.now()-60000).toISOString()).run();if(!gate.meta.changes)fail(429,'Trop de propositions rapprochées. Réessayez dans une minute.');
   const b=await lireJson(request);if(!/^[A-Za-z0-9._-]{1,64}$/.test(b.reference||'')||!moneyValid(b.amountMinor)||!['TND','EUR'].includes(b.currency))fail(400,'Montant positif entier en unités mineures et devise valide requis.');
   if(b.confirmIntent!==true||b.rulesVersion!==rules.version)fail(428,'Confirmez votre intention après lecture des conditions actuelles.');
   if(b.buyerMessage!=null&&(typeof b.buyerMessage!=='string'||b.buyerMessage.length>2000))fail(400,'Le message facultatif est limité à 2000 caractères.');
   const row=await offerVehicle(env,b.reference),seller=row?.submission_owner??row?.assigned_owner;
   if(!proposalActive(row)||row.proposal_accepted)fail(409,'Cette annonce ne reçoit pas de propositions actuellement.');
   if(seller===user.id)fail(403,'Vous ne pouvez pas proposer une offre pour votre propre véhicule.');
   const terms=reserveTerms(JSON.parse(row.data));if(!terms)fail(409,'Le prix de réserve public doit être renseigné par le vendeur.');
   if(b.currency!==terms.currency)fail(400,'La devise doit correspondre à celle de l’annonce.');
   if(b.amountMinor<terms.reserveMinor)fail(400,RESERVE_ERROR);
   const offerId=id(),date=now(),expiry=new Date(Date.now()+rules.offer_hours*3600000).toISOString();
   const inserted=await q(`INSERT INTO vehicle_offers(id,vehicle_id,submission_id,buyer_id,seller_id,amount_minor,currency,reserve_price_at_submission,buyer_message,expires_at,rules_version,rules_snapshot,intention_at,created_at,updated_at,actor_id)
    SELECT ?,v.reference,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM vehicles v
    WHERE v.reference=? AND v.removed=0 AND v.data=? AND v.updated_at=?
    AND ?=COALESCE((SELECT user_id FROM seller_submissions WHERE 'SV-'||id=v.reference),(SELECT seller_id FROM vehicle_offer_owners WHERE vehicle_id=v.reference))
    AND NOT EXISTS(SELECT 1 FROM marketplace_suspensions WHERE user_id IN (?,?))
    AND NOT EXISTS(SELECT 1 FROM vehicle_offers WHERE vehicle_id=v.reference AND status='accepted')
    AND NOT EXISTS(SELECT 1 FROM offers WHERE reference=v.reference AND status='accepted')
    AND (? IS NULL OR EXISTS(SELECT 1 FROM seller_submissions s JOIN seller_diagnostics d ON d.submission_id=s.id JOIN partner_garages g ON g.id=d.garage_id JOIN seller_financials f ON f.submission_id=s.id WHERE s.id=? AND s.stage='published' AND d.diagnostic_status='approved' AND d.valid_until>=date('now') AND g.active=1 AND g.valid_until>=date('now') AND f.availability='available' AND (f.available_from='' OR f.available_from<=date('now')) AND json_extract(s.data,'$.allowOffers')=1)) RETURNING id`,
    offerId,row.submission_id||null,user.id,seller,b.amountMinor,b.currency,terms.reserveMinor,(b.buyerMessage||'').trim(),expiry,rules.version,JSON.stringify({version:rules.version,withdrawalAllowed:!!rules.withdrawal_allowed,offerHours:rules.offer_hours}),date,date,date,user.id,b.reference,row.data,row.updated_at,seller,user.id,seller,row.submission_id||null,row.submission_id||null).first();
   if(!inserted)fail(409,'L’annonce a changé : rechargez son prix de réserve.');return json({id:offerId,status:'pending'},201);
  }
 }
 const match=path.match(/^\/offers\/([a-f0-9]{32})(?:\/(decision|withdraw|cancel|contract|confirm))?$/);
 if(match){
  const offer=await q('SELECT * FROM vehicle_offers WHERE id=?',match[1]).first();
  if(!offer||![offer.buyer_id,offer.seller_id].includes(user.id)&&!caps.moderator)fail(404,'Proposition introuvable.');
  if(method==='GET'&&!match[2]){if(![offer.buyer_id,offer.seller_id].includes(user.id))await audit(env,user,'proposal.private_read',offer.id);return json({offer:present(offer),events:(await q('SELECT * FROM offer_events WHERE offer_id=? ORDER BY id',offer.id).all()).results,transaction:await q('SELECT * FROM transactions WHERE offer_id=?',offer.id).first()});}
  if(method!=='POST'||![offer.buyer_id,offer.seller_id].includes(user.id))fail(403,'Action réservée aux parties.');
  if(['contract','confirm'].includes(match[2]))fail(410,'La confirmation contractuelle est hors périmètre du Lot 1.');
  const b=await lireJson(request);if(['amountMinor','currency','reservePrice','reservePriceMinor','sellerId','buyerId'].some(k=>Object.hasOwn(b,k)))fail(400,'Les données de la proposition sont immuables.');
  if(match[2]==='decision'){
   if(user.id!==offer.seller_id)fail(403,'Décision réservée au vendeur de ce véhicule.');
   if(!['accept','reject'].includes(b.decision)||!Number.isInteger(b.revision))fail(400,'Décision et révision requises.');
   if(b.decision==='reject'&&(typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>2000))fail(400,'Motif de refus requis.');
   if(b.decision==='accept'&&offer.reserve_price_at_submission===null)fail(409,'Une nouvelle proposition Lot 1 est nécessaire pour enregistrer sa réserve officielle.');
   const row=await offerVehicle(env,offer.vehicle_id);if(!proposalActive(row))fail(409,'Annonce inactive.');
   const terms=reserveTerms(JSON.parse(row.data));if(b.decision==='accept'&&(!terms||terms.currency!==offer.currency||offer.amount_minor<terms.reserveMinor))fail(409,'Le prix de réserve a changé. Une nouvelle proposition est nécessaire.');
   changed(await q(`UPDATE vehicle_offers SET status=?,actor_id=?,reason=?,revision=revision+1,updated_at=? WHERE id=? AND seller_id=? AND revision=? AND status='pending' AND expires_at>?
    AND EXISTS(SELECT 1 FROM vehicles WHERE reference=vehicle_offers.vehicle_id AND removed=0 AND data=? AND updated_at=?) AND NOT EXISTS(SELECT 1 FROM marketplace_suspensions WHERE user_id IN (buyer_id,seller_id))`,b.decision==='accept'?'accepted':'rejected',user.id,b.decision==='reject'?b.reason.trim():'',now(),offer.id,user.id,b.revision,now(),row.data,row.updated_at).run());return json({ok:true});
  }
  if(['withdraw','cancel'].includes(match[2])){
   if(user.id!==offer.buyer_id)fail(403,'Annulation réservée à l’acheteur.');
   if(!JSON.parse(offer.rules_snapshot).withdrawalAllowed)fail(409,'L’annulation doit être examinée selon les conditions de cette proposition.');
   changed(await q("UPDATE vehicle_offers SET status='cancelled',actor_id=?,reason='buyer_cancelled',revision=revision+1,updated_at=? WHERE id=? AND buyer_id=? AND status='pending'",user.id,now(),offer.id,user.id).run());return json({ok:true});
  }
 }
 fail(404,'Route de proposition inconnue.');
}
