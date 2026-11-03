// Contrat commun au navigateur et au Worker. Les valeurs inconnues sont rejetées côté serveur.
export const PHOTO_KINDS = ['front','rear','left','right','interior','dashboard','engine','trunk','defects','exterior'];
export const REQUIRED_PHOTOS = ['front','rear','left','right','interior','dashboard'];
export const FILE_LABELS = {identity:'Identification privée',front:'Avant',rear:'Arrière',left:'Côté gauche',right:'Côté droit',interior:'Intérieur',dashboard:'Tableau de bord et kilométrage',engine:'Compartiment moteur',trunk:'Coffre',defects:'Dommages visibles',exterior:'Extérieur',registration:'Certificat d’immatriculation',ownership:'Justificatif de propriété ou de droit de vente',diagnostic:'Diagnostic PDF',roadworthiness:'Contrôle technique',service_book:'Carnet d’entretien',invoice:'Facture',other:'Autre justificatif'};
export const SYSTEMS = {engine:'Moteur',transmission:'Boîte de vitesses',brakes:'Freinage',suspension:'Suspension',steering:'Direction',electronics:'Électronique',battery:'Batterie',body:'Carrosserie',tyres:'Pneumatiques',defects:'Défauts constatés'};
export const ZONES = {bumpers:'Pare-chocs',hood:'Capot',doors:'Portières',fenders:'Ailes',roof:'Toit',trunk:'Coffre',wheels:'Jantes',glass:'Vitrages'};
export const DAMAGE_TYPES = ['rayure','bosse','fissure','impact','corrosion','autre'];
export const SEVERITIES = ['léger','modéré','important'];
export const EQUIPMENT = {
 'Confort':['Régulateur de vitesse','Accès et démarrage sans clé','Vitres électriques'],
 'Climatisation':['Climatisation manuelle','Climatisation automatique','Climatisation multizone'],
 'Multimédia':['Bluetooth','Apple CarPlay','Android Auto','Système audio premium'],
 'Navigation':['GPS intégré','Affichage tête haute'],
 'Toit':['Toit ouvrant','Toit panoramique'],
 'Aides à la conduite':['Régulateur adaptatif','Maintien dans la voie','Surveillance angle mort'],
 'Sécurité':['ABS','ESP','Airbags','Freinage automatique d’urgence'],
 'Stationnement':['Radar avant','Radar arrière','Caméra de recul','Caméra 360°'],
 'Sièges':['Sièges chauffants','Sièges électriques','Sellerie cuir','Sièges ventilés'],
 'Éclairage':['Phares LED','Phares xénon','Feux automatiques'],
 'Jantes et pneumatiques':['Jantes alliage','Roue de secours','Pneus hiver']
};
// [clé, libellé, type, maximum] ; les unités apparaissent dans les libellés.
export const TECH_FIELDS = [
 ['engineDescription','Motorisation','text'],['fuel','Énergie','select',['Essence','Diesel','Hybride','Hybride rechargeable','Électrique','GPL','Autre']],
 ['powerKw','Puissance (kW)','number',2000],['powerHp','Puissance (chevaux)','number',3000],['displacementCc','Cylindrée (cm³)','number',20000],
 ['gearbox','Boîte de vitesses','select',['Manuelle','Automatique','Robotisée','Sans boîte conventionnelle']],['gearCount','Nombre de rapports','number',20],
 ['drivetrain','Transmission','select',['Traction','Propulsion','4 roues motrices']],['bodyType','Carrosserie','select',['Berline','SUV','Break','Monospace','Citadine','Coupé','Cabriolet','Utilitaire','Autre']],
 ['doors','Nombre de portes','number',9],['seats','Nombre de places','number',60],['euroStandard','Norme Euro','select',['Euro 1','Euro 2','Euro 3','Euro 4','Euro 5','Euro 6','Euro 6d','Euro 6e','Non applicable']],
 ['co2GKm','Émissions CO₂ (g/km)','number',2000],['exteriorColor','Couleur extérieure','text'],['interiorColor','Couleur intérieure','text']
];
export const HISTORY_FIELDS = [
 ['condition','État du véhicule','select',['Neuf','Occasion','Accidenté','Endommagé']],
 ['serviceHistory','Historique d’entretien','textarea'],['lastServiceDate','Date du dernier entretien','date'],['lastServiceKm','Kilométrage du dernier entretien','number',10000000],
 ['previousOwners','Propriétaires précédents','number',100],['knownAccidents','Accidents connus (indiquer Aucun le cas échéant)','textarea'],
 ['majorRepairs','Réparations importantes','textarea'],['roadworthinessApplicable','Contrôle technique applicable','select',['Oui','Non']],
 ['roadworthinessUntil','Validité du contrôle technique','date'],['mechanicalCondition','État mécanique déclaré','textarea'],['runningCondition','État de fonctionnement','select',['Roulant','Non roulant','À contrôler']]
];
export const TEXT_FIELDS = ['trim','productionDate','firstRegistrationCountry','description','diagnosticReference','diagnosticVin','diagnosticSummary',...TECH_FIELDS.filter(f=>f[2]!=='number').map(f=>f[0]),...HISTORY_FIELDS.filter(f=>f[2]!=='number').map(f=>f[0]),'auctionStart','auctionEnd'];
export const NUMBER_FIELDS = [...TECH_FIELDS.filter(f=>f[2]==='number'),...HISTORY_FIELDS.filter(f=>f[2]==='number'),['diagnosticMileageKm','Kilométrage relevé au diagnostic','number',10000000],['reservePriceTnd','Prix de réserve (TND)','number',100000000],['priceAmount','Prix demandé','number',100000000]];
export function validDate(value, past=false) {
 return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value && (!past || value<=new Date().toISOString().slice(0,10));
}
export function sanitizeExtra(src,fail) {
 const d={};
 for(const key of TEXT_FIELDS) {
  if(src[key]!=null && typeof src[key]!=='string') fail(400,`Texte attendu : ${key}`);
  d[key]=String(src[key]||'').trim().slice(0,['description','diagnosticSummary','serviceHistory','knownAccidents','majorRepairs','mechanicalCondition'].includes(key)?3000:200);
 }
 for(const [key,label,,max] of NUMBER_FIELDS) {
  d[key]=src[key]==null || src[key]==='' ? null : Number(src[key]);
  if(d[key]!==null && (!Number.isFinite(d[key]) || d[key]<0 || d[key]>max || (key!=='priceAmount' && !Number.isInteger(d[key])))) fail(400,`${label} : nombre invalide.`);
 }
 for(const [key,label,type,options] of [...TECH_FIELDS,...HISTORY_FIELDS]) if(type==='select' && d[key] && !options.includes(d[key])) fail(400,`${label} : valeur invalide.`);
 for(const key of ['productionDate','lastServiceDate']) if(d[key] && !validDate(d[key],true)) fail(400,`Date invalide ou future : ${key}`);
 if(d.roadworthinessUntil && !validDate(d.roadworthinessUntil)) fail(400,'Date de contrôle technique invalide.');
 d.priceCurrency=src.priceCurrency || 'TND'; if(!['EUR','TND'].includes(d.priceCurrency)) fail(400,'Devise attendue : EUR ou TND.');
 d.allowOffers=src.allowOffers===true;
 d.equipment=Array.isArray(src.equipment)?src.equipment:[];
 const allowed=Object.values(EQUIPMENT).flat();
 if(d.equipment.length>allowed.length || d.equipment.some(v=>!allowed.includes(v))) fail(400,'Équipement inconnu.');
 d.equipment=[...new Set(d.equipment)];
 if(src.damages!=null && !Array.isArray(src.damages)) fail(400,'Liste de dommages attendue.');
 if((src.damages||[]).length>30) fail(400,'30 dommages maximum.');
 d.damages=(src.damages||[]).map((x,i)=>{
  if(!x || !Object.hasOwn(ZONES,x.zone) || !DAMAGE_TYPES.includes(x.type) || !SEVERITIES.includes(x.severity)) fail(400,'Zone, type ou gravité du dommage invalide.');
  const description=typeof x.description==='string'?x.description.trim().slice(0,2000):'';
  const photoIds=Array.isArray(x.photoIds)?[...new Set(x.photoIds)]:[];
  if(photoIds.length>40 || photoIds.some(id=>typeof id!=='string' || !/^[a-f0-9]{32}$/.test(id))) fail(400,'Photo de dommage invalide.');
  return {id:String(i),zone:x.zone,type:x.type,severity:x.severity,description,photoIds};
 });
 d.diagnosticVin=d.diagnosticVin.toUpperCase();
 return d;
}
