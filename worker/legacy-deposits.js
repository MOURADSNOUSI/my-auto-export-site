// Conservation du registre des dépôts existants. Aucun nouveau paiement n'est créé dans le Lot 1.
import {ApiError,json} from './index.js';
async function crediterDepot(env, depositId, methode) {
  const [, clos] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET deposit_tnd = deposit_tnd + (SELECT amount_tnd FROM deposits WHERE id = ?1 AND status = 'pending' AND method = ?2)
       WHERE id = (SELECT user_id FROM deposits WHERE id = ?1 AND status = 'pending' AND method = ?2)`
    ).bind(depositId, methode),
    env.DB.prepare("UPDATE deposits SET status = 'paid', confirmed_at = ? WHERE id = ? AND status = 'pending' AND method = ?")
      .bind(new Date().toISOString(), depositId, methode)
  ]);
  return clos.meta.changes === 1;
}

async function signatureStripeValide(corps, entete, secret) {
  const parties = Object.fromEntries((entete || "").split(",").map((p) => p.trim().split("=")).filter((p) => p.length === 2));
  const horodatage = Number(parties.t);
  if (!Number.isFinite(horodatage) || Math.abs(Date.now() / 1000 - horodatage) > 300 || !/^[0-9a-f]{64}$/.test(parties.v1 || "")) return false;
  const cle = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const attendue = Uint8Array.from(parties.v1.match(/../g).map((o) => parseInt(o, 16)));
  return crypto.subtle.verify("HMAC", cle, attendue, new TextEncoder().encode(`${parties.t}.${corps}`));
}

export async function webhookStripe(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new ApiError(503, "Webhook non configuré.");
  const corps = await request.text();
  if (!(await signatureStripeValide(corps, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET))) {
    throw new ApiError(400, "Signature invalide.");
  }
  const evenement = JSON.parse(corps);
  const session = evenement.data?.object;
  if (session?.object === "checkout.session" && session.id) {
    const depot = await env.DB.prepare("SELECT id, amount_tnd, charge_amount, charge_currency, status FROM deposits WHERE stripe_session_id = ? AND method = 'card'").bind(session.id).first();
    if (depot && depot.status === "pending") {
      const paye = ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(evenement.type)
        && session.payment_status === "paid" && session.amount_total === depot.charge_amount && String(session.currency).toLowerCase() === depot.charge_currency;
      if (paye) await crediterDepot(env, depot.id, "card");
      else if (["checkout.session.expired", "checkout.session.async_payment_failed"].includes(evenement.type)) {
        await env.DB.prepare("UPDATE deposits SET status = 'cancelled' WHERE id = ? AND status = 'pending'").bind(depot.id).run();
      }
    }
  }
  return json({ received: true });
}
