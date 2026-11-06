// Textes affichés aux clients par l'accueil, les cartes et les fiches (chantier 3). Une seule source, en français ;
// l'arabe viendra dans un objet voisin. Formulations interdites (loi 92-117) : « meilleur prix », « tout compris ».
// Aucun fait réglementaire ni chiffré non vérifié : délais, taux et garanties restent au devis.
export const fr = {
  // En-tête
  menu_vehicules: "Véhicules",
  menu_comment: "Comment ça marche",
  menu_prix: "Nos prix",
  menu_questions: "Questions",
  compte_titre: "Mon compte",
  compte_action: "Se connecter",
  whatsapp: "WhatsApp",
  whatsapp_aria: "Nous écrire sur WhatsApp (nouvel onglet)",

  // Hero
  hero_titre: "Votre voiture d'Europe, livrée en Tunisie.",
  hero_sous_titre: "Prix estimé, détail complet.",

  // Choix du public
  public_groupe: "Votre situation",
  public_resident: "J'habite en Tunisie · TND",
  public_tre: "À l'étranger · €",

  // Connexion avec Google (accueil, /vendre, formulaire de mandat)
  google_bouton: "Continuer avec Google",
  connexion_ou: "Ou",
  connexion_refusee: "Connexion avec Google refusée. Réessayez ou utilisez votre e-mail.",
  connexion_annulee: "Connexion avec Google annulée.",
  connexion_limite: "Trop d'inscriptions depuis cette connexion. Réessayez dans une heure.",

  // Déposer une annonce (accueil)
  deposer_bouton: "Déposer une annonce",
  deposer_quitter: "Quitter",
  deposer_bonjour: "Bonjour !",
  deposer_texte: "Connectez-vous ou créez un compte pour déposer votre annonce.",
  deposer_connexion: "Me connecter",
  deposer_inscription: "Créer un compte",

  // Bandeau d'atouts et pied de page
  atout_prix_titre: "Prix détaillé ligne par ligne",
  atout_prix_texte: "Achat, transport, douane, frais et commission : chaque ligne est visible. Devis définitif avec notre transitaire.",
  atout_mandat_titre: "Achat sur mandat",
  atout_mandat_texte: "Nous achetons le véhicule en Europe pour votre compte, sur mandat écrit.",
  pied_mention: "Achat sur mandat, devis sur demande",

  // Badges d'éligibilité
  badge_resident: "Importable par un résident",
  badge_fcr: "Tunisiens à l'étranger (FCR)",

  // Mentions de prix
  prix_sur_demande: "Estimation sur demande",
  prix_resident_devis: "Prix résident sur devis",
  prix_resident_explication: "L'importation par un résident dépend d'un régime en attente de textes d'application. Contactez-nous pour un devis.",
  prix_reserve_tre: "Réservé aux Tunisiens résidant à l'étranger",
  prix_estime: "Prix estimé",
  prix_mention: "Prix estimé · taux du {date} · Devis définitif après vérification par notre transitaire",
  prix_detail: "Détail du calcul",
  prix_total: "Total estimé",
  prix_fcr: "Dédouanement FCR estimé",
  contact_whatsapp: "Demander sur WhatsApp",
  contact_email: "Nous contacter",
  contact_message: "Bonjour, je souhaite un devis pour le véhicule réf. {reference}.",
  voir_fiche: "Voir la fiche",
  liste_vide: "Aucun véhicule en ligne pour le moment.",

  // Comment ça marche
  comment_titre: "Comment ça marche",
  etape1_titre: "1 · Choisir",
  etape1_texte: "Choisissez un véhicule sur le site, ou décrivez-nous celui que vous cherchez en Europe.",
  etape2_titre: "2 · Mandat et acompte",
  etape2_texte: "Vous nous confiez un mandat d'achat écrit et versez un acompte, dont le montant figure au devis.",
  etape3_titre: "3 · Achat puis livraison",
  etape3_texte: "Nous achetons le véhicule pour votre compte, puis organisons le transport et les formalités avec notre transitaire jusqu'à la livraison en Tunisie.",

  // Nos prix
  prix_titre: "Nos prix",
  prix_intro: "Chaque estimation est construite ligne par ligne, à partir du prix d'achat du véhicule en Europe et du taux EUR → TND du jour.",
  prix_ligne_achat: "Prix d'achat du véhicule en Europe",
  prix_ligne_transport: "Transport et assurance jusqu'en Tunisie",
  prix_ligne_douane: "Droits et taxes de douane selon votre régime : droits de douane, droit de consommation, TVA, redevance douanière",
  prix_ligne_frais: "Frais de transitaire et de port",
  prix_ligne_immatriculation: "Immatriculation, pour un résident",
  prix_ligne_commission: "Notre commission",
  prix_note: "Les montants dépendent du véhicule et de votre situation. D'autres taxes ou frais peuvent s'ajouter après vérification : le devis définitif, établi avec notre transitaire, les détaille.",

  // Témoignages
  temoignages_titre: "Ils ont reçu leur voiture",

  // Demande d'achat sur mandat (chantier 4)
  mandat_bouton: "Je veux ce véhicule",
  mandat_titre: "Demande d'achat sur mandat",
  mandat_intro: "Vous fixez un prix maximum. Nous achetons le véhicule pour votre compte s'il est obtenu à ce prix, puis organisons le transport et le dédouanement.",
  mandat_residence: "Où habitez-vous ?",
  mandat_resident: "En Tunisie",
  mandat_tre: "À l'étranger",
  mandat_pays: "Pays de résidence",
  mandat_fcr_question: "Avez-vous déjà bénéficié du régime FCR ces 10 dernières années ?",
  mandat_oui: "Oui",
  mandat_non: "Non",
  mandat_fcr_info: "Le régime FCR ne s'accorde qu'une fois tous les 10 ans (décret n° 2024-370). Nous vérifierons votre situation avec vous.",
  mandat_prix_max: "Prix maximum accepté ({devise})",
  mandat_prix_aide: "Montant entier. Nous n'achetons pas au-delà.",
  mandat_telephone: "Téléphone ou WhatsApp",
  mandat_lire: "Lire le mandat, les CGV et les conditions de l'acompte",
  mandat_texte_mandat: "Mandat d'achat",
  mandat_texte_cgv: "Conditions générales",
  mandat_texte_acompte: "Conditions de l'acompte",
  mandat_accepte: "J'ai lu et j'accepte le mandat d'achat, les conditions générales et les conditions de l'acompte.",
  mandat_envoyer: "Envoyer ma demande",
  mandat_connexion: "Connectez-vous pour envoyer votre demande",
  mandat_email: "E-mail",
  mandat_mot_de_passe: "Mot de passe",
  mandat_se_connecter: "Se connecter",
  mandat_creer_compte: "Créer un compte",
  mandat_google: "Continuer avec Google",
  mandat_chargement: "Chargement…",
  mandat_fermer: "Fermer",
  mandat_succes: "Demande envoyée. Nous vérifions votre éligibilité et vous indiquons le montant de l'acompte.",
  mandat_suivi: "Suivre mes demandes",
  mandat_indisponible: "Ce véhicule n'est pas ouvert à l'achat sur mandat.",
  mandat_deja_en_cours: "Vous avez déjà une demande en cours pour ce véhicule.",
  mandat_annulation_impossible: "Cette demande ne peut plus être annulée en ligne : contactez-nous.",
  mandat_mes_titre: "Mes demandes d'achat",
  mandat_mes_vide: "Aucune demande pour le moment.",
  mandat_mes_connexion: "Connectez-vous depuis l'accueil pour voir vos demandes.",
  mandat_prix_max_court: "Prix maximum",
  mandat_acompte: "Acompte demandé",
  mandat_annuler: "Annuler ma demande",
  mandat_annuler_confirmer: "Annuler cette demande ?",
  mandat_reference: "Réf.",
  statut_demande: "Demande reçue",
  statut_eligibilite_verifiee: "Éligibilité vérifiée",
  statut_acompte_recu: "Acompte reçu",
  statut_achat_en_cours: "Achat en cours",
  statut_achete: "Véhicule acheté",
  statut_non_obtenu: "Véhicule non obtenu",
  statut_livre: "Livré",
  statut_annule: "Annulée",

  // Questions
  questions_titre: "Questions",
  faq1_question: "Comment fonctionne l'achat sur mandat ?",
  faq1_reponse: "Vous choisissez un véhicule et nous confiez un mandat d'achat écrit. Nous l'achetons pour votre compte en Europe, puis organisons le transport et les formalités jusqu'à la livraison en Tunisie.",
  faq2_question: "Le prix affiché est-il définitif ?",
  faq2_reponse: "Non. C'est une estimation, calculée à partir du prix d'achat, des frais et du taux de change du jour. Le devis définitif vient de notre transitaire, après vérification.",
  faq3_question: "Le régime FCR, c'est pour qui ?",
  faq3_reponse: "Le FCR concerne les Tunisiens résidant à l'étranger. Selon la Douane, il s'applique à un véhicule de 5 ans au plus. Conditions à vérifier avec nous.",
  faq4_question: "J'habite en Tunisie : quel prix ?",
  faq4_reponse: "L'importation par un résident dépend d'un régime en attente de textes d'application. Les prix résidents sont donc sur devis : contactez-nous.",
  faq5_question: "Quel est le délai de livraison ?",
  faq5_reponse: "Il varie selon le véhicule, le pays d'achat et le transport. Nous vous l'indiquons au devis."
};

export const NOMBRE_QUESTIONS = 5;

// Texte d'une clé, avec ses valeurs {nom} remplacées. Texte brut : l'appelant l'échappe avant de l'insérer en HTML.
export function t(cle, valeurs = {}) {
  const modele = fr[cle];
  if (modele === undefined) throw new Error(`Texte inconnu : ${cle}`);
  return modele.replace(/\{(\w+)\}/g, (_, nom) => String(valeurs[nom] ?? ""));
}

// Textes lus par le JavaScript de l'accueil, servis dans un <script type="application/json" id="textes">.
export const TEXTES_NAVIGATEUR = ["compte_titre", "compte_action", "mandat_bouton", "mandat_mes_titre", "connexion_refusee", "connexion_annulee", "connexion_limite"];
