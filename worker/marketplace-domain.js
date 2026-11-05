export const dateNow=()=>new Date().toISOString();
export const id=()=>crypto.randomUUID().replaceAll('-','');
export const EXPONENTS={TND:3,EUR:2};
export function toMinor(value,currency){
 if(!Object.hasOwn(EXPONENTS,currency)||typeof value!=='string')throw new Error('money');
 const n=EXPONENTS[currency],m=value.trim().match(new RegExp(`^(0|[1-9][0-9]{0,10})(?:[.,]([0-9]{1,${n}}))?$`));
 if(!m)throw new Error('money');
 const amount=BigInt(m[1])*10n**BigInt(n)+BigInt((m[2]||'').padEnd(n,'0'));
 if(amount>100000000000n)throw new Error('money');return Number(amount);
}
export function decimal(minor,currency){const n=EXPONENTS[currency];return `${Math.trunc(minor/10**n)}.${String(minor%10**n).padStart(n,'0')}`;}
export function moneyValid(v){return Number.isSafeInteger(v)&&v>0&&v<=100000000000;}
export async function capabilities(env,user){
 const rows=await env.DB.prepare('SELECT role FROM marketplace_roles WHERE user_id=?').bind(user.id).all();
 return {admin:user.role==='admin',moderator:user.role==='admin'||rows.results.some(r=>r.role==='moderator'),garage:rows.results.some(r=>r.role==='garage')};
}
export async function policy(env){return env.DB.prepare('SELECT * FROM marketplace_policy WHERE id=1').first();}
export async function audit(env,user,action,resource){await env.DB.prepare('INSERT INTO audit_logs(actor_id,action,resource_id,at) VALUES(?,?,?,?)').bind(user.id,action,resource,dateNow()).run();}
export async function expireOffers(env){
 await env.DB.prepare('DELETE FROM marketplace_api_attempts WHERE at<?').bind(new Date(Date.now()-86400000).toISOString()).run();
 await env.DB.prepare("UPDATE vehicle_offers SET status='expired',revision=revision+1,updated_at=?,actor_id=NULL,reason='deadline' WHERE status='pending' AND expires_at<=?").bind(dateNow(),dateNow()).run();
 await env.DB.prepare("UPDATE seller_diagnostics SET diagnostic_status='expired' WHERE diagnostic_status='approved' AND valid_until<date('now')").run();
}
export async function financial(env,submission){return env.DB.prepare('SELECT * FROM seller_financials WHERE submission_id=?').bind(submission).first();}
export async function diagnosticValid(env,submission){return env.DB.prepare("SELECT d.submission_id FROM seller_diagnostics d JOIN partner_garages g ON g.id=d.garage_id WHERE d.submission_id=? AND d.diagnostic_status='approved' AND d.valid_until>=date('now') AND g.active=1 AND g.valid_until>=date('now')").bind(submission).first();}
// Les valeurs privées ne passent jamais par le sérialiseur public.
export async function publicMarketplaceLot(env,row,lot){
 const f=await financial(env,row.id);if(!f||!await diagnosticValid(env,row.id))return null;
 return {...lot,status:'stock',indicativePriceTnd:undefined,startingPriceTnd:undefined,reservePriceTnd:undefined,endsAt:undefined,marketplace:true,priceMinor:f.asking_minor,currency:f.currency,availableFrom:f.available_from,availability:f.availability,deliveryTerms:f.delivery_terms};
}
