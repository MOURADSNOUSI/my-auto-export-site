// Formulaire « Je confie le mandat » (achat sur mandat, chantier 4). Les textes viennent du serveur
// (/api/mandats/formulaire/<réf.>, fichier de traductions) ; les textes légaux sont insérés comme texte brut.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function request(path, method = "GET", body) {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  let data;
  try { data = await r.json(); } catch { throw new Error("Service momentanément indisponible."); }
  if (!r.ok) throw Object.assign(new Error(data.error || "Erreur"), { status: r.status });
  return data;
}
const LOGO_GOOGLE = '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
const publicDuCookie = () => (document.cookie.match(/(?:^|;\s*)public=(tre|resident)/) || [])[1] || "tre";
let dialog, opener;

function shell() {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "proposal-modal";
  dialog.id = "mandat-dialog";
  dialog.setAttribute("aria-labelledby", "mandat-title");
  dialog.innerHTML = '<button class="proposal-close" type="button">×</button><h2 id="mandat-title"></h2><div id="mandat-content"></div><p class="proposal-error" role="alert" aria-live="polite"></p>';
  dialog.querySelector(".proposal-close").onclick = () => dialog.close();
  dialog.addEventListener("close", () => opener?.focus());
  document.body.append(dialog);
  return dialog;
}

async function open(reference, button) {
  opener = button;
  const d = shell(), content = d.querySelector("#mandat-content"), error = d.querySelector(".proposal-error");
  content.textContent = "…";
  error.textContent = "";
  if (!d.open) d.showModal();
  try {
    const { vehicule: v, textes, libelles: L } = await request(`/api/mandats/formulaire/${encodeURIComponent(reference)}`);
    d.querySelector("#mandat-title").textContent = L.mandat_titre;
    d.querySelector(".proposal-close").setAttribute("aria-label", L.mandat_fermer);
    let connecte = false;
    try { await request("/api/me"); connecte = true; } catch (e) { if (e.status !== 401) throw e; }
    const choix = publicDuCookie();
    content.innerHTML = `<p><strong>${esc(v.titre)}</strong><br>${esc(L.mandat_reference)} ${esc(v.reference)}</p><p>${esc(L.mandat_intro)}</p>
      <section id="mandat-auth" ${connecte ? "hidden" : ""}><h3>${esc(L.mandat_connexion)}</h3><form id="mandat-login">
        <label>${esc(L.mandat_email)}<input name="email" type="email" autocomplete="email" required></label>
        <label>${esc(L.mandat_mot_de_passe)}<input name="password" type="password" autocomplete="current-password" required></label>
        <button>${esc(L.mandat_se_connecter)}</button></form>
        <p><a class="bouton-google" id="mandat-google" href="/api/auth/google?retour=${encodeURIComponent(location.pathname)}" hidden>${LOGO_GOOGLE}<span>${esc(L.mandat_google)}</span></a></p>
        <p><a href="/?espace=acheteur">${esc(L.mandat_creer_compte)}</a></p></section>
      <form id="mandat-form">
        <fieldset><legend>${esc(L.mandat_residence)}</legend>
          <label class="proposal-consent"><input type="radio" name="public" value="resident" ${choix === "resident" ? "checked" : ""}>${esc(L.mandat_resident)}</label>
          <label class="proposal-consent"><input type="radio" name="public" value="tre" ${choix === "tre" ? "checked" : ""}>${esc(L.mandat_tre)}</label></fieldset>
        <div id="mandat-tre">
          <label>${esc(L.mandat_pays)}<input name="paysResidence" maxlength="60" autocomplete="country-name"></label>
          <fieldset><legend>${esc(L.mandat_fcr_question)}</legend>
            <label class="proposal-consent"><input type="radio" name="fcr" value="non">${esc(L.mandat_non)}</label>
            <label class="proposal-consent"><input type="radio" name="fcr" value="oui">${esc(L.mandat_oui)}</label></fieldset>
          <p id="mandat-fcr-info" hidden>${esc(L.mandat_fcr_info)}</p>
        </div>
        <label><span id="mandat-prix-libelle"></span><input name="prixMax" type="text" inputmode="numeric" autocomplete="off" required><small>${esc(L.mandat_prix_aide)}</small></label>
        <label>${esc(L.mandat_telephone)}<input name="telephone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" required></label>
        <details><summary>${esc(L.mandat_lire)}</summary>
          <h3>${esc(L.mandat_texte_mandat)}</h3><p class="mandat-texte" data-texte="mandat"></p>
          <h3>${esc(L.mandat_texte_cgv)}</h3><p class="mandat-texte" data-texte="cgv"></p>
          <h3>${esc(L.mandat_texte_acompte)}</h3><p class="mandat-texte" data-texte="acompte"></p></details>
        <label class="proposal-consent"><input name="accepte" type="checkbox" required>${esc(L.mandat_accepte)}</label>
        <button id="mandat-send" ${connecte ? "" : "disabled"}>${esc(L.mandat_envoyer)}</button>
      </form>`;
    if (!connecte) request("/api/auth/google/etat").then(({ actif }) => { content.querySelector("#mandat-google").hidden = !actif; }).catch(() => {});
    for (const p of content.querySelectorAll(".mandat-texte")) {
      p.textContent = textes[p.dataset.texte];
      p.style.whiteSpace = "pre-line";
    }
    const form = content.querySelector("#mandat-form"), send = content.querySelector("#mandat-send");
    const majPublic = () => {
      const tre = form.elements.public.value === "tre";
      content.querySelector("#mandat-tre").hidden = !tre;
      content.querySelector("#mandat-prix-libelle").textContent = L.mandat_prix_max.replace("{devise}", tre ? "€" : "TND");
    };
    form.addEventListener("change", (event) => {
      if (event.target.name === "public") majPublic();
      if (event.target.name === "fcr") content.querySelector("#mandat-fcr-info").hidden = event.target.value !== "oui";
    });
    majPublic();
    content.querySelector("#mandat-login").addEventListener("submit", async (event) => {
      event.preventDefault();
      error.textContent = "";
      try {
        await request("/api/login", "POST", Object.fromEntries(new FormData(event.currentTarget)));
        connecte = true;
        content.querySelector("#mandat-auth").hidden = true;
        send.disabled = false;
        window.dispatchEvent(new Event("account-profiles-changed"));
        form.elements.prixMax.focus();
      } catch (e) { error.textContent = e.message; }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.textContent = "";
      const tre = form.elements.public.value === "tre";
      const prixMax = Number(form.elements.prixMax.value.replace(/[\s.,]/g, ""));
      const corps = {
        reference: v.reference, public: form.elements.public.value, prixMax, telephone: form.elements.telephone.value,
        accepte: form.elements.accepte.checked,
        ...(tre ? { paysResidence: form.elements.paysResidence.value, fcrDejaUtilise: form.elements.fcr.value === "" ? null : form.elements.fcr.value === "oui" } : {})
      };
      send.disabled = true;
      try {
        await request("/api/mandats", "POST", corps);
        content.innerHTML = `<p class="proposal-success" role="status">${esc(L.mandat_succes)}</p><p><a href="/mes-mandats">${esc(L.mandat_suivi)}</a></p>`;
      } catch (e) {
        error.textContent = e.message;
        send.disabled = false;
      }
    });
  } catch (e) {
    error.textContent = e.message;
    content.textContent = "";
  }
}

document.addEventListener("click", (event) => {
  const b = event.target.closest("[data-mandat-ref]");
  if (!b) return;
  event.preventDefault();
  open(b.dataset.mandatRef, b);
});
