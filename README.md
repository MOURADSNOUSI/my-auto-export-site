# my-auto-export-site

## Un compte, deux profils séparés

L'identité (nom, e-mail et téléphone), le mot de passe et la session sont
communs. À l'inscription, choisir **Acheteur**, **Vendeur** ou **Acheteur et Vendeur**.
Le choix n'accorde aucun droit d'administration. Sans choix explicite via l'API,
le profil Acheteur reste la valeur par défaut pour les intégrations existantes.

- **Espace Acheteur** : favoris, propositions envoyées, achats, factures et caution.
- **Espace Vendeur** : coordonnées commerciales, dossiers, diagnostics, documents
  et offres reçues. Modifier ces coordonnées ne modifie pas l'identité commune.
- Une personne peut activer l'autre profil plus tard depuis ses espaces, sans
  nouvelle inscription ni second mot de passe. L'activation Vendeur ne remplace
  pas le dossier complet, le diagnostic ni la validation de ses annonces.
- `POST /api/account/profiles` avec `{"profile":"buyer"}` ou
  `{"profile":"seller"}` active uniquement le profil de l'utilisateur connecté.
  Cette route ne désactive aucun profil et ne modifie ni identité ni rôle.
- `GET /api/me` expose `user.profiles.buyer` et `user.profiles.seller`.
  Les API métier refusent l'accès si le profil correspondant n'est pas activé.
- La migration `0018_profils_acheteur_vendeur.sql` conserve tous les comptes,
  active le profil Acheteur existant et reconnaît les vendeurs déjà enregistrés.
  Appliquer cette migration avant de publier le code.

## Lot 1 — propositions d’achat

### Mode actuel : offres libres

`LEGACY_AUCTIONS_ENABLED="false"` désactive les enchères, l'achat immédiat et les
nouveaux paiements de caution. `FREE_OFFERS_ENABLED="true"` autorise toute proposition
strictement positive, même inférieure à la réserve ou sans réserve enregistrée.
La connexion, la devise de l'annonce, le consentement, les contrôles d'activité,
la modération des dossiers vendeurs et les limites anti-spam restent obligatoires.

Sans vendeur affecté, les offres sont reçues par M&Y, sans créer de vendeur fictif.
Les administrateurs les traitent depuis **Administration marketplace → Consulter
et traiter les offres reçues par M&Y**. Un administrateur ne peut pas accepter sa
propre proposition. Les vendeurs affectés continuent à décider sur leurs annonces.
Aucune vente ni aucun paiement n'est déclenché automatiquement.

La migration `0017_offres_libres.sql` conserve les offres et historiques existants,
rend le destinataire vendeur facultatif pour les offres libres et notifie les
administrateurs lorsqu'aucun vendeur n'est affecté. Appliquer cette migration
avant de publier le code. Les anciennes propositions conservent leurs conditions
de réserve ; la soumission libre est enregistrée individuellement sur les nouvelles.

Le fonctionnement initial et son contrôle de réserve sont décrits dans [le rapport du Lot 1](docs/LOT1_PROPOSITIONS.md). Pour rétablir les seuils de réserve et l'affectation obligatoire d'un vendeur, définir `FREE_OFFERS_ENABLED="false"`. `LEGACY_AUCTIONS_ENABLED="true"` réactive séparément les enchères historiques, l'achat immédiat et les dépôts. Ces changements de mode nécessitent une validation explicite. Le déploiement du 4 novembre 2026 est suivi dans [le rapport de déploiement](docs/DEPLOIEMENT_LOT1.md).

## Marketplace phase 1 (branche de développement)

Parcours vendeur, diagnostics privés et offres d’achat : [audit](docs/PHASE1_AUDIT.md), [installation et exploitation](docs/PHASE1_EXPLOITATION.md), [compte rendu et tests](docs/PHASE1_RAPPORT.md). Les confirmations contractuelles sont désactivées par défaut en attente de validation juridique. L’autorisation de déploiement du 4 novembre 2026 couvre le Lot 1 ; la confirmation contractuelle reste désactivée.

## Tests

```
pip install playwright && playwright install chromium
python3 -m unittest discover tests
```

Les tests du Worker (espace acheteur, enchères, administration, MCP, pages véhicules) sont ignorés sans
`WRANGLER=/chemin/vers/wrangler`.

Tests JavaScript (Vitest, `fetch` simulé) : `npm install`, puis `npm run test:js`.

## Catalogue Europe (TheCarApi)

`GET /api/voitures-europe` renvoie des voitures lues chez TheCarApi (`worker/voitures-europe.js`), sous la forme
`{ total, voitures: [{ id, titre, annee, km, carburant, boite, prixEur, prixTnd, source, finEnchere, image }] }`.

