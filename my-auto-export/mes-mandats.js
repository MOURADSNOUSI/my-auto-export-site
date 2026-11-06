// Suivi des demandes d'achat sur mandat du client connecté (chantier 4). Textes servis par /api/mandats.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Parcours affiché : les étapes normales, puis l'issue finale si elle sort du parcours (non obtenu, annulée).
const PARCOURS = ["demande", "eligibilite_verifiee", "acompte_recu", "achat_en_cours", "achete", "livre"];
const montant = (n, devise) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: devise, maximumFractionDigits: 0 }).format(n);
const $ = (id) => document.getElementById(id);

async function api(chemin, method = "GET") {
  const r = await fetch(chemin, { method, headers: method === "GET" ? {} : { "Content-Type": "application/json" }, body: method === "GET" ? undefined : "{}" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || "Service momentanément indisponible."), { status: r.status });
  return data;
}

function etapes(m, L) {
  const derniere = PARCOURS.includes(m.statut) ? PARCOURS.indexOf(m.statut) : PARCOURS.indexOf(m.evenements.at(-1)?.de ?? "demande");
  const liste = PARCOURS.map((s, i) => `<li class="${s === m.statut ? "actuel" : i < derniere ? "fait" : ""}">${esc(L[`statut_${s}`])}</li>`);
  if (!PARCOURS.includes(m.statut)) liste.push(`<li class="actuel">${esc(L[`statut_${m.statut}`])}</li>`);
  return `<ol class="etapes">${liste.join("")}</ol>`;
}

async function charger() {
  let data;
  try {
    data = await api("/api/mandats");
  } catch (e) {
    $("titre").textContent = "M&Y AUTO EXPORT";
    $("erreur").textContent = e.message;
    return;
  }
  const L = data.libelles;
  $("titre").textContent = L.mandat_mes_titre;
  $("liste").innerHTML = data.mandats.length ? data.mandats.map((m) => `<article class="mandat">
      <h2>${esc(m.titre)}</h2>
      <p>${esc(L.mandat_reference)} ${esc(m.reference)} · ${esc(L.mandat_prix_max_court)} : ${esc(montant(m.prixMax, m.devise))}${m.acompte ? ` · ${esc(L.mandat_acompte)} : ${esc(montant(m.acompte, m.devise))}` : ""}</p>
      ${etapes(m, L)}
      ${m.annulable ? `<button type="button" data-annuler="${m.id}">${esc(L.mandat_annuler)}</button>` : ""}
    </article>`).join("") : `<p>${esc(L.mandat_mes_vide)}</p>`;
  for (const bouton of document.querySelectorAll("[data-annuler]")) {
    bouton.onclick = async () => {
      if (!confirm(L.mandat_annuler_confirmer)) return;
      bouton.disabled = true;
      try {
        await api(`/api/mandats/${bouton.dataset.annuler}/annuler`, "POST");
        await charger();
      } catch (e) {
        $("erreur").textContent = e.message;
        bouton.disabled = false;
      }
    };
  }
}

charger();
