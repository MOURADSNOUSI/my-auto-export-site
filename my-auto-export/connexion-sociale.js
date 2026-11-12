// Boutons « Continuer avec Google / Apple / Facebook » (accueil, /vendre, formulaire de mandat).
// Emplacement : <div class="connexion-sociale" data-retour="/vendre" data-ou="apres"></div>. Seuls les fournisseurs
// configurés côté serveur (/api/auth/fournisseurs) sont affichés ; aucun configuré : l'emplacement reste vide.
// data-ou : séparateur « ou » après les boutons (« apres », formulaire e-mail en dessous) ou avant (« avant »).
// data-retour : page où revenir après la connexion, lue au clic (l'accueil la change selon l'action en cours).
const LOGOS = {
  google: '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
  apple: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#000" d="M16.37 1.43c0 1.14-.42 2.2-1.25 3.16-.99 1.16-2.19 1.83-3.49 1.72a3.5 3.5 0 0 1-.03-.43c0-1.1.48-2.27 1.33-3.24.43-.49.97-.9 1.63-1.22.66-.32 1.28-.5 1.86-.53.02.18.03.36.03.54zm4.33 15.83c-.37.86-.81 1.65-1.32 2.37-.69.99-1.26 1.67-1.7 2.05-.68.63-1.41.95-2.19.97-.56 0-1.24-.16-2.03-.48-.79-.32-1.52-.48-2.19-.48-.7 0-1.45.16-2.25.48-.8.32-1.45.49-1.94.51-.75.03-1.5-.3-2.25-1-.48-.42-1.08-1.13-1.8-2.15-.77-1.08-1.4-2.33-1.9-3.76C.63 12.24.37 10.75.37 9.3c0-1.65.36-3.08 1.07-4.27a6.3 6.3 0 0 1 2.25-2.28 6.04 6.04 0 0 1 3.04-.86c.6 0 1.38.18 2.35.55.97.37 1.59.55 1.86.55.2 0 .89-.22 2.06-.65 1.1-.4 2.04-.56 2.8-.5 2.07.17 3.63.99 4.66 2.46-1.85 1.12-2.77 2.7-2.75 4.72.02 1.57.59 2.88 1.71 3.92.5.48 1.07.86 1.69 1.12-.14.39-.28.76-.43 1.12z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#1877F2" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"/></svg>'
};
const LIBELLES = { google: "Continuer avec Google", apple: "Continuer avec Apple", facebook: "Continuer avec Facebook" };
const ORDRE = ["google", "apple", "facebook"];

if (!document.querySelector('link[href="/design/connexion-sociale.css"]')) {
  document.head.insertAdjacentHTML("beforeend", '<link rel="stylesheet" href="/design/connexion-sociale.css">');
}

let fournisseurs;
const actifs = () => {
  fournisseurs ||= fetch("/api/auth/fournisseurs").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return fournisseurs;
};

const lien = (nom, retour) => `/api/auth/${nom}?retour=${encodeURIComponent(retour || "/")}`;

export async function remplirConnexionSociale(conteneur) {
  if (!conteneur || conteneur.dataset.rempli) return;
  conteneur.dataset.rempli = "1";
  const etat = await actifs();
  const noms = ORDRE.filter((nom) => etat[nom] === true);
  if (!noms.length) return;
  const boutons = noms.map((nom) => `<a class="bouton-connexion" data-fournisseur="${nom}" href="${lien(nom, conteneur.dataset.retour)}">${LOGOS[nom]}<span>${LIBELLES[nom]}</span></a>`).join("");
  const ou = '<p class="connexion-ou"><span>ou</span></p>';
  conteneur.innerHTML = conteneur.dataset.ou === "avant" ? ou + boutons : boutons + ou;
}

// Au clic, le lien reprend la page de retour actuelle de son emplacement.
document.addEventListener("click", (event) => {
  const bouton = event.target.closest?.(".connexion-sociale a[data-fournisseur]");
  if (bouton) bouton.href = lien(bouton.dataset.fournisseur, bouton.closest(".connexion-sociale").dataset.retour);
});

document.querySelectorAll(".connexion-sociale").forEach(remplirConnexionSociale);
