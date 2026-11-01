// Point d'entrée du Worker. Il n'exporte que le gestionnaire : Cloudflare refuse tout autre export nommé dans le module
// principal (il les prend pour des points d'entrée), alors qu'index.js partage ses fonctions avec mcp.js.
export { default } from "./index.js";
