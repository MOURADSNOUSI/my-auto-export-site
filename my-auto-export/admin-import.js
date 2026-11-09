// Page /admin-import : recherche d'annonces OpenLane (via TheCarApi) et import en brouillon (worker/import-openlane.js).
// Les textes et adresses viennent d'un tiers : tout passe par echapper(), les liens et photos sont en https seulement.
const $ = (id) => document.getElementById(id);
let annonces = [];

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

const https = (adresse) => (typeof adresse === "string" && /^https:\/\//.test(adresse) ? adresse : "");
const euros = (n) => (Number.isFinite(n) ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n) : "Prix non communiqué");
const dateHeure = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Tunis" }) : "—");

function carte(a, index) {
  const titre = a.titre || [a.marque, a.modele].filter(Boolean).join(" ") || "Annonce sans titre";
  const infos = [a.annee, Number.isFinite(a.km) ? `${new Intl.NumberFormat("fr-FR").format(a.km)} km` : null, a.carburant, a.boite, a.cylindree ? `${a.cylindree} cm³` : null].filter(Boolean);
  const photo = https(a.photos?.[0] || a.image);
  const importable = a.reference && a.marque && a.modele && !a.dejaImporte;
  return `<li class="annonce">
    ${photo ? `<img src="${echapper(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}
    <h3>${echapper(titre)}</h3>
    <p>${echapper(infos.join(" · "))}</p>
    <p><strong>${echapper(euros(a.prixEur))}</strong>${a.prixAchatImmediatEur ? " (prix d'achat immédiat OpenLane, hors TVA et frais)" : ""} · fin de l'enchère : ${echapper(dateHeure(a.finEnchere))}</p>
    <p>Réf. future : ${echapper(a.reference || "—")}${https(a.lien) ? ` · <a href="${echapper(https(a.lien))}" target="_blank" rel="noopener noreferrer">Annonce OpenLane ↗</a>` : ""}</p>
    ${a.dejaImporte ? "<p><strong>Déjà importée</strong></p>" : importable ? `<button class="button primary" type="button" data-importer="${index}">Importer en brouillon</button>` : "<p>Marque ou modèle manquant : import impossible.</p>"}
  </li>`;
}

// Préfiltre de l'administration (réglage import_openlane_filtres).
async function chargerPrefiltre() {
  const { filtres, carburants, boites } = await api("/api/admin/import/filtres");
  const form = $("form-prefiltre");
  const options = (liste) => Object.entries(liste).map(([valeur, libelle]) => `<option value="${echapper(valeur)}">${echapper(libelle)}</option>`).join("");
  if (form.elements.carburant.options.length === 1) {
    form.elements.carburant.insertAdjacentHTML("beforeend", options(carburants));
    form.elements.boite.insertAdjacentHTML("beforeend", options(boites));
    $("form-recherche").elements.fuel.insertAdjacentHTML("beforeend", options(carburants));
  }
  for (const cle of ["anneeMin", "kmMax", "prixMaxEur", "carburant", "boite"]) form.elements[cle].value = filtres[cle];
  form.elements.anneeMax.value = filtres.anneeMax ?? "";
  form.elements.achatImmediat.checked = filtres.achatImmediat;
}

$("form-prefiltre").addEventListener("submit", async (event) => {
  event.preventDefault();
  const f = event.currentTarget.elements;
  const filtres = {
    anneeMin: Number(f.anneeMin.value), anneeMax: f.anneeMax.value === "" ? null : Number(f.anneeMax.value), kmMax: Number(f.kmMax.value),
    prixMaxEur: Number(f.prixMaxEur.value), achatImmediat: f.achatImmediat.checked, carburant: f.carburant.value, boite: f.boite.value
  };
  try {
    await api("/api/admin/import/filtres", { method: "PUT", body: { filtres } });
    message("Préfiltre enregistré : il s'applique dès la prochaine recherche.");
    await chargerPrefiltre();
  } catch (error) {
    message(error.message, false);
  }
});

chargerPrefiltre().catch((error) => message(error.message, false));

// Délais de livraison par pays d'origine (réglage delais_livraison) : un champ par pays, vide = non affiché.
async function chargerDelais() {
  const [{ pays }, { reglages }] = await Promise.all([api("/api/admin/import/filtres"), api("/api/admin/site")]);
  const delais = reglages.find((r) => r.cle === "delais_livraison")?.valeur || {};
  const liste = [...new Set([...pays, ...Object.keys(delais)])];
  $("form-delais").innerHTML = liste.map((p, i) => `<label>${echapper(p)}<input name="d${i}" data-pays="${echapper(p)}" maxlength="60" placeholder="ex. 4 à 6 semaines" value="${echapper(delais[p] || "")}"></label>`).join("");
}

$("form-delais").addEventListener("submit", async (event) => {
  event.preventDefault();
  const valeur = Object.fromEntries([...event.currentTarget.querySelectorAll("[data-pays]")].filter((e) => e.value.trim()).map((e) => [e.dataset.pays, e.value.trim()]));
  try {
    await api("/api/admin/site/delais_livraison", { method: "PUT", body: { valeur } });
    message("Délais de livraison enregistrés.");
    await chargerDelais();
  } catch (error) {
    message(error.message, false);
  }
});

chargerDelais().catch((error) => message(error.message, false));

$("form-recherche").addEventListener("submit", async (event) => {
  event.preventDefault();
  const recherche = new URLSearchParams([...new FormData(event.currentTarget)].filter(([, v]) => String(v).trim() !== ""));
  $("resume").textContent = "Recherche…";
  try {
    const data = await api(`/api/admin/import/recherche?${recherche}`);
    annonces = data.annonces;
    $("resume").textContent = `${data.total} annonce(s) chez OpenLane, ${annonces.length} affichée(s). Annonces suivies : ${data.suivis} sur ${data.max}.`;
    $("annonces").innerHTML = annonces.map(carte).join("");
  } catch (error) {
    $("resume").textContent = "";
    message(error.message, false);
  }
});

$("annonces").addEventListener("click", async (event) => {
  const bouton = event.target.closest("[data-importer]");
  if (!bouton) return;
  const annonce = annonces[Number(bouton.dataset.importer)];
  if (!confirm(`Importer « ${annonce.titre || annonce.reference} » en brouillon ? Elle ne sera pas publiée avant votre relecture.`)) return;
  bouton.disabled = true;
  try {
    const resultat = await api("/api/admin/import", { method: "POST", body: { annonce } });
    message(`${resultat.reference} : ${resultat.message}`);
    annonce.dejaImporte = true;
    bouton.outerHTML = "<p><strong>Déjà importée</strong></p>";
  } catch (error) {
    message(error.message, false);
    bouton.disabled = false;
  }
});
