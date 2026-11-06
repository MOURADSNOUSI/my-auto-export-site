// Page /admin-prix : paramètres des prix estimés, taux, régimes, grille, éligibilité et simulation (worker/prix.js).
// Toutes les données affichées passent par echapper().
const $ = (id) => document.getElementById(id);
const CARBURANTS = { essence: "Essence", diesel: "Diesel", hybride: "Hybride", hybride_rechargeable: "Hybride rechargeable", electrique: "Électrique", "*": "Autres" };
const CHAMPS_GRILLE = [
  ["cylindree_min", "Cylindrée min"], ["cylindree_max", "Cylindrée max"], ["droits_douane_pct", "DD %"], ["droit_consommation_pct", "DC %"],
  ["tva_pct", "TVA %"], ["reduction_immatriculation_pct", "Réduc. immat. %"], ["part_payee_pct", "Part payée %"]
];

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

const nombreOuNull = (valeur) => (valeur === "" ? null : Number(valeur));
const dateHeure = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");

function afficher(etat) {
  $("bandeau").hidden = !etat.aVerifier;
  $("prix-publics").textContent = etat.prixPublicsActifs
    ? "Prix publics : activés (réglage prix_publics_actifs)."
    : "Prix publics : désactivés (réglage prix_publics_actifs). Aucun prix calculé n'est montré au public.";
  const valeurs = Object.fromEntries(etat.parametres.map((p) => [p.cle, p.valeur]));
  $("taux-auto").innerHTML = valeurs.taux_auto
    ? `Taux automatique : <strong>${echapper(valeurs.taux_auto)}</strong> TND pour 1 € · ${echapper(valeurs.taux_auto_source)} · ${echapper(dateHeure(valeurs.taux_auto_date))}`
    : "Taux automatique : aucune mise à jour réussie pour l'instant.";
  $("taux-applique").innerHTML = etat.taux
    ? `Taux appliqué : <strong>${echapper(etat.taux.valeur.toFixed(4))}</strong> (${etat.taux.manuel ? "manuel" : "automatique"} ${echapper(etat.taux.base)} + marge ${echapper(etat.taux.margePct)} %)`
    : "<strong>Aucun taux : aucun prix ne peut être calculé.</strong>";
  $("form-taux").valeur.value = valeurs.taux_manuel || "";
  $("form-taux").actif.checked = valeurs.taux_manuel_actif === "true";
  $("source-bct").href = etat.sourcesTaux.principale;
  $("source-bct").textContent = etat.sourcesTaux.principale;

  $("parametres").innerHTML = etat.parametres.filter((p) => !p.cle.startsWith("taux_")).map((p) => `<li>
    <form class="champs" data-parametre="${echapper(p.cle)}">
      <label>${echapper(p.cle)} (${echapper(p.unite)})<input name="valeur" type="number" step="any" min="0" value="${echapper(p.valeur)}" required></label>
      <button class="button small" type="submit">Enregistrer</button>
      <span class="note large">${echapper(p.note)} · modifié le ${echapper(dateHeure(p.misAJour))}</span>
    </form></li>`).join("");

  $("regimes").innerHTML = etat.regimes.map((r) => `<li>
    <strong>${echapper(r.libelle)}</strong> <span class="badge${r.statut_verification === "verifie" ? " ok" : ""}">${r.statut_verification === "verifie" ? "Vérifié" : "À vérifier"}</span>
    <span class="note">(${echapper(r.code)}, ${r.public === "tre" ? "TRE" : "résident"})</span>
    <form class="champs" data-regime="${echapper(r.code)}">
      <label class="case"><input name="actif" type="checkbox"${r.actif ? " checked" : ""}> Actif</label>
      <label>Statut<select name="statut_verification">
        <option value="a_verifier"${r.statut_verification === "a_verifier" ? " selected" : ""}>À vérifier</option>
        <option value="verifie"${r.statut_verification === "verifie" ? " selected" : ""}>Vérifié par le transitaire</option></select></label>
      <button class="button small" type="submit">Enregistrer</button>
    </form>
    <p class="note">${echapper(r.note)}</p>${r.source ? `<p class="note">Sources : ${echapper(r.source)}</p>` : ""}</li>`).join("");

  const parRegime = new Map();
  for (const ligne of etat.grille) parRegime.set(ligne.regime, [...(parRegime.get(ligne.regime) || []), ligne]);
  $("grille").innerHTML = [...parRegime].map(([regime, lignes]) => `<details><summary>${echapper(regime)} (${lignes.length})</summary>
    <ul class="liste">${lignes.map((l) => `<li><form class="champs" data-grille="${echapper(l.id)}">
      <strong class="large">${echapper(CARBURANTS[l.carburant] || l.carburant)}</strong>
      ${CHAMPS_GRILLE.map(([cle, nom]) => `<label>${nom}<input name="${cle}" type="number" step="any" min="0" value="${echapper(l[cle])}"${cle === "cylindree_max" ? "" : " required"}></label>`).join("")}
      <label class="large">Note (source, À VÉRIFIER)<textarea name="note" maxlength="1000" required>${echapper(l.note)}</textarea></label>
      <button class="button small" type="submit">Enregistrer la ligne</button>
    </form></li>`).join("")}</ul></details>`).join("");

  $("eligibilite").innerHTML = [["resident", "Résident"], ["fcr", "TRE (FCR)"]].map(([cle, nom]) => {
    const r = etat.eligibilite[cle] || {};
    return `<form class="champs card" data-eligibilite="${cle}">
      <strong class="large">${nom}</strong>
      <label>Âge max (ans)<input name="age_max_ans" type="number" min="0" max="50" step="1" value="${echapper(r.age_max_ans)}" required></label>
      <label>Cylindrée max (cm³, vide = sans)<input name="cylindree_max_cc" type="number" min="1" max="20000" step="1" value="${echapper(r.cylindree_max_cc)}"></label>
      ${Object.entries(CARBURANTS).filter(([c]) => c !== "*").map(([c, libelle]) => `<label class="case"><input type="checkbox" name="carburants" value="${c}"${(r.carburants_admis || []).includes(c) ? " checked" : ""}> ${libelle}</label>`).join("")}
      <label class="large">Note<textarea name="note" maxlength="1000" required>${echapper(r.note)}</textarea></label>
      <button class="button small" type="submit">Enregistrer</button></form>`;
  }).join("");
}