- **Préfiltre M&Y**, toujours appliqué (constantes en haut du fichier) : sites `openlane,ecarstrade`, année ≥ 2019,
  150 000 km au plus, 30 000 € au plus, 24 résultats. `mileage_to`, `price_to` et `page` ne sont pas documentés par
  TheCarApi : à vérifier (`PREFILTRE_A_VERIFIER`, `PARAMETRES_A_VERIFIER`).
- **Affinages du visiteur** : `brand`, `model`, `fuel`, `year_from`, `price_to`, `page` uniquement (40 caractères au plus,
  lettres, chiffres, espaces, virgules, points, tirets), sinon 400. `year_from` et `price_to` ne peuvent que resserrer
  le préfiltre. Tout autre paramètre est ignoré.
- **Cache** de 15 minutes (Cache API, clé = paramètres triés) pour économiser le quota. Aucune nouvelle tentative en cas
  d'échec : 5 échecs d'authentification bloquent l'IP 15 minutes chez TheCarApi.
- **Erreurs** : sans clé, 503 ; si TheCarApi échoue (401/403 clé ou portée, 429 quota…), 502 avec un message en
  français. Seul le statut est journalisé, jamais la clé ni la réponse.

Configuration :
- **Clé** : `npx wrangler secret put THECARAPI_KEY` (production). Elle n'est jamais envoyée au navigateur.
- **`EUR_TND_RATE`** (dinars pour 1 euro) donne `prixTnd = round(prixEur × taux)` ; sans taux valide, `prixTnd` vaut `null`.
  Le déclarer de préférence comme secret (`npx wrangler secret put EUR_TND_RATE`) : `wrangler.jsonc` n'a pas de `vars`,
  et une variable saisie dans le tableau de bord Cloudflare est effacée au déploiement suivant par `wrangler deploy`.
- **En local** : copier `.dev.vars.example` en `.dev.vars` (ignoré par git) et y mettre la clé et le taux.

## Référencement

Pages véhicules `/vehicules/…`, sitemap dynamique, contrôle SEO quotidien et journal : voir [docs/SEO.md](docs/SEO.md).
Contrôler le site en production (lecture seule) : `python3 scripts/controle_seo.py`.

## Ajouter un lot

```
python3 scripts/ajouter_lot.py --reference MY-001 --marque Peugeot --modele 3008 \
    --statut open --fin 2026-11-20T18:00 --prix 85000 --annee 2021 --km 54000 \
    --carburant Diesel --categorie SUV photo-avant.jpg photo-arriere.jpg
```

Les photos sont copiées dans `my-auto-export/photos/` et le lot est ajouté à
`my-auto-export/lots.json`. `--statut upcoming` (défaut) pour un lot à venir, sans date de fin.
`--source` (lien https vers la fiche fournisseur) est facultatif : sans lien, la carte affiche
« Se renseigner », qui ouvre le formulaire de contact. `python3 scripts/ajouter_lot.py -h` liste
toutes les options. Pour retirer un lot, supprime son entrée dans `lots.json` et ses photos.
Après l'ajout de photos, lance `python3 scripts/optimiser_photos.py` : il crée leurs versions WebP allégées.

## Importer le catalogue Wix

```
python3 scripts/importer_wix.py --essai   # aperçu, n'écrit rien
python3 scripts/importer_wix.py
```

