// Menu « S'informer » de l'en-tête (balisage : worker/seo.js, menuInformer ; styles : /design/menu-informer.css).
// Clic sur le bouton : ouvre ou ferme le panneau. Clic en dehors ou touche Échap : ferme. Un seul panneau ouvert à la fois
// (la page peut contenir le menu de bureau et celui du menu mobile).
const menus = [...document.querySelectorAll(".menu-informer")];

function fermerMenu(menu, rendreFocus = false) {
  if (!menu.classList.contains("open")) return;
  const bouton = menu.querySelector(".menu-informer-bouton");
  menu.classList.remove("open");
  bouton.setAttribute("aria-expanded", "false");
  if (rendreFocus) bouton.focus();
}

for (const menu of menus) {
  const bouton = menu.querySelector(".menu-informer-bouton");
  bouton.addEventListener("click", () => {
    const ouvert = !menu.classList.contains("open");
    menus.forEach((autre) => fermerMenu(autre));
    if (!ouvert) return;
    menu.classList.add("open");
    bouton.setAttribute("aria-expanded", "true");
  });
}

document.addEventListener("click", (event) => {
  for (const menu of menus) if (!menu.contains(event.target)) fermerMenu(menu);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const ouvert = menus.find((menu) => menu.classList.contains("open"));
  if (ouvert) fermerMenu(ouvert, true);
});

// Pages « S'informer » imprimables (check-lists) : bouton « Imprimer ou enregistrer en PDF ».
document.querySelector("[data-imprimer]")?.addEventListener("click", () => window.print());
