import {toMinor,moneyValid,dateNow} from './marketplace-domain.js';
export const RESERVE_ERROR='Votre offre doit être supérieure ou égale au prix de réserve de ce véhicule.';
// Enchères, achat immédiat et dépôts de garantie actifs sauf si LEGACY_AUCTIONS_ENABLED vaut explicitement "false"
// (mode « propositions seules » du Lot 1). Variable absente : enchères actives, comme en production.
export const legacyAuctionsEnabled=env=>String(env.LEGACY_AUCTIONS_ENABLED??'true').trim().toLowerCase()!=='false';
export const freeOffersEnabled=env=>String(env.FREE_OFFERS_ENABLED??'false').trim().toLowerCase()==='true';
// Pas de repli vers le minimum privé, le prix demandé ou une conversion monétaire.
export function reserveTerms(lot){
 const currency=lot.currency||lot.priceCurrency||'TND';if(!['TND','EUR'].includes(currency))return null;
 let reserveMinor;
 try{
  if(lot.reservePriceTnd!=null){
   if(currency!=='TND'||lot.reservePriceMinor!=null)return null;
   if(typeof lot.reservePriceTnd==='number'&&!Number.isSafeInteger(lot.reservePriceTnd))return null;
   reserveMinor=toMinor(String(lot.reservePriceTnd),'TND');
  }else reserveMinor=lot.reservePriceMinor;
 }catch{return null;}
 return moneyValid(reserveMinor)?{currency,reserveMinor}:null;
}
export async function offerVehicle(env,reference){
 return env.DB.prepare(`SELECT v.*,s.id AS submission_id,s.user_id AS submission_owner,s.stage,
  s.diagnostic_verified_at,f.availability,f.available_from,json_extract(s.data,'$.allowOffers') AS allow_offers,
  ow.seller_id AS assigned_owner,
  EXISTS(SELECT 1 FROM marketplace_suspensions x WHERE x.user_id=COALESCE(s.user_id,ow.seller_id)) AS owner_suspended,
  EXISTS(SELECT 1 FROM offers WHERE reference=v.reference AND status='accepted') AS legacy_sold,
  EXISTS(SELECT 1 FROM vehicle_offers WHERE vehicle_id=v.reference AND status='accepted') AS proposal_accepted,
  EXISTS(SELECT 1 FROM seller_diagnostics d JOIN partner_garages g ON g.id=d.garage_id WHERE d.submission_id=s.id AND d.diagnostic_status='approved' AND d.valid_until>=date('now') AND g.active=1 AND g.valid_until>=date('now')) AS diagnostic_valid
  FROM vehicles v LEFT JOIN seller_submissions s ON v.reference='SV-'||s.id
  LEFT JOIN seller_financials f ON f.submission_id=s.id
  LEFT JOIN vehicle_offer_owners ow ON ow.vehicle_id=v.reference WHERE v.reference=?`).bind(reference).first();
}
export function proposalActive(row,free=false){
 if(!row||row.removed||row.legacy_sold||row.owner_suspended)return false;
 if(row.submission_id)return row.stage==='published'&&row.diagnostic_verified_at&&row.diagnostic_valid&&row.availability==='available'&&(!row.available_from||row.available_from<=dateNow().slice(0,10))&&row.allow_offers===1;
 return (free||!!row.assigned_owner)&&!['archived','sold','inactive'].includes(JSON.parse(row.data).status);
}
export async function expireProposals(env){
 await env.DB.prepare("UPDATE vehicle_offers SET status='expired',revision=revision+1,updated_at=?,actor_id=NULL,reason='deadline' WHERE status='pending' AND expires_at<=?").bind(dateNow(),dateNow()).run();
}
export function lot1Public(lot){
 const result={...lot,proposalMode:true,status:'stock'};
 for(const key of ['auction','endsAt','auctionStart','auctionEnd','startingPriceTnd','bidIncrementTnd','buyNowPriceTnd'])delete result[key];
 // Conserver le prix et les données existants ; la mise à prix devient seulement un prix indicatif.
 if(lot.indicativePriceTnd==null&&lot.startingPriceTnd!=null)result.indicativePriceTnd=lot.startingPriceTnd;
 const terms=reserveTerms(lot);if(terms){result.publicReserveMinor=terms.reserveMinor;result.currency=terms.currency;}
 return result;
}