function afficherResultat(r) {
  const prix = (valeur, devise, motif) => (valeur === null ? `<span class="note">${echapper(motif || "—")}</span>` : `<strong>${echapper(valeur.toLocaleString("fr-FR"))} ${devise}</strong>`);
  $("resultat").innerHTML = `
    <div class="resultats">
      <div>Résident${r.regimeResident ? ` (${echapper(r.regimeResident)})` : ""}${prix(r.prixResidentTnd, "TND", r.motifNonEligibleResident)}</div>
      <div>TRE, prix en Europe${prix(r.prixTreEur, "EUR", r.motifNonEligibleResident)}</div>
      <div>TRE, dédouanement FCR estimé${prix(r.dedouanementFcrEstimeTnd, "TND", r.motifNonEligibleFcr)}</div>
    </div>
    <p class="note">Taux : ${r.taux.valeur ? echapper(r.taux.valeur.toFixed(4)) : "aucun"}${r.taux.manuel ? " (manuel)" : r.taux.source ? ` (${echapper(r.taux.source)}, ${echapper(dateHeure(r.taux.date))})` : ""}</p>
    <ul>${r.avertissements.map((a) => `<li class="note">${echapper(a)}</li>`).join("")}</ul>
    <table><tbody>${r.detail.map((d) => `<tr><td>${echapper(d.libelle)}${d.note ? `<br><span class="note">${echapper(d.note)}</span>` : ""}</td>
      <td class="montant">${echapper(d.montant.toLocaleString("fr-FR"))} ${echapper(d.devise)}</td></tr>`).join("")}</tbody></table>`;
}

async function enregistrer(chemin, body, texte) {
  try {
    afficher(await api(chemin, { method: "PUT", body }));
    message(texte);
  } catch (error) {
    message(error.message, false);
  }
}

document.addEventListener("submit", async (event) => {
  const form = event.target;
  event.preventDefault();
  if (form.id === "form-taux") {
    return enregistrer("/api/admin/prix/taux-manuel", { valeur: nombreOuNull(form.valeur.value), actif: form.actif.checked }, "Taux manuel enregistré.");
  }
  if (form.dataset.parametre) {
    return enregistrer(`/api/admin/prix/parametres/${encodeURIComponent(form.dataset.parametre)}`, { valeur: Number(form.valeur.value) }, `${form.dataset.parametre} enregistré.`);
  }
  if (form.dataset.regime) {
    return enregistrer(`/api/admin/prix/regimes/${encodeURIComponent(form.dataset.regime)}`,
      { actif: form.actif.checked, statut_verification: form.statut_verification.value }, "Régime enregistré.");
  }
  if (form.dataset.grille) {
    const body = { note: form.note.value };
    for (const [cle] of CHAMPS_GRILLE) body[cle] = nombreOuNull(form[cle].value);
    return enregistrer(`/api/admin/prix/grille/${encodeURIComponent(form.dataset.grille)}`, body, "Ligne de grille enregistrée.");
  }
  if (form.dataset.eligibilite) {
    return enregistrer(`/api/admin/prix/eligibilite/${encodeURIComponent(form.dataset.eligibilite)}`, {
      age_max_ans: Number(form.age_max_ans.value), cylindree_max_cc: nombreOuNull(form.cylindree_max_cc.value),
      carburants_admis: [...form.querySelectorAll("[name=carburants]:checked")].map((c) => c.value), note: form.note.value
    }, "Règles d'éligibilité enregistrées.");
  }
  if (form.id === "form-simulation") {
    try {
      afficherResultat(await api("/api/admin/prix/simulation", { method: "POST", body: {
        prixEur: Number(form.prixEur.value), transportEur: nombreOuNull(form.transportEur.value), year: nombreOuNull(form.year.value),
        premiereImmatriculation: form.premiereImmatriculation.value || null, engineCc: nombreOuNull(form.engineCc.value), fuel: form.fuel.value
      } }));
      $("erreur").hidden = true;
    } catch (error) {
      message(error.message, false);
    }
  }
});

async function demarrer() {
  try {
    const { user } = await (await fetch("/api/me", { credentials: "same-origin" })).json();
    if (!user || user.role !== "admin") {
      $("chargement").innerHTML = 'Accès réservé aux administrateurs : <a href="/admin">se connecter depuis l\'administration</a>.';
      return;
    }
    afficher(await api("/api/admin/prix"));
    $("chargement").hidden = true;
    $("contenu").hidden = false;
  } catch (error) {
    $("chargement").textContent = error.message || "Serveur indisponible.";
  }
}
demarrer();
