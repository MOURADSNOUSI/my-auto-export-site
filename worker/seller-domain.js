import {PHOTO_KINDS,REQUIRED_PHOTOS,FILE_LABELS,SYSTEMS,TECH_FIELDS,HISTORY_FIELDS,validDate,sanitizeExtra} from '../my-auto-export/seller-schema.js';
export {PHOTO_KINDS,FILE_LABELS,SYSTEMS,validDate};
export const COUNTRY_CODES = new Set('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' '));
export const EDITABLE=['draft','corrections','rejected'];
export const now=()=>new Date().toISOString();
export const uuid=()=>crypto.randomUUID().replaceAll('-','');
export const reference=id=>`SV-${id}`;
export const legacy=stage=>({submitted:'pending',reviewing:'pending',published:'approved',archived:'approved'}[stage]||stage);
export const text=(v,max=120)=>typeof v==='string'?v.trim().slice(0,max):'';
export function normalize(src,fail) {
 const data=sanitizeExtra(src,fail);
 for(const key of ['make','model','vin','licensePlate','firstRegistrationDate','location','originCountry','diagnosticDate']) data[key]=text(src[key]);
 data.vin=data.vin.toUpperCase();data.originCountry=data.originCountry.toUpperCase();data.firstRegistrationCountry=data.firstRegistrationCountry.toUpperCase();
 for(const key of ['year','mileageKm','priceTnd','garageId']) {
  data[key]=src[key]==null||src[key]===''?null:Number(src[key]);
  if(data[key]!==null && (!Number.isInteger(data[key]) || data[key]<0 || data[key]>100000000)) fail(400,`Nombre invalide : ${key}`);
 }
 data.saleType=text(src.saleType,20);if(data.saleType && !['sale','auction'].includes(data.saleType))fail(400,'Type de vente invalide.');
 data.observations=Object.fromEntries(Object.keys(SYSTEMS).map(key=>[key,text(src.observations?.[key],2000)]));
 return data;
}
export async function missing(env,row,files) {
 const d=JSON.parse(row.data), errors=[];
 const p=await env.DB.prepare('SELECT * FROM seller_profiles WHERE user_id=?').bind(row.user_id).first();
 if(!p?.name||!p.phone||!p.address)errors.push('Coordonnées du vendeur');
 if(p?.seller_type==='professional'&&!p.professional_number)errors.push('Numéro professionnel du vendeur');
 for(const [key,label] of Object.entries({make:'Marque',model:'Modèle',fuel:'Énergie',vin:'VIN',saleType:'Mode de vente',location:'Localisation',originCountry:'Pays d’origine'}))if(!d[key])errors.push(label);
 if(!Number.isInteger(d.year)||d.year<1950||d.year>new Date().getUTCFullYear()+1)errors.push('Année');
 if(!Number.isInteger(d.mileageKm)||d.mileageKm<0)errors.push('Kilométrage');
 if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(d.vin||''))errors.push('VIN de 17 caractères');
 if(!COUNTRY_CODES.has(d.originCountry))errors.push('Pays d’origine valide');
 if(d.firstRegistrationCountry&&!COUNTRY_CODES.has(d.firstRegistrationCountry))errors.push('Pays de première immatriculation valide');
 if(d.firstRegistrationDate&&!validDate(d.firstRegistrationDate,true))errors.push('Date de première immatriculation valide et non future');
 const price=d.priceAmount ?? d.priceTnd;
 if(!Number.isFinite(price)||price<=0)errors.push('Prix demandé / de départ');
 if(d.saleType==='auction'){
  if(!d.auctionStart||!d.auctionEnd||!Number.isFinite(Date.parse(d.auctionStart))||!Number.isFinite(Date.parse(d.auctionEnd))||Date.parse(d.auctionEnd)<=Date.parse(d.auctionStart)) errors.push('Dates souhaitées de début et de fin des enchères');
 }
 const g=await env.DB.prepare('SELECT * FROM partner_garages WHERE id=? AND active=1 AND valid_until>=?').bind(d.garageId||0,now().slice(0,10)).first();
 if(!g?.professional_number)errors.push('Garage agréé actif, numéro professionnel et agrément non expiré');
 if(!validDate(d.diagnosticDate||'',true))errors.push('Date du diagnostic valide et non future');
 if(!d.diagnosticReference)errors.push('Référence du diagnostic');
 if(!d.diagnosticVin||d.diagnosticVin!==d.vin)errors.push('Le VIN déclaré du rapport doit correspondre au VIN du véhicule (confirmation humaine obligatoire)');
 if(!Number.isInteger(d.diagnosticMileageKm)||d.diagnosticMileageKm<0)errors.push('Kilométrage relevé au diagnostic');
 for(const [key,label]of Object.entries(SYSTEMS))if(!d.observations?.[key])errors.push(`Diagnostic : ${label}`);
 const photos=files.filter(f=>PHOTO_KINDS.includes(f.kind));
 if(photos.length<8)errors.push('Au moins 8 photos du véhicule');
 for(const kind of REQUIRED_PHOTOS)if(!photos.some(f=>f.kind===kind))errors.push(`Photo : ${FILE_LABELS[kind]}`);
 const required=['registration','ownership','diagnostic'];
 // Règle déclarative explicite : aucune règle juridique nationale n'est déduite automatiquement.
 if(d.roadworthinessApplicable==='Oui')required.push('roadworthiness');
 if(p?.seller_type==='professional')required.push('invoice');
 const rules=await env.DB.prepare("SELECT kind FROM seller_document_rules WHERE required=1 AND country_code IN ('*',?) AND seller_type IN ('*',?)").bind(d.firstRegistrationCountry||d.originCountry||'',p?.seller_type||'individual').all();
 required.push(...rules.results.map(r=>r.kind));
 for(const kind of new Set(required))if(!files.some(f=>f.kind===kind))errors.push(`Pièce : ${FILE_LABELS[kind]}`);
 for(const damage of d.damages||[]){
  if(!damage.description||!damage.photoIds.length||damage.photoIds.some(id=>!photos.some(f=>f.id===id)))errors.push('Chaque dommage doit être décrit et associé à une photo de ce dossier');
 }
 return errors;
}
export async function publicLot(env,row,files,priceTnd) {
 const d=JSON.parse(row.data),g=await env.DB.prepare('SELECT name FROM partner_garages WHERE id=?').bind(d.garageId).first();
 const price=d.priceCurrency==='EUR'?priceTnd:(d.priceAmount??d.priceTnd);
 if(!Number.isFinite(price)||price<=0||price>100000000)throw new Error('publication-price');
 const photos=files.filter(f=>PHOTO_KINDS.includes(f.kind)).sort((a,b)=>b.is_primary-a.is_primary||a.position-b.position||a.created_at.localeCompare(b.created_at));
 const lot={reference:reference(row.id),make:d.make,model:d.model,year:d.year,mileageKm:d.mileageKm,fuel:d.fuel,
  status:d.saleType==='auction'?'upcoming':'stock',indicativePriceTnd:price,createdAt:now(),
  photos:photos.map(f=>({url:`/seller-media/${f.id}`,authorized:true})),equipment:d.equipment||[],description:d.description||'',allowSellerOffers:d.saleType==='sale'&&d.allowOffers===true,
  diagnostic:{garage:g.name,date:d.diagnosticDate,summary:row.public_summary,notice:'Le diagnostic de garage ne remplace pas les obligations légales de contrôle technique et ne garantit pas l’absence de défaut.'},
  damages:(d.damages||[]).map(x=>({zone:x.zone,type:x.type,severity:x.severity,description:x.description,photos:x.photoIds.map(id=>`/seller-media/${id}`)}))
 };
 if(d.trim)lot.trim=d.trim;if(d.bodyType)lot.bodyType=d.bodyType;
 if(d.gearbox)lot.transmission=d.gearbox;if(d.exteriorColor)lot.color=d.exteriorColor;
 for(const [source,target] of [['powerHp','powerHp'],['displacementCc','engineCc'],['doors','doors'],['seats','seats']])if(Number.isFinite(d[source])&&d[source]>0)lot[target]=d[source];
 if(d.condition)lot.condition={'Neuf':'new','Occasion':'used','Accidenté':'accident','Endommagé':'damaged'}[d.condition];
 lot.specs=[...TECH_FIELDS,...HISTORY_FIELDS.filter(f=>['mechanicalCondition','runningCondition','knownAccidents','majorRepairs','serviceHistory'].includes(f[0]))].filter(([k])=>d[k]!==null&&d[k]!==undefined&&d[k]!=='').map(([k,l])=>k==='powerKw'?['Puissance',`${d[k]} kW`]:[l,String(d[k])]);
 if(d.saleType==='auction'){lot.startingPriceTnd=price;if(d.reservePriceTnd)lot.reservePriceTnd=d.reservePriceTnd;lot.endsAt=d.auctionEnd;}
 const visible=JSON.stringify(lot).toUpperCase();
 if([d.vin,d.licensePlate].filter(v=>v&&v.length>=4).some(v=>visible.includes(v.toUpperCase())))throw new Error('private-identifiers');
 return lot;
}
export async function drainDeletions(env) {
 if(!env.SELLER_DOCUMENTS)return 0;
 const {results}=await env.DB.prepare('SELECT storage_key FROM seller_file_deletions LIMIT 50').all();
 const outcomes=await Promise.allSettled(results.map(r=>env.SELLER_DOCUMENTS.delete(r.storage_key)));
 const deleted=results.filter((r,i)=>outcomes[i].status==='fulfilled').map(r=>r.storage_key);
 if(deleted.length)await env.DB.prepare(`DELETE FROM seller_file_deletions WHERE storage_key IN (${deleted.map(()=>'?').join(',')})`).bind(...deleted).run();
 return deleted.length;
}
export async function purgeSeller(env,days=180) {
 const retention=Number.isFinite(Number(days))?Math.max(30,Number(days)):180;
 const cutoff=new Date(Date.now()-retention*86400000).toISOString();
 const {results}=await env.DB.prepare("SELECT id FROM seller_submissions WHERE stage IN ('draft','rejected','archived') AND updated_at<? AND purged_at IS NULL LIMIT 20").bind(cutoff).all();
 await env.DB.prepare('DELETE FROM seller_upload_attempts WHERE at<?').bind(new Date(Date.now()-86400000).toISOString()).run();
 await env.DB.prepare('DELETE FROM seller_file_access WHERE expires_at<?').bind(now()).run();
 for(const {id} of results){
  // Un changement concurrent de statut protège les pièces contre une purge pendant la soumission.
  const token=uuid();
  await env.DB.batch([
   env.DB.prepare("UPDATE seller_submissions SET mutation_token=?,mutation_actor=NULL,stage='archived',status='approved',purged_at=?,data='{}',feedback='',public_summary='',updated_at=?,revision=revision+1 WHERE id=? AND updated_at<? AND stage IN ('draft','rejected','archived') AND purged_at IS NULL").bind(token,now(),now(),id,cutoff),
   env.DB.prepare("UPDATE seller_validation_events SET message='',actor_id=NULL WHERE submission_id=? AND EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)").bind(id,id,token),
   ...['seller_files','seller_diagnostics','seller_damages','seller_vin_claims'].map(table=>env.DB.prepare(`DELETE FROM ${table} WHERE submission_id=? AND EXISTS(SELECT 1 FROM seller_submissions WHERE id=? AND mutation_token=?)`).bind(id,id,token)),
  ]);
 }
 return drainDeletions(env);
}
