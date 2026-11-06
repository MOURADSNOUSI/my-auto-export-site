// Page /admin-mandats : demandes d'achat sur mandat (statut, acompte, note) et textes du mandat (worker/mandats.js).
// Toutes les données affichées passent par echapper() : noms, téléphones et réponses sont saisis par les clients.
const $ = (id) => document.getElementById(id);
const TEXTES = ["texte_mandat", "cgv_mandat", "conditions_acompte"];
const ACOMPTES = ["acompte_defaut_tnd", "acompte_defaut_eur"];
let libellesStatut = {};

function echapper(valeur) {
  return String(valeur ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
}

async function api(chemin, { method = "GET", body } = {}) {
  const reponse = await fetch(chemin, {
    method, credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  if (!(reponse.headers.get("Content-Type") || "").includes("application/json")) throw new Error("Serveur indisponible. Réessaie dans un instant.");
  const data = await reponse.json();
  if (!reponse.ok) throw new Error(data.error || "Erreur inattendue.");
  return data;
}

function message(texte, ok = true) {
  $("succes").hidden = !ok;
  $("erreur").hidden = ok;
  $(ok ? "succes" : "erreur").textContent = texte;
}

const dateHeure = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");
const montant = (n, devise) => (n ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: devise, maximumFractionDigits: 0 }).format(n) : "—");

function carte(m) {
  const reponses = m.public === "tre"
    ? `Pays : ${echapper(m.reponses.paysResidence)} · FCR déjà utilisé (10 ans) : ${m.reponses.fcrDejaUtilise ? "oui" : "non"}`
    : "Résident en Tunisie";
  const acompteModifiable = ["demande", "eligibilite_verifiee"].includes(m.statut);
  return `<article class="card mandat" data-id="${m.id}">
    <h3>N° ${m.id} · ${echapper(m.titre)} <span class="statut">${echapper(libellesStatut[m.statut] || m.statut)}</span></h3>
    <p>Réf. ${echapper(m.reference)} · ${echapper(m.client.nom)} · ${echapper(m.client.email)} · ${echapper(m.telephone)}</p>
    <p>${reponses} · Prix maximum : <strong>${echapper(montant(m.prixMax, m.devise))}</strong> · Acompte : ${echapper(montant(m.acompte, m.devise))}</p>
    ${m.eligibiliteAuto ? `<p class="motif">Éligibilité calculée : ${echapper(m.eligibiliteAuto)}</p>` : ""}
    <p class="note">Demande du ${dateHeure(m.creeLe)} · ${m.evenements.map((e) => `${echapper(libellesStatut[e.vers] || e.vers)} (${echapper(e.acteur)}, ${dateHeure(e.le)})`).join(" → ")}</p>
    <form class="champs" data-form="${m.id}">
      ${acompteModifiable ? `<label>Acompte (${echapper(m.devise)})<input name="acompte" type="number" min="1" step="1" value="${m.acompte ?? ""}" placeholder="par défaut"></label>` : ""}
      <label class="large">Note interne<textarea name="note" maxlength="2000">${echapper(m.noteAdmin)}</textarea></label>
      <button class="button" type="submit">Enregistrer</button>
    </form>
    <div class="actions-mandat">${m.suivants.map((s) => `<button class="button${s === "annule" ? "" : " primary"}" type="button" data-statut="${s}">→ ${echapper(libellesStatut[s] || s)}</button>`).join("")}</div>
  </article>`;
}

async function chargerMandats() {
  const filtre = $("filtre").value;
  const { mandats, statuts } = await api(`/api/admin/mandats${filtre ? `?statut=${encodeURIComponent(filtre)}` : ""}`);
  libellesStatut = Object.fromEntries(statuts.map((s) => [s.code, s.libelle]));
  if ($("filtre").options.length === 1) $("filtre").insertAdjacentHTML("beforeend", statuts.map((s) => `<option value="${s.code}">${echapper(s.libelle)}</option>`).join(""));
  $("mandats").innerHTML = mandats.length ? mandats.map(carte).join("") : "<p>Aucune demande.</p>";
}

async function chargerTextes() {
  const { reglages } = await api("/api/admin/site");
  const valeurs = Object.fromEntries(reglages.map((r) => [r.cle, r.valeur]));
  const form = $("form-textes");
  for (const cle of [...TEXTES, ...ACOMPTES]) form.elements[cle].value = valeurs[cle] ?? "";
  $("mandats-actifs").checked = valeurs.mandats_actifs === true;
}

$("mandats-actifs").addEventListener("change", async (event) => {
  const caseACocher = event.currentTarget;
  if (caseACocher.checked && !confirm("Ouvrir les demandes de mandat au public ? Les textes doivent avoir été relus par un juriste.")) {
    caseACocher.checked = false;
    return;
  }
  caseACocher.disabled = true;
  try {
    await api("/api/admin/site/mandats_actifs", { method: "PUT", body: { valeur: caseACocher.checked } });
    message(caseACocher.checked ? "Demandes de mandat ouvertes au public." : "Demandes de mandat fermées.");
  } catch (error) {
    caseACocher.checked = !caseACocher.checked;
    message(error.message, false);
  }
  caseACocher.disabled = false;
});

async function modifier(id, corps) {
  await api(`/api/admin/mandats/${id}`, { method: "PUT", body: corps });
  message(`Mandat n° ${id} enregistré.`);
  await chargerMandats();
}

$("mandats").addEventListener("click", async (event) => {
  const bouton = event.target.closest("[data-statut]");
  if (!bouton) return;
  const id = Number(bouton.closest("[data-id]").dataset.id);
  const statut = bouton.dataset.statut;
  if (!confirm(`Passer le mandat n° ${id} à « ${libellesStatut[statut]} » ?`)) return;
  bouton.disabled = true;
  try {
    const acompte = bouton.closest("[data-id]").querySelector("[name=acompte]")?.value;
    await modifier(id, { statut, ...(acompte ? { acompte: Number(acompte) } : {}) });
  } catch (error) {
    message(error.message, false);
    bouton.disabled = false;
  }
});

$("mandats").addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  try {
    await modifier(Number(form.dataset.form), { note: form.elements.note.value, ...(form.elements.acompte?.value ? { acompte: Number(form.elements.acompte.value) } : {}) });
  } catch (error) {
    message(error.message, false);
  }
});

$("filtre").addEventListener("change", () => chargerMandats().catch((error) => message(error.message, false)));

$("form-textes").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    for (const cle of TEXTES) await api(`/api/admin/site/${cle}`, { method: "PUT", body: { valeur: form.elements[cle].value } });
    for (const cle of ACOMPTES) await api(`/api/admin/site/${cle}`, { method: "PUT", body: { valeur: Number(form.elements[cle].value || 0) } });
    message("Textes et acomptes enregistrés.");
    await chargerTextes();
  } catch (error) {
    message(error.message, false);
  }
});

(async () => {
  try {
    await Promise.all([chargerMandats(), chargerTextes()]);
    $("chargement").hidden = true;
    $("contenu").hidden = false;
  } catch (error) {
    $("chargement").hidden = true;
    message(error.message, false);
  }
})();