Ajoute les véhicules de la page Wix en statut « En stock », prix en TND selon la formule
(prix HT EUR + 3 000) × 3,5 + 30 000. Un lot déjà présent n'est jamais écrasé : seuls ses champs vides sont complétés
(un prix déjà importé n'est donc pas recalculé).

Les photos importées sont enregistrées avec `authorized: false` et ne s'affichent pas sur le site : une adresse
https ne prouve aucun droit de publication. Une fois le droit confirmé par écrit par le fournisseur, relancer avec
`--photos-autorisees`.

## Espace acheteur (comptes, favoris, offres)

### Branche de production

La branche principale de ce dépôt est désormais `master` (anciennement `main`).
Tout déploiement de production doit partir de `master`, à jour avec `origin/master`,
sans modification locale ni commit non poussé, et après autorisation explicite.
Dans Cloudflare Workers Builds, sélectionner `master` comme branche de production ;
les branches de développement sont réservées aux aperçus.

Avant un déploiement autorisé, depuis un arbre de travail propre :

```bash
git fetch origin
git switch master
git pull --ff-only origin master
git status --short --branch
```

Si le changement de branche est bloqué par des modifications locales, les préserver
et utiliser un worktree séparé ; ne pas les effacer ou les committer avec le déploiement.

Le site est servi par un Worker Cloudflare (`worker/index.js`, point d'entrée `worker/main.js`) avec une base D1 (`migrations/`).
Mise en service, une seule fois, depuis une machine avec Node.js 20 ou plus :

```
npx wrangler login
npx wrangler d1 create my-auto-export          # copier le database_id affiché dans wrangler.jsonc
npx wrangler d1 migrations apply DB --remote   # crée les tables
npx wrangler deploy
```

`wrangler.jsonc` contient déjà le `database_id` de la base de production : ces étapes ne sont à refaire que pour
une nouvelle base (remplacer alors l'identifiant par celui qu'affiche `d1 create`).

Consulter les offres reçues et y répondre :

```
npx wrangler d1 execute DB --remote --command "SELECT o.id, o.reference, o.amount_tnd, o.kind, o.status, o.created_at, u.name, u.email, u.phone FROM offers o JOIN users u ON u.id = o.user_id ORDER BY o.id DESC"
npx wrangler d1 execute DB --remote --command "UPDATE offers SET status = 'accepted' WHERE id = 1"   # ou 'refused'
```

Tests du Worker (ignorés sans wrangler) : `WRANGLER=$(npx which wrangler) python3 -m unittest discover tests`

## Administration du catalogue (/admin.html)

Ajouter, modifier, retirer un véhicule et envoyer ses photos, depuis un téléphone ou un ordinateur.
Les véhicules sont enregistrés dans D1 (table `vehicles`) et les photos dans R2 (`my-auto-export-photos`).
Le site public affiche `lots.json` + les véhicules de l'administration : modifier un véhicule de `lots.json`
dans l'administration le remplace, le retirer le masque (sans toucher au fichier).

Mise en service, une seule fois :

```
npx wrangler r2 bucket create my-auto-export-photos
npx wrangler d1 migrations apply DB --remote
```

Puis crée ton compte sur le site (« Se connecter » → « Créer un compte ») et donne-lui l'accès :

```
npx wrangler d1 execute DB --remote --command "UPDATE users SET role = 'admin' WHERE email = 'ton@email.com'"
```

Retirer l'accès : même commande avec `role = 'buyer'`.

## Enchères en direct

Un véhicule est mis aux enchères dans l'administration avec le statut « Enchère en cours » et une date de fin
(« Enchère à venir » l'affiche sans permettre d'enchérir).

- Chaque enchère doit dépasser la meilleure d'un pas minimum : celui du véhicule (champ « Pas d'enchère »),
  sinon 200 TND sous 20 000, 500 sous 100 000, 1 000 sous 300 000, 2 000 au-delà. La première enchère part de la mise à prix.
- Une enchère placée dans les 2 dernières minutes repousse la fin à 2 minutes après elle.
- Le site affiche le prix actuel, le compte à rebours, la réserve atteinte ou non et l'historique anonymisé ;
  la fiche se met à jour toutes les 8 secondes.
- À la fin, le meilleur enchérisseur gagne si la réserve est atteinte. Dans l'administration, le bouton « Enchères »
  d'un véhicule liste les enchères avec le nom, l'e-mail et le téléphone de chaque enchérisseur.

Mise en service : `npx wrangler d1 migrations apply DB --remote` (index 0004), puis `git push origin main`.

## Conditions générales de vente (/conditions.html)

Projet rédigé selon le droit tunisien (COC, loi n° 2000-83, loi n° 92-117, loi organique n° 2004-63),
**à faire valider par un avocat tunisien** et à compléter (passages surlignés « À compléter ») avant publication.

- Avant sa première enchère ou demande d'achat, l'acheteur coche « J'ai lu et j'accepte les conditions » ;
  la version et la date d'acceptation sont enregistrées (`users.terms_version`, `users.terms_accepted_at`).
- Pour publier une nouvelle version : modifier `conditions.html`, puis changer la même date dans
  `CGV_VERSION` (worker/index.js) et dans `#cgv-version` (conditions.html). Tous les acheteurs devront réaccepter.

⚠️ Appliquer la migration **avant** de pousser le code, sinon la connexion échoue :
`npx wrangler d1 migrations apply DB --remote`, puis `git push origin main`.

## Accepter ou refuser les offres (administration)

En haut de `/admin`, la rubrique « À traiter » liste les ventes terminées en attente de décision et les demandes
d'achat immédiat. « Décider » ouvre les offres du véhicule (acheteur, e-mail, téléphone) :

- **Accepter** (possible seulement après la fin de la vente pour une enchère, y compris sous la réserve) : les autres
  offres en attente passent en « Refusée », le véhicule apparaît dans « Mes véhicules » de l'acheteur et, si la case est
  cochée, il est retiré du site. Le bouton « Envoyer la confirmation écrite » prépare l'e-mail prévu par les CGV (art. 6.3).
- **Refuser** : l'offre seule passe en « Refusée ».

L'acheteur voit « Acceptée · l'équipe vous contacte » ou « Refusée » dans sa page personnelle.

Pour une enchère, seule la **meilleure** peut être acceptée (les autres peuvent seulement être refusées). L'acceptation
est atomique : si deux administrateurs acceptent en même temps deux offres du même véhicule, une seule passe, l'autre
reçoit une erreur sans rien modifier. La base l'impose aussi (index `offers_une_acceptee`, migration 0006).

⚠️ Avant de pousser ce code : `npx wrangler d1 migrations apply DB --remote` (0006). La migration échoue si un véhicule
a déjà deux offres acceptées ; vérifier avant :
`npx wrangler d1 execute DB --remote --command "SELECT reference, COUNT(*) FROM offers WHERE status = 'accepted' GROUP BY reference HAVING COUNT(*) > 1"`

## Factures PDF

Le téléchargement des factures est **désactivé** : `wrangler.jsonc` ne déclare pas de stockage `DOCUMENTS`. L'espace
acheteur affiche « PDF non disponible » et `/api/invoices/<id>/document` répond 503. Pour l'activer, il faudra créer un
bucket R2 privé (`npx wrangler r2 bucket create my-auto-export-documents`), le déclarer avec le binding `DOCUMENTS`
et prévoir l'envoi des PDF depuis l'administration (pas encore développé).

## Dépôt de garantie (caution)

Requis pour enchérir, selon le barème de `DEPOSIT_TIERS` (worker/index.js). Le solde est global au compte.

- **Virement** : chaque demande a son montant, figé à la création, et son propre libellé `CAUTION-<numéro de la demande>`.
  Redemander un autre montant annule la demande en attente et en crée une nouvelle (nouveau libellé). Dans `/admin`,
  « Virement reçu » demande le montant lu sur le relevé : s'il diffère de la demande, rien n'est crédité (409) ; corriger
  alors la caution à la main. Le crédit est atomique et ne peut avoir lieu qu'une fois.
- **Carte** (Stripe, validée par webhook signé) : débitée en euros au taux `TND_PER_EUR` (dinars pour 1 €). **Il n'y a pas
  de taux par défaut** : sans `TND_PER_EUR` (nombre > 0), `/api/deposit/card` répond 503 et aucune demande n'est créée.
  Le propriétaire le déclare de préférence comme secret (`npx wrangler secret put TND_PER_EUR`) : une variable saisie
  dans le tableau de bord Cloudflare est effacée par le `wrangler deploy` suivant, `wrangler.jsonc` n'ayant pas de `vars`.
  Il le tient à jour : c'est le taux auquel les clients sont débités. Secrets : `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET` (`npx wrangler secret put …`) ; virement : `BANK_IBAN`, `BANK_BENEFICIARY`.
- **Ajustement manuel** (« Modifier la caution » dans les enchères d'un véhicule) : motif obligatoire (2 000 caractères au
  plus). Chaque ajustement est journalisé dans `deposit_adjustments` (ancien et nouveau solde, motif, administrateur, date) :
  `npx wrangler d1 execute DB --remote --command "SELECT * FROM deposit_adjustments ORDER BY id DESC LIMIT 50"`

⚠️ Appliquer la migration **avant** de pousser le code, sinon l'ajustement manuel échoue :
`npx wrangler d1 migrations apply DB --remote` (0016), puis déployer.

## Sécurité

- **Enchères refusées** : refuser une enchère (par exemple un montant fantaisiste) la retire du prix courant, de l'historique
  public et du calcul de la meilleure enchère ; la vente reprend au prix réel.
- **Essais de mot de passe** : 5 échecs par e-mail et par adresse IP, 30 par IP, 100 par e-mail sur 15 minutes. De faux mots de
  passe tapés ailleurs ne bloquent donc pas le titulaire du compte. Inscriptions : 10 par IP et par heure.
- **En-têtes** : `ENTETES_SECURITE` (worker/index.js) pour les réponses du Worker, `my-auto-export/_headers` pour les fichiers
  statiques (CSP, HSTS, interdiction d'affichage dans un cadre). Les deux doivent rester identiques (tests/test_securite.py).

⚠️ Appliquer la migration **avant** de pousser le code, sinon la connexion échoue :
`npx wrangler d1 migrations apply DB --remote` (0012), puis `git push origin main`.

Dans le tableau de bord Cloudflare (SSL/TLS → Edge Certificates) : activer « Always Use HTTPS », sans quoi le site reste
accessible en http.

## Connecter Claude au site (serveur MCP)

Le Worker expose un serveur MCP sur `/mcp` : Claude peut alors gérer le site avec les droits d'un administrateur
(`worker/mcp.js`). Outils : rechercher les véhicules, voir une fiche, ventes à traiter, lister les offres, ajouter
ou modifier un véhicule, le retirer du site, accepter ou refuser une offre. Ils appliquent les mêmes règles que
`/admin.html` (seule la meilleure enchère peut être acceptée, après la fin de la vente, etc.).

Mise en service, une seule fois : `npx wrangler d1 migrations apply DB --remote` (0007), puis `git push origin main`.

- **claude.ai / Claude Desktop** : Paramètres → Connecteurs → Ajouter un connecteur personnalisé, adresse
  `https://www.myautoexport.com/mcp`.
- **Claude Code** : `claude mcp add --transport http my-auto-export https://www.myautoexport.com/mcp`, puis `/mcp` pour se connecter.

Claude ouvre la page `/oauth/authorize` du site : se connecter avec un compte **administrateur** et cliquer « Autoriser ».
Le mot de passe est demandé à chaque autorisation, même si l'on est déjà connecté au site. Les codes ne peuvent être
renvoyés qu'à Claude (claude.ai, claude.com) ou à une adresse locale (`localhost`).

- L'accès (jeton de 1 heure, renouvelé automatiquement) dure tant que Claude s'en sert au moins une fois tous les 30 jours.
- Il s'arrête dès que le compte perd le rôle `admin`.
- Couper tous les accès donnés à Claude :
  `npx wrangler d1 execute DB --remote --command "DELETE FROM oauth_tokens"`

Claude est invité à demander confirmation avant toute modification, mais c'est le réglage d'autorisation des outils
dans Claude (« Toujours demander ») qui l'impose : à garder pour `accepter_offre`, `refuser_offre`, `retirer_vehicule`
et `enregistrer_vehicule`.

### Interrupteurs, agent local et journal des actions

- **Interrupteurs** (`/admin`, rubrique « Automatisations », table `reglages`) :
  - « Automatisations actives » (`automations_actives`) : décoché, tous les outils d'écriture du MCP sont refusés avec
    un message clair, pour Claude comme pour l'agent local. Les outils en lecture restent disponibles.
  - « Écriture autorisée à l'agent local » (`agent_ecriture_autorisee`, décoché par défaut) : sans lui, l'agent n'a
    accès qu'aux outils en lecture.
- **Agent local** : `Authorization: Bearer <AGENT_TOKEN>` sur `/mcp`, en plus de l'accès OAuth. Le secret fait au moins
  32 caractères (`openssl rand -hex 32`), se déclare avec `npx wrangler secret put AGENT_TOKEN`, et `.dev.vars` en local.
  Sans secret, l'accès agent est fermé. Une écriture de l'agent laisse `updated_by` vide.
- **Journal** (`audit_logs`, colonnes `acteur`, `details`, `resultat`) : chaque appel d'un outil d'écriture du MCP
  (acteur `mcp` ou `agent`) et chaque requête d'écriture de `/api/admin/*` d'un administrateur connecté (acteur `admin`),
  réussi, refusé ou en erreur. Les détails ne contiennent que le code de retour ou le message d'erreur, jamais le
  contenu d'un formulaire. Les lignes de la marketplace gardent `acteur` vide. Consulter les 50 dernières :
  `npx wrangler d1 execute DB --remote --command "SELECT at, acteur, actor_id, action, resource_id, resultat, details FROM audit_logs WHERE acteur IS NOT NULL ORDER BY id DESC LIMIT 50"`

⚠️ Appliquer la migration **avant** de déployer le code (`npx wrangler d1 migrations apply DB --remote`, 0019).
Faire d'abord une sauvegarde : `npx wrangler d1 export DB --remote --output sauvegarde.sql`.

## Prix estimés (chantier 2)

⚠️ **Valeurs à faire valider par le transitaire, textes officiels à consulter** : loi de finances 2026 (loi n° 2025-17,
JORT n° 148, [texte officiel en français](https://lake.jort.tn/journal-officiel/fr/2025/148.pdf)) et note commune n° 6 de
la DGELF. Aucune valeur n'est présentée comme certaine : chaque paramètre et chaque ligne de grille porte une note avec sa
source et la mention « À VÉRIFIER » ou « À REMPLACER », chaque régime un `statut_verification` à `a_verifier`.

- **Aucun prix public** : le réglage `prix_publics_actifs` (table `reglages`, `false`) bloque toute exposition publique.
  Il se modifie dans la rubrique « Site » de `/admin` (voir « Accueil et choix du public »).
- **Administration** : `/admin-prix` (lien depuis `/admin`) : paramètres, taux, régimes, grille, éligibilité, simulation,
  bandeau « Valeurs à vérifier par le transitaire » tant qu'un régime actif n'est pas vérifié. API : `GET /api/admin/prix`,
  `PUT /api/admin/prix/parametres/<cle>`, `/taux-manuel`, `/grille/<id>`, `/regimes/<code>`, `/eligibilite/<resident|fcr>`,
  `POST /api/admin/prix/simulation`. Les écritures sont journalisées (`audit_logs`, acteur `admin`).
- **Code** : `worker/prix.js` (`calculerPrix`, fonction pure ; `mettreAJourTaux` ; routes). Tests : `tests/prix.test.js`,
  `tests/test_prix.py`.

### Formules

Chaque ligne du détail est arrondie à l'entier (TND ou EUR) avant l'étape suivante ; chaque total est la somme des lignes.

- **Taux** = taux manuel s'il est actif, sinon taux automatique, × (1 + `marge_change_pct`). Sans taux : aucun prix, motif
  explicite, pas de taux par défaut.
- **Valeur en douane (CAF)** = (prix EUR + transport EUR) × (1 + `assurance_transport_pct`) × taux. Transport : celui du
  véhicule, sinon `transport_defaut_eur`. Hypothèse À VÉRIFIER (Code des douanes art. 23 et 24 selon le commentaire InFirst,
  non officiel) : la Douane applique sa propre évaluation.
- **Droits en cascade** (hypothèse À VÉRIFIER) : DD = valeur × dd % ; DC = (valeur + DD) × dc % ; TVA = (valeur + DD + DC)
  × tva %. Divergence : un exemple de presse calcule le DC sur la valeur CAF seule (sans effet quand le DD est à 0 %).
- **Redevance de prestations douanières** = max(droits et taxes payés × `redevance_douane_pct`, `redevance_douane_min_tnd`)
  (3 %, minimum 10 TND, commentaire InFirst, À VÉRIFIER). En FCR, elle porte sur la part payée (hypothèse À VÉRIFIER).
- **Commission** = prix d'achat EUR × `commission_pct` (le pourcentage porte sur le seul prix du véhicule, hors transport
  et taxes) + `commission_fixe_tnd` (convertie en EUR pour le prix TRE).
- **Résident** (`prixResidentTnd`) = valeur + DD + DC + TVA + redevance + transitaire + port + immatriculation × (1 −
  réduction) + commission. Régime selon le carburant (hybride rechargeable, hybride, électrique → régime LF 2026 s'il est
  actif, sinon droit commun), après contrôle de `eligibilite_resident` (âge, cylindrée, carburants).
- **TRE** : `prixTreEur` = véhicule + transport + commission (EUR) ; `dedouanementFcrEstimeTnd` = (DD + DC + TVA) ×
  part payée + redevance + transitaire + port, après contrôle de `eligibilite_fcr`.
- **Non comptés** (montants non trouvés) : taxe de formation et de développement, FODEC, droit de timbre, taxe de maîtrise
  de l'énergie. Carte grise et vignette : montant fixe d'exemple (`frais_immatriculation_tnd`), À REMPLACER.

### Régimes et sources

- `resident_droit_commun` : barème du droit de consommation 2026 du commentaire LF 2026 du cabinet InFirst (non officiel,
  tableau « concessionnaire », applicabilité aux particuliers à confirmer) ; essence 20/38/48/65/84 % (seuils 1 300, 1 500,
  1 700, 2 000 cm³), diesel 48/50/69/79/88/110 % (seuils 1 700, 1 900, 2 100, 2 300, 2 500 cm³), TVA 19 %. Droit de douane
  des voitures particulières (87.03) **non trouvé** : 20 % d'exemple À REMPLACER (taux 87.03 et origine UE, EUR.1, à
  confirmer par le transitaire).
- `resident_phev_lf2026` (art. 47 LF 2026) : DC exonéré, TVA 7 %. Droit de douane 0 % seulement pour Ex 87.02 et Ex 87.04 ;
  voitures particulières 87.03 : droit commun, à confirmer. Carte grise et vignette −50 % : non vérifié dans le texte.
- `resident_hev_lf2026` (art. 47) : DC −50 % pour l'essence ≤ 1 700 cm³ et le diesel « mixte » ≤ 2 100 cm³ (hybrides
  traités comme essence dans la grille) ; TVA et DD de droit commun. Taxe de maîtrise de l'énergie −50 % non comptée.
- `resident_electrique_lf2026` : DC exonéré, TVA 7 % (art. 47 LF 2026) ; DD 0 % (art. 30 LF 2022, note commune DGELF
  n° 2/2024, citée par InFirst, À VÉRIFIER).
- Mesures LF 2026 en vigueur depuis le 01/01/2026 ; la loi ne distingue ni neuf et occasion, ni FCR et droit commun.
  Presse consultée avant le texte : [Finco](https://finco.tn/blog/voitures-hybrides-electriques-tunisie-2026),
  [Managers](https://managers.tn/2026/03/17/voitures-hybrides-et-electriques-ce-que-vous-paierez-moins-cette-2026-en-tunisie/).
- `fcr_classique` (TRE) : extraits du portail de la Douane (https://old.douane.gov.tn/index.php?id=126, non lu
  directement) : 5 ans au plus depuis la première mise en circulation, 25 % des droits et taxes (essence ≤ 2 000 cm³,
  diesel ≤ 2 500 cm³, électriques et utilitaires), 30 % au-delà ; un ancien guide applique 30 % à tous les diesels.
  FCR utilisable une fois tous les 10 ans (décret n° 2024-370), non contrôlé par le calcul.
- **Représentation** : chaque ligne de grille est complète. Les lignes LF 2026 portent les pourcentages du droit commun
  déjà réduits ; les lignes FCR les recopient avec `part_payee_pct` (25 ou 30). Modifier une ligne de droit commun ne met
  pas à jour les autres : les recalculer à la main (les notes le rappellent).
- **Piste future** : l'article 55 (« avantage familles », véhicules de moins de 8 ans) n'est pas modélisé, ses textes
  d'application n'étant pas publiés.

### Taux EUR→TND

Mis à jour par le passage quotidien de 06:00 UTC (cron `0 6 * * *` existant). Source principale : page de la BCT
(https://www.bct.gov.tn/bct/siteprod/cours.jsp, ligne « EURO EUR 1 3,3834 »). Secours : ExchangeRate-API
(https://open.er-api.com/v6/latest/EUR, `rates.TND`), mention « Rates By Exchange Rate API » affichée dans `/admin-prix`
selon ses conditions d'utilisation. Contrôle de vraisemblance entre 2 et 6 ; en cas d'échec des deux sources, le dernier
taux est gardé. Chaque passage est journalisé (acteur `systeme`, action `prix.taux_auto`). Adresses surchargeables par
`PRIX_URL_BCT` et `PRIX_URL_SECOURS` (tests).

⚠️ Appliquer la migration **avant** de déployer le code : `npx wrangler d1 migrations apply DB --remote` (0020), après
une sauvegarde (`npx wrangler d1 export DB --remote --output sauvegarde.sql`).

## Accueil et choix du public (chantier 3)

- **Textes** : tous les textes de l'accueil, des cartes et des mentions de prix sont dans `worker/textes.js` (`fr`, `t(cle,
  valeurs)`). `index.html` porte des emplacements (`data-texte`, `#choix-public`, sections vides) que le Worker remplit par
  HTMLRewriter (`vitrineAccueil`, `worker/seo.js`) ; les textes lus par le JavaScript sont servis dans
  `<script type="application/json" id="textes">`.
- **Choix du public** : « J'habite en Tunisie · TND » / « À l'étranger · € », mémorisé dans le cookie `public` (`tre` ou
  `resident`, `Path=/; Max-Age=31536000; SameSite=Lax; Secure`, aucune donnée personnelle). Sans JavaScript, le lien
  `?public=…` (accueil, `/vehicules`, fiches) pose le cookie et redirige en 303 ; toute autre valeur est ignorée. Sans
  cookie, le réglage `public_par_defaut` s'applique. Ces pages répondent `Cache-Control: private, no-cache` et `Vary: Cookie`.
- **Réglages** (rubrique « Site » de `/admin`, API `GET /api/admin/site` et `PUT /api/admin/site/<cle>`, journalisés) :
  `whatsapp_numero` (vide, format `^\+?[0-9]{8,15}$`, bouton `wa.me` rendu par le serveur seulement s'il est saisi),
  `public_par_defaut` (`tre`), `prix_publics_actifs` (`false`), `prix_resident_actif` (`false`), `temoignages` (`[]`,
  section « Ils ont reçu leur voiture » masquée tant qu'elle est vide, sans interface de saisie). Valeurs par défaut dans
  `worker/reglages.js` (`REGLAGES_SITE`) : pas de migration.
- **Prix** (calcul à l'affichage avec `calculerPrix`, paramètres lus une fois par requête, rien n'est stocké) :
  - `prix_publics_actifs` faux : « Estimation sur demande » et bouton de contact (WhatsApp, sinon e-mail) ;
  - actif, public TRE : prix en €, « Prix estimé · taux du JJ/MM/AAAA · Devis définitif après vérification par notre
    transitaire », détail des lignes TRE et FCR dans un `<details>` ;
  - public résident : « Prix résident sur devis » et la phrase sur le régime en attente de textes d'application, tant que
    `prix_resident_actif` est faux (aucun régime résident n'est aujourd'hui vérifié) ; véhicule non éligible : « Réservé
    aux Tunisiens résidant à l'étranger » ;
  - badges « Importable par un résident » et « Tunisiens à l'étranger (FCR) » selon l'éligibilité calculée ; aucun badge
    si le calcul est impossible (prix d'achat `prixEur`, carburant ou cylindrée manquants) ;
  - aucun prix estimé dans le JSON-LD.
- **Formulations interdites** (loi 92-117) : « meilleur prix », « au meilleur prix », « tout compris », « prix tout
  compris ». La FAQ ne donne ni délai, ni taux, ni garantie chiffrés.
- **Admin** : le formulaire véhicule saisit le prix d'achat en EUR (`prixEur`), la cylindrée (`engineCc`) et la date de
  première immatriculation (`premiereImmatriculation`, âge exact pour l'éligibilité).
- Tests : `tests/test_accueil.py`.

## Achat sur mandat (chantier 4)

Le client choisit un véhicule de M&Y, fixe un prix maximum et accepte le mandat ; M&Y achète pour lui s'il obtient le
véhicule à ce prix. Code : `worker/mandats.js`, migration `0021_mandats.sql` (tables `mandats` et `mandat_evenements`,
textes provisoires et acomptes par défaut dans `reglages`). Les tables d'enchères et d'offres ne changent pas.

- **Ouverture** : réglage `mandats_actifs` (faux par défaut), dans `/admin-mandats`. Fermé, les véhicules gardent
  « Proposer une offre ». Ouvert, « Je veux ce véhicule » le remplace sur les véhicules de M&Y (pas sur les annonces
  de vendeurs) ; avec les enchères actives, seulement sur les véhicules en stock.
- **Demande** (`mandat-dialog.js`, connexion requise) : résidence, pays et usage du FCR pour un Tunisien de l'étranger,
  prix maximum (TND pour un résident, EUR sinon), téléphone, acceptation des textes. Chaque demande garde une copie des
  textes acceptés. Le motif d'éligibilité calculé (`calculerPrix`) est transmis à l'administration ; un véhicule non
  éligible n'est refusé à un résident que si `prix_resident_actif` est vrai.
- **Statuts** : demande → éligibilité vérifiée (acompte fixé, par défaut celui des réglages) → acompte reçu → achat en
  cours → acheté → livré ; non obtenu et annulé sont définitifs. L'acompte n'est pas encaissé en ligne.
- **Client** : `/mes-mandats` (suivi des étapes, annulation avant l'acompte).
- **Administration** : `/admin-mandats` (statut, acompte, note interne, textes), écritures journalisées ; MCP
  `lister_mandats` (lecture) et `mettre_a_jour_mandat` (`confirmer: true` exigé, soumis aux interrupteurs de l'agent).
- **Textes** : modèles provisoires À FAIRE RELIRE PAR UN JURISTE avant d'ouvrir les demandes.
- Tests : `tests/mandats.test.js` (Vitest) et `tests/test_mandats.py`.

## Connexion avec Google

« Continuer avec Google » sur `/vendre`, dans la connexion de l'accueil et dans le formulaire de mandat (`worker/google.js`,
migration `0022_connexion_google.sql`). Code d'autorisation OpenID Connect avec `state` lié au navigateur (cookie) et
PKCE, sans script Google dans les pages ; seuls le nom, l'e-mail et l'identifiant Google sont demandés.

- **Activation** : `GOOGLE_CLIENT_ID` dans `wrangler.jsonc` et `npx wrangler secret put GOOGLE_CLIENT_SECRET`. Sans les
  deux, le bouton est masqué et les routes répondent 404. Adresse de retour à déclarer chez Google :
  `https://www.myautoexport.com/api/auth/google/retour`.
- **Comptes** : identifiant Google déjà connu, sinon compte existant du même e-mail (vérifié par Google, le mot de passe
  reste valable), sinon nouveau compte sans mot de passe utilisable, soumis à la limite d'inscriptions par IP.
- **Refus** (e-mail non vérifié, jeton d'une autre application, état falsifié ou rejoué, annulation) : retour sur la
  page de départ avec `?connexion=refusee|annulee|limite`. Chaque connexion est journalisée (`auth.google`).
- Tests : `tests/test_google.py`, contre un faux Google local.

## Marketplace vendeurs et diagnostic obligatoire (issue #5)

`/vendre` propose huit étapes de dépôt, les brouillons, photos, dommages, diagnostics et documents
privés. `/admin` contient le lien **Annonces vendeurs à valider** vers `/admin-vendeurs`.
La soumission exige huit photos, les pièces obligatoires, un diagnostic PDF et un garage agréé valide.
L'administrateur vérifie réellement le diagnostic, son VIN et le dossier ; **l'approbation et la
publication sont deux actions distinctes**. Les enchères restent à venir jusqu'à leur activation
administrative dans le système existant.

Documentation : [guide technique et fonctionnel](docs/ESPACE_VENDEUR.md),
[audit préalable](docs/AUDIT_ESPACE_VENDEUR.md), [validation finale](docs/VALIDATION_ESPACE_VENDEUR.md),
[cahier des charges fourni](docs/ESPACE_VENDEUR_CAHIER_DES_CHARGES.md).
Le guide décrit les API, migrations 0011/0012/0013, contrôles, stockage R2 privé, accès temporaires,
règles documentaires, conservation et instructions de déploiement soumis à autorisation.

```
WRANGLER=/chemin/vers/wrangler python3 -m unittest discover -s tests -p 'test_vendeur.py' -v
```

Les tests sont locaux ; aucune base de production n'est utilisée. Un rapport téléversé n'est jamais
authentifié automatiquement. Le filtre de formats/PDF ne constitue pas un antivirus complet.
