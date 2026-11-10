// Pages du menu « S'informer » (Magazine, Conseils, Services) : contenus éditoriaux rendus par worker/seo.js
// (pageInformer). Faits réglementaires tirés des notes de recherche « Importation véhicules Europe Tunisie »
// (novembre 2026), avec leurs sources ; ce qui n'y a pas été trouvé est dit comme tel. Les contenus sont écrits ici
// (HTML de confiance, sans donnée saisie par des tiers). Mise à jour : changer MISE_A_JOUR et le texte concerné.

export const MISE_A_JOUR = "2026-11-10";

const S = {
  idaratyFcr: ["Idaraty : importer un véhicule sous FCR", "https://idaraty.tn/fr/procedures/importer-un-vehicule-sous-fcr-en-tunisie"],
  idaratyArt55: ["Idaraty : avantage fiscal famille résidente", "https://idaraty.tn/fr/procedures/avantage-fiscal-importation-acquisition-vehicule-famille-tunisienne-residente"],
  jort148: ["JORT n° 148 du 12 décembre 2025 (loi de finances 2026)", "https://lake.jort.tn/journal-officiel/fr/2025/148.pdf"],
  infirst: ["InFirst Auditors : commentaire de la loi de finances 2026 (non officiel)", "https://www.infirst.tn/wp-content/uploads/2025/12/Commentaire-LF-2026-InFirst-V2.pdf"],
  simulateur: ["Douane tunisienne : module de taxation des véhicules", "https://www.douane.gov.tn/taxationveh/"],
  bnFcr: ["Business News : FCR, modalités de renouvellement (14/04/2026)", "https://businessnews.com.tn/2026/04/14/fcr-modalites-de-renouvellement-et-droits-individuels/1396540/"],
  bnDroits: ["Business News : comment sont calculés les droits de douane (10/04/2025)", "https://businessnews.com.tn/2025/04/10/comment-sont-calcules-les-droits-de-douane-en-tunisie/1358716/"],
  pressArt55: ["La Presse : « Une voiture pour chaque famille », pourquoi la loi est bloquée (22/05/2026)", "https://www.lapresse.tn/2026/05/22/une-voiture-pour-chaque-famille-pourquoi-la-loi-est-toujours-bloquee/"],
  automobilePhev: ["Automobile.tn : la LF 2026 et les hybrides rechargeables (26/10/2025)", "https://www.automobile.tn/fr/magazine/actu/2025-10-26-projet-de-loi-de-finances-2026-la-tunisie-accelere-la-transition-vers-les-vehicules-hybrides-rechargeables.html"],
  coc647: ["Code des obligations et contrats, art. 647 à 674 : garantie des vices (Jurisite, non officiel)", "https://www.jurisitetunisie.com/tunisie/codes/coc/Coc1102.htm"],
  coc1116: ["Code des obligations et contrats, art. 1116 à 1140 : obligations du mandataire (Jurisite, non officiel)", "https://www.jurisitetunisie.com/tunisie/codes/coc/Coc1160.htm"],
  coc303: ["Code des obligations et contrats, art. 303 à 305 : les arrhes (Jurisite, non officiel)", "https://www.jurisitetunisie.com/tunisie/codes/coc/Coc1047.htm"],
  loi200083: ["Loi n° 2000-83 du 9 août 2000 sur le commerce électronique (CMF)", "https://www.cmf.tn/sites/default/files/pdfs/reglementation/textes-reference/loi_2000-83_090800_fr.pdf"],
  loi92117: ["Loi n° 92-117 sur la protection du consommateur (FAOLEX, non officiel)", "https://faolex.fao.org/docs/pdf/Tun190410.pdf"],
  carpass: ["Car-Pass : la fraude au compteur dans l'Union européenne", "https://www.car-pass.be/en/news-and-info/eu-context"],
  histovec: ["L'argus : Histovec intègre les données du contrôle technique", "https://www.largus.fr/actualite-automobile/histovec-integre-desormais-les-donnees-du-controle-technique-10512410.html"],
  openlaneCgv: ["OpenLane : conditions générales des acheteurs", "https://info.openlane.eu/en/legal-matters/terms-and-conditions-for-buyers/"],
  openlaneFaq: ["OpenLane : questions des acheteurs", "https://info.openlane.eu/en/help/faq/category/for-buyers/"]
};

// Colonnes du menu : titre de la colonne et adresse de chaque page (dans l'ordre du menu).
export const COLONNES_INFORMER = [
  { titre: "Magazine", pages: ["/magazine/actualite-auto"] },
  { titre: "Conseils", pages: ["/conseils/acheter-une-occasion", "/conseils/vendre-une-occasion", "/conseils/telechargements", "/conseils/securite-achat-vente"] },
  { titre: "Services", pages: ["/services/credit-auto", "/services/assurance-auto", "/services/evaluation-prix", "/services/inspection-auto", "/services/certificat-de-conformite"] }
];

// Chaque page : libellé du menu, titre (h1), description (balise meta), chapô, sections { titre, html }, sources, appel à
// l'action. html : contenu rédigé ici, inséré tel quel.
export const PAGES_INFORMER = {
  "/magazine/actualite-auto": {
    menu: "Actualité auto",
    titre: "Actualité auto : ce qui change pour importer une voiture en Tunisie",
    description: "Loi de finances 2026, hybrides rechargeables, avantage « famille résidente », FCR : les nouveautés qui comptent pour importer une voiture d'Europe en Tunisie.",
    chapo: "Les règles d'importation des voitures évoluent chaque année avec la loi de finances. Voici les points qui comptent en novembre 2026 pour un achat en Europe, résumés et sourcés.",
    sections: [
      { titre: "Hybrides rechargeables : droit de consommation supprimé et TVA à 7 %", html: `<p>L'article 47 de la loi de finances 2026 <strong>exonère les hybrides rechargeables (PHEV) du droit de consommation</strong> et leur applique <strong>la TVA réduite de 7 %</strong>, comme aux voitures électriques. Les hybrides simples (HEV) gardent leur réduction de 50 % du droit de consommation, jusqu'à 1 700 cm³ en essence.</p><p>La loi ne distingue pas les véhicules neufs et d'occasion. Pour un achat en Europe, un PHEV récent peut donc devenir nettement moins taxé qu'un modèle thermique équivalent. Le droit de douane à 0 % est explicitement prévu pour certaines positions tarifaires (87.02 et 87.04), mais pas explicitement pour les voitures de tourisme (87.03) : point à faire confirmer par la douane.</p>` },
      { titre: "« Une voiture par famille » (article 55) : adopté, mais pas encore applicable", html: `<p>L'article 55 de la loi de finances 2026 crée un avantage pour les <strong>familles tunisiennes résidentes</strong>, utilisable une seule fois : véhicule neuf ou d'occasion de <strong>8 ans au plus</strong>, diesel jusqu'à 1 900 cm³ ou essence jusqu'à 1 600 cm³, avec un <strong>droit de consommation de 10 %</strong> et une <strong>TVA de 7 %</strong>. Il est réservé aux revenus nets jusqu'à 10 SMIG pour une personne seule et 14 SMIG pour un couple, et le véhicule est incessible pendant 5 ans.</p><p>L'arrêté d'application n'avait <strong>pas été publié au JORT fin octobre 2026</strong>, et la presse faisait état d'un blocage en mai 2026. Tant qu'il n'est pas paru, nous ne pouvons pas garantir le bénéfice de ce régime.</p>` },
      { titre: "FCR : un avantage renouvelable tous les dix ans", html: `<p>Le régime FCR des Tunisiens résidant à l'étranger repose sur le <strong>décret n° 2024-370 du 19 juin 2024</strong>. Il est utilisable <strong>une fois tous les dix ans</strong>, pour une voiture de <strong>5 ans au plus</strong>, avec deux options : exonération totale (série RS, véhicule incessible sans autorisation de la douane) ou partielle (série TU, 25 % ou 30 % des droits et taxes selon la motorisation et la cylindrée). La loi de finances 2026 ne modifie pas le FCR voiture.</p>` },
      { titre: "Transport : nouvelle classe pour les voitures électriques", html: `<p>Depuis le 1er janvier 2026, le code maritime international des marchandises dangereuses (IMDG, amendement 42-24) classe les véhicules à batterie lithium-ion sous un nouveau numéro, UN3556. Les voitures électriques et hybrides expédiées par bateau sont déclarées sous ce numéro : vérifiez-le avec le transporteur au moment de la réservation.</p>` }
    ],
    sources: [S.jort148, S.infirst, S.automobilePhev, S.idaratyArt55, S.pressArt55, S.idaratyFcr, S.bnFcr]
  },

  "/conseils/acheter-une-occasion": {
    menu: "Acheter une occasion",
    titre: "Acheter une voiture d'occasion en Europe pour la Tunisie",
    description: "Régimes possibles (FCR, famille résidente), étapes de l'achat sur mandat, documents, délais et pièges à éviter pour importer une voiture d'occasion d'Europe en Tunisie.",
    chapo: "Acheter en Europe donne accès à un choix bien plus large et à des véhicules récents bien entretenus. Mais en Tunisie, c'est le régime d'importation qui décide de ce qui est possible. Voici la marche à suivre.",
    sections: [
      { titre: "1. Vérifier votre régime d'importation", html: `<p>C'est la première question, avant même de choisir le modèle :</p><ul><li><strong>Vous êtes Tunisien résidant à l'étranger (TRE) :</strong> le régime FCR permet d'importer une voiture de <strong>5 ans au plus</strong>, une fois tous les dix ans, avec exonération totale ou partielle des droits. Conditions habituelles : 2 ans au moins de séjour à l'étranger et importation dans les 2 ans suivant votre dernière entrée.</li><li><strong>Vous résidez en Tunisie :</strong> nous n'avons trouvé aucun texte qui autorise un particulier à importer librement une voiture d'occasion au droit commun. La voie prévue est l'avantage « famille résidente » (article 55 de la loi de finances 2026, voiture de 8 ans au plus), dont l'arrêté d'application n'était pas encore publié fin octobre 2026.</li></ul><p>L'âge se compte depuis la <strong>première mise en circulation</strong>, pas depuis l'achat.</p>` },
      { titre: "2. Fixer un budget complet", html: `<p>Le prix affiché en Europe n'est qu'une partie du coût. Ajoutez le transport jusqu'au port tunisien, l'assurance du transport, les droits et taxes (droit de douane, droit de consommation selon la cylindrée et le carburant, TVA, redevance douanière de 3 %), le transitaire, le port et l'immatriculation. Un véhicule hybride rechargeable ou électrique est beaucoup moins taxé depuis 2026.</p><p>Nos fiches détaillent ces postes ligne par ligne, et le <a href="https://www.douane.gov.tn/taxationveh/" rel="noopener">simulateur de la douane</a> donne une estimation officielle des droits.</p>` },
      { titre: "3. Confier un mandat d'achat écrit", html: `<p>Avec l'achat sur mandat, M&amp;Y AUTO EXPORT achète <strong>en votre nom et pour votre compte</strong>, dans la limite d'un <strong>prix maximum</strong> que vous fixez. Le Code des obligations et contrats encadre ce contrat : un achat au-dessus de votre plafond peut être refusé, et le mandataire vous doit un compte détaillé et justifié de ce qu'il a dépensé.</p>` },
      { titre: "4. Contrôler le véhicule avant d'acheter", html: `<p>Kilométrage, historique, dommages, entretien : les plateformes européennes rejettent presque toute responsabilité sur leurs descriptions. Voir notre page <a href="/services/inspection-auto">Inspection auto</a>.</p>` },
      { titre: "5. Transport, douane et immatriculation", html: `<ul><li><strong>Transport :</strong> camion jusqu'au port européen, puis bateau roulier ou conteneur vers Radès, ou ferry vers La Goulette. Gênes–Tunis prend environ 20 à 28 heures de traversée ; depuis la mer du Nord, 12 à 24 jours en conteneur.</li><li><strong>Douane :</strong> déclaration déposée par vous ou votre mandataire (commissionnaire agréé).</li><li><strong>Visite technique ATTT :</strong> elle délivre un certificat d'identification, <strong>valable un mois</strong>. Pour le FCR, elle a lieu au centre de Sijoumi (Tunis).</li><li><strong>Carte grise :</strong> série TU, ou RS pour un FCR en exonération totale. Puis l'assurance.</li></ul><p>Pour un FCR, la procédure officielle annonce <strong>3 à 7 mois</strong> de bout en bout.</p>` },
      { titre: "Les pièges les plus fréquents", html: `<ul><li>Un véhicule trop âgé de quelques semaines pour votre régime.</li><li>Un véhicule qui n'est pas à votre nom alors que le régime l'exige.</li><li>Le certificat d'identification ATTT expiré avant l'immatriculation.</li><li>Une revente envisagée alors que la carte grise RS (ou l'article 55) l'interdit.</li><li>Un kilométrage trafiqué : voir <a href="/services/inspection-auto">Inspection auto</a>.</li></ul>` }
    ],
    sources: [S.idaratyFcr, S.bnFcr, S.idaratyArt55, S.jort148, S.simulateur, S.coc1116],
    action: { libelle: "Voir les véhicules", href: "/vehicules" }
  },

  "/conseils/vendre-une-occasion": {
    menu: "Vendre une occasion",
    titre: "Vendre votre voiture d'occasion sur M&Y AUTO EXPORT",
    description: "Déposer une annonce, préparer le diagnostic et les documents, fixer le bon prix et recevoir des offres privées : le guide du vendeur sur M&Y AUTO EXPORT.",
    chapo: "Vous vendez un véhicule ? Sur M&Y AUTO EXPORT, les acheteurs font des offres privées, et aucune annonce n'est publiée avant la vérification du dossier par notre équipe.",
    sections: [
      { titre: "Comment ça marche", html: `<ol><li><strong>Créez votre compte</strong> et activez le profil Vendeur. Une seule connexion sert pour acheter et pour vendre.</li><li><strong>Déposez le véhicule</strong> : identification, caractéristiques, photos, équipements et défauts connus.</li><li><strong>Joignez le diagnostic</strong> d'un garage et les documents demandés.</li><li><strong>Notre équipe vérifie</strong> le dossier avant toute publication.</li><li><strong>Vous recevez des offres privées</strong>, que vous acceptez ou refusez depuis « Offres reçues ».</li></ol>` },
      { titre: "Préparer une annonce qui inspire confiance", html: `<ul><li><strong>Des photos nettes et nombreuses :</strong> les quatre côtés, l'intérieur, le compteur, le coffre, les pneus et chaque défaut.</li><li><strong>Des défauts déclarés honnêtement :</strong> zone, type et gravité. Une rayure annoncée rassure ; une rayure découverte fait fuir.</li><li><strong>L'historique d'entretien :</strong> carnet, factures, contrôle technique.</li><li><strong>Le bon prix :</strong> comparez des véhicules du même âge, du même kilométrage et de la même finition. Voir <a href="/services/evaluation-prix">Évaluation prix voiture</a>.</li></ul>` },
      { titre: "Ce que la loi attend du vendeur", html: `<p>En droit tunisien, le vendeur garantit les <strong>vices cachés</strong> qui diminuent sensiblement la valeur ou l'usage du véhicule, ainsi que les <strong>qualités déclarées</strong> dans l'annonce (Code des obligations et contrats, art. 647). L'acheteur doit signaler un défaut dans les 7 jours suivant la réception (art. 652). Décrire le véhicule avec exactitude, c'est aussi vous protéger.</p>` },
      { titre: "Documents à préparer", html: `<ul><li>Carte grise à votre nom.</li><li>Diagnostic récent d'un garage.</li><li>Carnet d'entretien et factures, si vous les avez.</li><li>Les autres pièces demandées dans votre espace Vendeur (rubrique « Mes documents »).</li></ul>` }
    ],
    sources: [S.coc647],
    action: { libelle: "Déposer une annonce", href: "/vendre" }
  },

  "/conseils/telechargements": {
    menu: "Téléchargements",
    titre: "Téléchargements : listes à imprimer et documents utiles",
    description: "Listes de documents à préparer (FCR, vendeur), check-list de réception du véhicule et conditions générales : les documents utiles pour importer ou vendre une voiture.",
    chapo: "Des listes simples à imprimer ou à garder sur votre téléphone. Pour imprimer une liste ou l'enregistrer en PDF, utilisez la fonction Imprimer de votre navigateur.",
    sections: [
      { titre: "Dossier FCR : pièces à réunir", html: `<p>Pièces citées par la procédure officielle (Idaraty), à confirmer auprès de la douane :</p><ul class="cases"><li>Déclaration en douane et demande de privilège fiscal (guichet unique)</li><li>Carte d'identité nationale du bénéficiaire et du conjoint</li><li>Extrait de naissance</li><li>Copie du passeport</li><li>Certificat d'immatriculation étranger ou titre de propriété</li><li>Certificat d'identification délivré par la visite technique ATTT</li></ul>` },
      { titre: "Immatriculation en Tunisie : pièces à réunir", html: `<ul class="cases"><li>Carte grise étrangère originale</li><li>Certificat d'identification ATTT (valable un mois)</li><li>Attestation douanière d'immatriculation en série tunisienne</li><li>Reçu de déclaration d'impôt sur le revenu</li><li>Quittance des droits ou attestation d'exonération</li></ul>` },
      { titre: "Check-list de réception du véhicule", html: `<p>À faire le jour de la livraison, avant de signer quoi que ce soit :</p><ul class="cases"><li>Numéro de châssis (VIN) identique sur le véhicule et sur les documents</li><li>Kilométrage relevé et photographié</li><li>Tour complet du véhicule : carrosserie, vitres, jantes, pneus, photos datées</li><li>Intérieur, équipements annoncés, clés et cartes</li><li>Voyants au démarrage, essai si possible</li><li>Documents remis : carte grise, COC s'il existe, carnet d'entretien</li><li>Réserves écrites pour tout défaut constaté</li></ul><p>Le Code des obligations et contrats laisse <strong>7 jours</strong> après la réception pour signaler un défaut (art. 652) : ne tardez pas.</p>` },
      { titre: "Vendeur : avant de déposer une annonce", html: `<ul class="cases"><li>Carte grise à votre nom</li><li>Diagnostic récent d'un garage</li><li>Photos : quatre côtés, intérieur, compteur, coffre, pneus, défauts</li><li>Carnet d'entretien et factures</li></ul>` },
      { titre: "Documents de M&Y AUTO EXPORT", html: `<ul><li><a href="/conditions">Conditions générales de vente</a></li></ul>` }
    ],
    sources: [S.idaratyFcr, S.coc647],
    imprimable: true
  },

  "/conseils/securite-achat-vente": {
    menu: "Sécurité achat et vente de voiture",
    titre: "Sécurité : acheter et vendre une voiture sans mauvaise surprise",
    description: "Paiements, arnaques, contrat écrit, droit de rétractation, garanties : les règles pour acheter ou vendre une voiture en toute sécurité, en Tunisie comme en Europe.",
    chapo: "La plupart des litiges se jouent avant la vente : un paiement sans trace, un contrat flou, un véhicule mal décrit. Quelques règles simples suffisent à les éviter.",
    sections: [
      { titre: "Payer de façon traçable", html: `<ul><li><strong>Virement bancaire</strong> plutôt qu'espèces. La loi n° 2015-26 interdit aux sociétés de recevoir 5 000 TND ou plus en espèces.</li><li>Un paiement à l'étranger en euros passe par une banque tunisienne (intermédiaire agréé).</li><li><strong>Ne payez jamais</strong> sur un compte personnel inconnu, par mandat cash ou en cartes prépayées, même pour « réserver » une affaire.</li><li>Gardez chaque reçu, facture et échange écrit.</li></ul>` },
      { titre: "Reconnaître une arnaque", html: `<ul><li>Un prix très en dessous du marché, avec une urgence (« d'autres acheteurs attendent »).</li><li>Un vendeur « à l'étranger » qui ne peut jamais montrer le véhicule et demande un acompte pour l'expédier.</li><li>Un faux site ou une fausse adresse de plateforme, des liens reçus par message.</li><li>Des documents scannés illisibles ou un numéro de châssis qui ne correspond pas.</li></ul><p>En cas de doute, arrêtez-vous et vérifiez par un autre canal. M&amp;Y AUTO EXPORT ne vous demandera jamais de payer sur un compte personnel.</p>` },
      { titre: "Exiger un contrat écrit", html: `<p>Pour un achat sur mandat, le contrat doit fixer le véhicule recherché, le <strong>prix maximum</strong>, la rémunération et le sort de l'acompte. Le Code des obligations et contrats protège le client : un achat au-dessus du prix fixé peut être désavoué (art. 1122), et le mandataire doit un compte détaillé et justifié (art. 1136). Des arrhes s'imputent sur le prix et sont restituées si le contrat est résilié d'un commun accord (art. 303 à 305).</p>` },
      { titre: "Vos droits quand vous achetez en ligne", html: `<p>La loi n° 2000-83 sur le commerce électronique impose au vendeur de vous informer avant la commande (identité, adresse, prix, taxes, frais) et de vous faire confirmer un récapitulatif. Elle prévoit un <strong>droit de rétractation de 10 jours ouvrables</strong>, avec des exceptions. La loi n° 92-117 interdit la publicité trompeuse sur les prix et rend nulle toute clause de non-garantie du fournisseur face au consommateur.</p>` },
      { titre: "Vendeurs : se protéger aussi", html: `<ul><li>Ne remettez ni le véhicule ni la carte grise avant l'encaissement effectif du paiement.</li><li>Méfiez-vous des « trop-perçus » à rembourser : c'est une fraude classique.</li><li>Décrivez honnêtement le véhicule : vous en garantissez les qualités déclarées.</li></ul>` }
    ],
    sources: [S.coc1116, S.coc303, S.loi200083, S.loi92117, S.coc647]
  },

  "/services/credit-auto": {
    menu: "Crédit auto",
    titre: "Crédit auto : financer l'achat d'une voiture importée",
    description: "Comment préparer le financement d'une voiture importée d'Europe : budget complet, apport, calendrier des paiements, questions à poser à votre banque.",
    chapo: "M&Y AUTO EXPORT ne propose pas de crédit. Mais un financement bien préparé évite les mauvaises surprises : voici comment l'aborder avec votre banque.",
    sections: [
      { titre: "Financer le coût complet, pas seulement le prix affiché", html: `<p>Pour une voiture importée, la banque doit financer le <strong>coût rendu en Tunisie</strong> : prix d'achat, transport, assurance du transport, droits et taxes, transitaire et immatriculation. Demandez un devis complet avant de solliciter le prêt, pour ne pas manquer de financement au moment du dédouanement.</p>` },
      { titre: "Anticiper le calendrier des paiements", html: `<p>Le paiement se fait en plusieurs temps : l'acompte au mandat, le prix du véhicule à l'achat en Europe, puis les droits et taxes à l'arrivée. Pour un FCR, comptez 3 à 7 mois entre le début et la carte grise. Vérifiez que le déblocage des fonds de votre banque suit ce calendrier.</p>` },
      { titre: "Les questions à poser à votre banque", html: `<ul><li>Finance-t-elle une voiture d'occasion importée, et jusqu'à quel âge de véhicule ?</li><li>Quel apport personnel exige-t-elle ?</li><li>Quels documents demande-t-elle : devis, facture européenne, quittance douanière, carte grise ?</li><li>Le paiement en euros vers l'Europe peut-il passer par elle ?</li><li>Quel est le coût total du crédit, assurance emprunteur comprise ?</li></ul>` },
      { titre: "Ce que nous pouvons faire pour vous", html: `<p>Nous établissons un <strong>devis détaillé ligne par ligne</strong>, que vous pouvez présenter à votre banque. Les montants des droits et taxes restent à confirmer par le transitaire.</p>` }
    ],
    sources: [S.idaratyFcr],
    action: { libelle: "Demander un devis", href: "/#contact" }
  },

  "/services/assurance-auto": {
    menu: "Assurance auto",
    titre: "Assurance auto : assurer votre voiture, du transport à la route",
    description: "Assurance pendant le transport maritime, puis assurance auto en Tunisie après la carte grise : ce qu'il faut savoir pour une voiture importée d'Europe.",
    chapo: "Une voiture importée doit être assurée à deux moments : pendant le voyage depuis l'Europe, puis sur la route en Tunisie. M&Y AUTO EXPORT n'est pas assureur : voici les points à vérifier.",
    sections: [
      { titre: "Pendant le transport : l'assurance ad valorem", html: `<p>La responsabilité légale d'un transporteur maritime est limitée : en cas de dommage, elle ne couvre souvent qu'une petite partie de la valeur. Une <strong>assurance ad valorem</strong> couvre la valeur déclarée du véhicule. Son coût se situe généralement entre <strong>0,1 % et 1 %</strong> de la valeur assurée, selon le trajet et le mode de transport.</p><p>Quand une voiture est achetée sur une plateforme européenne, elle est en général remise sur le parc du vendeur : le risque est alors à la charge de l'acheteur dès l'enlèvement, et l'assurance doit couvrir le trajet routier jusqu'au port, puis le bateau.</p>` },
      { titre: "En Tunisie : après la carte grise", html: `<p>La procédure officielle du FCR place l'assurance automobile en <strong>dernière étape</strong>, après la remise de la carte grise. Nous n'avons pas trouvé de règle officielle sur une circulation provisoire avant l'immatriculation : ne roulez pas avec le véhicule avant d'être assuré.</p>` },
      { titre: "Les questions à poser à votre assureur", html: `<ul><li>Faut-il un document particulier pour un véhicule importé (carte grise RS, attestation douanière) ?</li><li>Comment la valeur du véhicule est-elle fixée en cas de vol ou de destruction ?</li><li>Les pièces de rechange d'un modèle peu répandu en Tunisie sont-elles couvertes et disponibles ?</li><li>Quelles garanties en plus de la responsabilité civile : vol, incendie, bris de glace, tous risques ?</li></ul>` }
    ],
    sources: [S.idaratyFcr]
  },

  "/services/evaluation-prix": {
    menu: "Évaluation prix voiture",
    titre: "Évaluation du prix d'une voiture importée d'Europe",
    description: "Comment se construit le prix d'une voiture importée d'Europe en Tunisie : prix d'achat, transport, droits et taxes, frais. Méthode et outils pour l'estimer.",
    chapo: "Le prix d'une voiture importée se construit ligne par ligne. Comprendre ces lignes permet de comparer une offre en Europe avec le marché tunisien.",
    sections: [
      { titre: "Les lignes du prix", html: `<ol><li><strong>Prix d'achat en Europe,</strong> plus les frais de la plateforme et du document d'export (de 30 à 145 € selon les plateformes).</li><li><strong>Transport et assurance</strong> jusqu'au port tunisien.</li><li><strong>Droits et taxes,</strong> calculés sur la valeur en douane (prix + transport + assurance) : droit de douane, droit de consommation selon la cylindrée et le carburant, TVA (19 %, ou 7 % pour une électrique ou une hybride rechargeable), redevance douanière de 3 %.</li><li><strong>Transitaire, port et immatriculation.</strong></li><li><strong>Commission</strong> de M&amp;Y AUTO EXPORT.</li></ol><p>Les taxes sont calculées en cascade : la TVA s'applique sur la valeur augmentée des droits de douane et de consommation.</p>` },
      { titre: "Ce qui fait varier la facture", html: `<ul><li><strong>La motorisation :</strong> depuis 2026, une hybride rechargeable ou une électrique ne paie pas de droit de consommation, et seulement 7 % de TVA.</li><li><strong>La cylindrée :</strong> le droit de consommation d'une voiture thermique augmente par tranche de cylindrée.</li><li><strong>Votre régime :</strong> en FCR partiel, vous ne payez que 25 % ou 30 % des droits et taxes.</li><li><strong>L'origine du véhicule</strong> et la preuve d'origine (EUR.1), à faire confirmer par la douane.</li></ul>` },
      { titre: "Les outils", html: `<ul><li>Le <a href="https://www.douane.gov.tn/taxationveh/" rel="noopener">simulateur officiel de la douane</a> pour les droits et taxes.</li><li>Nos fiches véhicules, avec le détail du prix en quatre postes.</li><li>Un devis personnalisé, établi avec notre transitaire.</li></ul><p>Toute estimation reste indicative : la douane applique sa propre évaluation de la valeur.</p>` }
    ],
    sources: [S.simulateur, S.bnDroits, S.infirst, S.jort148],
    action: { libelle: "Voir les véhicules et leurs prix", href: "/vehicules" }
  },

  "/services/inspection-auto": {
    menu: "Inspection auto",
    titre: "Inspection auto : vérifier une voiture d'occasion avant de l'acheter",
    description: "Kilométrage, historique, dommages, batteries : comment vérifier une voiture d'occasion achetée en Europe, avant l'achat et à la livraison.",
    chapo: "Les plateformes européennes rejettent presque toute responsabilité sur leurs descriptions, kilométrage compris. Les vérifications avant l'achat et à la livraison sont donc essentielles.",
    sections: [
      { titre: "Pourquoi c'est indispensable", html: `<p>Selon des études relayées par Car-Pass, la fraude au compteur toucherait <strong>30 à 50 % des ventes de voitures d'occasion entre pays européens</strong>. Les conditions des plateformes précisent que les informations viennent du vendeur et qu'une inspection technique détaillée de chaque véhicule est impossible. Elles laissent souvent <strong>2 à 3 jours seulement</strong> pour signaler un défaut après l'enlèvement.</p>` },
      { titre: "Avant l'achat", html: `<ul><li><strong>Le rapport de la plateforme :</strong> photos, dommages déclarés, état des pneus, voyants.</li><li><strong>L'historique du kilométrage :</strong> Car-Pass pour une voiture belge, Histovec pour une voiture française, ou des services payants comme carVertical selon le pays.</li><li><strong>Le carnet d'entretien</strong> et les dernières factures.</li><li><strong>Les rappels du constructeur</strong> non effectués.</li><li><strong>Pour une électrique ou une hybride :</strong> l'état de santé de la batterie, s'il est communiqué.</li></ul>` },
      { titre: "À la livraison", html: `<p>Comparez le numéro de châssis (VIN), le kilométrage et l'état réel avec l'annonce. Notez vos réserves par écrit et photographiez tout. Le Code des obligations et contrats laisse <strong>7 jours</strong> après la réception pour signaler un défaut. Notre <a href="/conseils/telechargements">check-list de réception</a> vous guide pas à pas.</p>` },
      { titre: "En Tunisie : la visite technique ATTT", html: `<p>Avant l'immatriculation, la voiture passe dans un centre de visite technique de l'ATTT, qui délivre un <strong>certificat d'identification valable un mois</strong>. Ce contrôle identifie le véhicule ; il ne remplace pas une inspection avant l'achat.</p>` }
    ],
    sources: [S.carpass, S.histovec, S.openlaneCgv, S.openlaneFaq, S.coc647, S.idaratyFcr]
  },

  "/services/certificat-de-conformite": {
    menu: "Certificat de conformité (CoC)",
    titre: "Certificat de conformité (CoC) : faut-il l'avoir pour la Tunisie ?",
    description: "Ce qu'est le certificat de conformité européen (CoC), à quoi il sert, s'il est exigé pour importer une voiture en Tunisie et comment l'obtenir.",
    chapo: "Le certificat de conformité européen, ou CoC, atteste qu'un véhicule correspond à un type homologué dans l'Union européenne. Voici ce qu'il faut savoir pour une importation en Tunisie.",
    sections: [
      { titre: "Qu'est-ce que le CoC ?", html: `<p>Le CoC (« Certificate of Conformity ») est un document délivré par le constructeur. Il reprend les caractéristiques techniques du véhicule homologué : dimensions, masse, moteur, émissions, pneumatiques. Il sert surtout à immatriculer une voiture dans un autre pays de l'Union européenne.</p>` },
      { titre: "Est-il exigé en Tunisie ?", html: `<p>Nous n'avons trouvé <strong>aucune source officielle tunisienne qui exige le CoC</strong> pour le dédouanement d'une voiture d'occasion. L'ATTT ne mentionne un certificat de conformité que pour les véhicules neufs homologués et vendus par un concessionnaire.</p><p>Pour un FCR, la visite technique au centre de Sijoumi demande en revanche une <strong>enveloppe scellée du concessionnaire</strong> représentant la marque en Tunisie, pour environ 200 TND. Elle joue en pratique un rôle d'identification du modèle. Une marque sans représentant en Tunisie peut donc compliquer les démarches : renseignez-vous avant l'achat.</p>` },
      { titre: "Faut-il quand même le demander ?", html: `<p>Oui, quand c'est possible. Le CoC facilite l'identification du véhicule par les services techniques et donne une valeur de revente plus sûre. Mais les plateformes européennes ne le garantissent pas : il est remis avec les autres documents, souvent après le paiement et séparément du véhicule.</p>` },
      { titre: "Comment l'obtenir", html: `<p>Le CoC se demande au constructeur, par son site ou par un concessionnaire de la marque, avec le numéro de châssis (VIN). Il est souvent payant, et le délai dépend du constructeur : demandez-le dès l'achat.</p>` }
    ],
    sources: [S.idaratyFcr, S.openlaneCgv]
  }
};
