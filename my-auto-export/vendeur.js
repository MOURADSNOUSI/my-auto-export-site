import * as S from './seller-schema.js';
const admin=document.body.dataset.admin==='true',prefix=admin?'/api/admin/seller/':'/api/seller/';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const states={draft:'Brouillon',submitted:'Soumis',reviewing:'En cours de vérification',corrections:'Corrections demandées',approved:'Approuvé — publication à autoriser',rejected:'Refusé',published:'Publié',archived:'Archivé'};
const countryNames=new Intl.DisplayNames(['fr'],{type:'region'});
const countries='AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
const locations=['Ariana','Béja','Ben Arous','Bizerte','Gabès','Gafsa','Jendouba','Kairouan','Kasserine','Kébili','Le Kef','Mahdia','La Manouba','Médenine','Monastir','Nabeul','Sfax','Sidi Bouzid','Siliana','Sousse','Tataouine','Tozeur','Tunis','Zaghouan'];
const stepNames=['Identification','Technique','Équipements','Historique','Photos','Dommages','Diagnostic et documents','Vente et aperçu'];
const stepIds=['identification-step','model-step','equipment-step','history-step','photos-step','damage-step','diagnostic-step','sale-step'];
let current=null,rows=[],garages=[],filter='all',view='list',step=0,dirty=false,busy=false,damages=[];
function message(v=''){$('message').textContent=v;}
async function api(path,options={}){
 const opts={...options};if(opts.body&&!(opts.body instanceof File)){opts.headers={'Content-Type':'application/json',...opts.headers};opts.body=JSON.stringify(opts.body);}
 const r=await fetch(path,opts),d=await r.json();if(!r.ok)throw new Error([d.error,...(d.missing||[])].join('\n'));return d;
}
const safely=fn=>async event=>{if(event?.type==='submit')event.preventDefault();try{await fn(event);}catch(e){message(e.message);}};
const label=r=>r.listingState==='sold'?'Vendu':r.listingState==='archived'?'Archivé':states[r.status];
const editable=r=>['draft','corrections','rejected'].includes(r.status);
function fileLink(f){return `${prefix}files/${f.id}`;}
function photos(){return current.files.filter(f=>S.PHOTO_KINDS.includes(f.kind));}
function field(key,title,type='text',options={}){
 let value=current.data[key]??'';
 if(type==='datetime-local'&&value){const dt=new Date(value);if(Number.isFinite(dt.getTime())){const pad=n=>String(n).padStart(2,'0');value=`${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;}}
 const attrs=`${options.max?`max="${options.max}"`:''} ${type==='number'?`min="0" step="${key==='priceAmount'?'.01':'1'}"`:''}`;
 if(type==='textarea')return `<label>${esc(title)}<textarea name="${key}" maxlength="3000">${esc(value)}</textarea></label>`;
 if(type==='select')return `<label>${esc(title)}<select name="${key}"><option value="">Choisir</option>${options.values.map(v=>`<option value="${esc(v)}" ${value===v?'selected':''}>${esc(key==='saleType'?{sale:'Vente directe',auction:'Vente aux enchères'}[v]:v)}</option>`).join('')}</select></label>`;
 return `<label>${esc(title)}<input name="${key}" type="${type}" value="${esc(value)}" ${attrs} maxlength="${['vin','diagnosticVin'].includes(key)?17:120}"></label>`;
}
function countryField(key,title){return `<label>${esc(title)}<select name="${key}"><option value="">Choisir un pays</option>${[...new Set(countries)].map(code=>({code,name:countryNames.of(code)})).sort((a,b)=>a.name.localeCompare(b.name,'fr')).map(({code,name})=>`<option value="${code}" ${current.data[key]===code?'selected':''}>${esc(name)}</option>`).join('')}</select></label>`;}
function fields(schema){return schema.map(([k,l,t,max])=>field(k,l,t,t==='select'?{values:max}:{max})).join('');}
function eventList(r){return `<ol class="audit-list">${(r.events||[]).map(e=>`<li><time>${esc(new Date(e.at).toLocaleString('fr-FR'))}</time> — ${esc(states[e.to_stage]||e.action)}${e.message?`<p>${esc(e.message)}</p>`:''}</li>`).join('')||'<li>Aucune décision.</li>'}</ol>`;}
async function refresh(){
 let user;try{({user}=await api('/api/me'));}catch(e){$('auth').hidden=false;return;}
 $('auth').hidden=Boolean(user);$('logout').hidden=!user;if(!user)return;
 if(admin&&user.role!=='admin'){message('Accès réservé aux administrateurs.');return;}
 garages=(await api(prefix+'garages')).garages;
 if(admin){
  $('garages-admin').hidden=false;
  $('document-rules-admin').hidden=false;
  const {rules}=await api(prefix+'document-rules');$('document-rule-list').innerHTML=rules.map(r=>`<li>${esc(r.country_code)} · ${esc(r.seller_type)} · ${esc(S.FILE_LABELS[r.kind])} : ${r.required?'Obligatoire':'Désactivé'}</li>`).join('');
  $('garage-list').innerHTML=garages.map(g=>`<li>${esc(g.name)} — ${esc(g.address)} — ${esc(g.contact)}<br>N° ${esc(g.professional_number)} · agrément jusqu’au ${esc(g.valid_until||'non renseigné')} · ${g.active?'Actif':'Désactivé'} <button data-garage="${g.id}" data-active="${!g.active}">${g.active?'Désactiver':'Réactiver'}</button></li>`).join('');
 }else{
  $('profile-section').hidden=false;const {profile}=await api(prefix+'profile');
  for(const k of ['name','phone','address'])$('profile-form').elements[k].value=profile?.[k]||user[k]||'';
  $('profile-form').elements.sellerType.value=profile?.seller_type||'individual';$('profile-form').elements.professionalNumber.value=profile?.professional_number||'';
 }
 rows=(await api(prefix+'submissions')).submissions;$('workspace').hidden=false;renderList();
}
function renderList(){
 let selected=filter==='all'?rows:rows.filter(r=>r.listingState===filter);
 for(const b of document.querySelectorAll('[data-vehicle-filter]')){const k=b.dataset.vehicleFilter;b.setAttribute('aria-pressed',String(filter===k));b.querySelector('[data-vehicle-count]').textContent=k==='all'?rows.length:rows.filter(r=>r.listingState===k).length;}
 for(const b of document.querySelectorAll('[data-seller-view]'))b.setAttribute('aria-pressed',String(b.dataset.sellerView===view));
 if(view==='draft')selected=selected.filter(r=>r.status==='draft');
 if(view==='diagnostics'||view==='documents'){
  const entries=selected.flatMap(r=>r.files.filter(f=>view==='diagnostics'?f.kind==='diagnostic':!S.PHOTO_KINDS.includes(f.kind)).map(f=>`<article><h3>${esc(r.data.make)} ${esc(r.data.model)} — ${esc(S.FILE_LABELS[f.kind])}</h3><button data-access="${f.id}">Téléchargement sécurisé (5 minutes)</button><button data-open="${r.id}">Ouvrir le dossier</button></article>`));
  $('submissions').innerHTML=entries.join('')||'<p>Aucune pièce disponible.</p>';return;
 }
 if(view==='messages')selected=selected.filter(r=>r.feedback||(r.events||[]).some(e=>e.message));
 const empty={all:'Aucun dossier pour le moment.',active:'Aucun véhicule actif.',sold:'Aucun véhicule vendu.',archived:'Aucun véhicule archivé.'};
 $('submissions').innerHTML=selected.map(r=>`<article><span class="status">${esc(label(r))}</span><h3>${esc(r.data.make||'Nouveau véhicule')} ${esc(r.data.model)}</h3>${admin?`<p>${esc(r.seller_name)} · ${esc(r.seller_email)}</p>`:''}${r.feedback?`<p class="warning">${esc(r.feedback)}</p>`:''}${view==='validation'||view==='messages'?eventList(r):''}<button data-open="${r.id}">${admin?'Examiner':'Ouvrir le dossier'}</button></article>`).join('')||`<p>${empty[filter]}</p>`;
}
function formData(){
 if(!editable(current))return structuredClone(current.data);
 const f=$('vehicle-form'),d=Object.fromEntries(new FormData(f));
 if(d.location==='other')d.location=d.locationOther;
 for(const key of ['auctionStart','auctionEnd'])if(d[key])d[key]=new Date(d[key]).toISOString();
 d.allowOffers=f.elements.allowOffers.checked;
 d.equipment=[...f.querySelectorAll('[name=equipment]:checked')].map(e=>e.value);
 d.observations=Object.fromEntries(Object.keys(S.SYSTEMS).map(k=>[k,d['obs-'+k]]));
 d.damages=damages;
 if(d.priceCurrency==='TND'&&d.priceAmount)d.priceTnd=Number(d.priceAmount);
 return d;
}
async function saveDraft(){
 if(!current||!editable(current))return;
 const {submission}=await api(prefix+'submissions/'+current.id,{method:'PUT',body:{revision:current.revision,data:formData()}});current=submission;dirty=false;
}
function initialValid(){
 const e=$('vehicle-form').elements,date=e.firstRegistrationDate.value;
 return /^[A-HJ-NPR-Z0-9]{17}$/.test(e.vin.value.trim().toUpperCase())&&Boolean(e.location.value&&(e.location.value!=='other'||e.locationOther.value.trim()))&&Boolean(e.originCountry.value)&&(!date||S.validDate(date,true));
}
function showStep(i){
 step=i;stepIds.forEach((id,k)=>$(id).hidden=k!==i);
 document.querySelectorAll('[data-step]').forEach((b,k)=>{b.setAttribute('aria-current',k===i?'step':'false');b.disabled=busy;});
 $('progress').value=i+1;$('progress-label').textContent=`Étape ${i+1} sur ${stepNames.length} — ${stepNames[i]}`;
 $('previous-step').hidden=i===0;$('next-step').hidden=i===0||i===7;$('continue-identification').hidden=i!==0;
 $('submit-dossier').hidden=i!==7||!editable(current);$('save-draft').hidden=!editable(current);
 $('continue-identification').disabled=!initialValid()||busy;
 $('save-draft').disabled=busy;$('next-step').disabled=busy;$('previous-step').disabled=busy;
 document.querySelectorAll('[data-upload]').forEach(input=>input.disabled=busy||!editable(current));
 if(i===7)renderPreview();
}
function renderPreview(){
 const d=formData();
 $('preview').innerHTML=`<h3>Aperçu avant soumission</h3><p><strong>${esc(d.make)} ${esc(d.model)} ${esc(d.trim)}</strong> · ${esc(d.year)} · ${esc(d.mileageKm)} km</p><p>${esc(d.description)}</p><p>${esc(d.priceAmount||d.priceTnd)} ${esc(d.priceCurrency)} · ${d.saleType==='auction'?'Enchères (ouverture après décision administrative)':'Vente directe'}</p><p>${esc((d.equipment||[]).join(' · '))}</p><p>${photos().length} photo(s), ${damages.length} dommage(s) déclaré(s).</p><p>Le VIN, la plaque et les documents personnels ne seront pas publics. Cet aperçu ne constitue pas une publication.</p>`;
}
async function compress(file){
 if(!file.type.startsWith('image/'))return file;
 const bitmap=await createImageBitmap(file),scale=Math.min(1,2560/Math.max(bitmap.width,bitmap.height));
 const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.86));
 if(!blob)throw new Error('Impossible de préparer cette photo.');return new File([blob],'photo.jpg',{type:'image/jpeg'});
}
async function upload(list,kind){
 if(busy||!list.length)return;
 busy=true;showStep(step);
 try{
  await saveDraft();
  for(let file of list){
   if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type))throw new Error('Format non autorisé.');
   if(file.size>10*1024*1024)throw new Error('10 Mo maximum par fichier avant compression.');
   if(S.PHOTO_KINDS.includes(kind))file=await compress(file);
   const r=await api(prefix+'submissions/'+current.id+'/files?kind='+kind,{method:'POST',body:file,headers:{'Content-Type':file.type}});current=r.submission;
  }
  const id=current.id,keep=step;await refresh();await openSubmission(id,keep);message('Pièces enregistrées dans le stockage privé.');
 }finally{busy=false;if($('progress'))showStep(step);}
}
function photoCards(canEdit){
 return photos().map((f,i)=>`<article class="seller-photo" ${canEdit?'draggable="true"':''} data-photo="${f.id}"><img src="${fileLink(f)}?preview=1" alt="${esc(S.FILE_LABELS[f.kind])}" loading="lazy"><p>${esc(S.FILE_LABELS[f.kind])}${f.is_primary?' · Principale':''}</p>${canEdit?`<div class="actions"><button type="button" data-photo-main="${f.id}">Photo principale</button><button type="button" data-photo-move="${f.id}" data-direction="-1" ${i===0?'disabled':''} aria-label="Déplacer la photo ${i+1} vers la gauche">←</button><button type="button" data-photo-move="${f.id}" data-direction="1" ${i===photos().length-1?'disabled':''} aria-label="Déplacer la photo ${i+1} vers la droite">→</button><button type="button" data-remove="${f.id}">Supprimer</button></div>`:''}</article>`).join('');
}
function damagePanel(){
 return `<p>Sélectionnez une zone du schéma générique ou de la liste pour déclarer un dommage. Si aucun dommage n’est connu, laissez la liste vide.</p><svg class="car-diagram" viewBox="0 0 600 240" role="img" aria-label="Schéma original du véhicule vu de dessus"><rect x="70" y="35" width="460" height="170" rx="65" fill="#e4ebe6" stroke="#23755b" stroke-width="3"/><rect x="210" y="58" width="180" height="124" rx="32" fill="#c3d7cb" stroke="#23755b"/><path d="M210 58L180 86V154L210 182M390 58L420 86V154L390 182" fill="none" stroke="#23755b" stroke-width="3"/>${Object.keys(S.ZONES).map((zone,i)=>{const positions=[[85,120],[155,120],[300,45],[460,60],[300,120],[460,120],[145,200],[365,120]];const [x,y]=positions[i];return `<g data-zone="${zone}" tabindex="0" role="button" aria-label="${esc(S.ZONES[zone])}"><circle cx="${x}" cy="${y}" r="17" fill="#23755b"/><text x="${x}" y="${y+5}" text-anchor="middle" fill="white">${i+1}</text></g>`;}).join('')}</svg><div class="zone-list">${Object.entries(S.ZONES).map(([k,v],i)=>`<button type="button" data-zone="${k}">${i+1}. ${esc(v)}</button>`).join('')}</div><div id="damage-editor"></div><div id="damages-list"></div>`;
}
function renderDamages(){
 $('damages-list').innerHTML=damages.map((x,i)=>`<article><strong>${esc(S.ZONES[x.zone])} — ${esc(x.type)} · ${esc(x.severity)}</strong><p>${esc(x.description)}</p><p>${x.photoIds.length} photo(s) associée(s)</p>${editable(current)?`<button type="button" data-damage-edit="${i}">Modifier</button><button type="button" data-damage-remove="${i}">Supprimer</button>`:''}</article>`).join('')||'<p>Aucun dommage déclaré.</p>';
}
function editDamage(zone,index=null){
 if(!editable(current))return;
 const d=index===null?{zone,type:'rayure',severity:'léger',description:'',photoIds:[]}:damages[index];
 $('damage-editor').innerHTML=`<fieldset><legend>${esc(S.ZONES[zone])}</legend><label>Type<select id="damage-type">${S.DAMAGE_TYPES.map(v=>`<option ${v===d.type?'selected':''}>${esc(v)}</option>`).join('')}</select></label><label>Gravité<select id="damage-severity">${S.SEVERITIES.map(v=>`<option ${v===d.severity?'selected':''}>${esc(v)}</option>`).join('')}</select></label><label>Description<textarea id="damage-description" maxlength="2000">${esc(d.description)}</textarea></label><p>Photos justificatives de ce dossier :</p>${photos().map(f=>`<label class="check"><input type="checkbox" data-damage-photo="${f.id}" ${d.photoIds.includes(f.id)?'checked':''}>${esc(S.FILE_LABELS[f.kind])} — photo ${photos().indexOf(f)+1}</label>`).join('')||'<p>Ajoutez des photos à l’étape précédente.</p>'}<button type="button" id="save-damage">Enregistrer le dommage</button></fieldset>`;
 $('save-damage').onclick=()=>{
  const description=$('damage-description').value.trim(),photoIds=[...document.querySelectorAll('[data-damage-photo]:checked')].map(e=>e.dataset.damagePhoto);
  if(!description||!photoIds.length){message('Décrivez le dommage et sélectionnez au moins une photo.');return;}
  const entry={zone,type:$('damage-type').value,severity:$('damage-severity').value,description,photoIds};
  if(index===null)damages.push(entry);else damages[index]=entry;dirty=true;$('damage-editor').innerHTML='';renderDamages();
 };
}
async function openSubmission(id,requestedStep=null){
 const detail=await api(prefix+'submissions/'+id);current=detail.submission;damages=structuredClone(current.data.damages||[]);dirty=false;
 $('editor').hidden=false;$('editor').dataset.submissionId=id;
 if(admin){renderAdmin(detail);return;}
 const d=current.data,canEdit=editable(current),other=d.location&&!locations.includes(d.location);
 const uploads=Object.entries(S.FILE_LABELS).filter(([kind])=>!S.PHOTO_KINDS.includes(kind));
 const initial=`<div class="grid">${field('make','Marque')}${field('model','Modèle')}${field('trim','Version et finition')}${field('vin','Numéro de châssis *')}${field('licensePlate','Plaque d’immatriculation')}${field('firstRegistrationDate','Date de première immatriculation','date',{max:new Date().toISOString().slice(0,10)})}${field('productionDate','Date de production (facultative)','date')}${field('year','Année','number',{max:2100})}${field('mileageKm','Kilométrage','number',{max:10000000})}${countryField('originCountry','Pays d’origine *')}${countryField('firstRegistrationCountry','Pays de première immatriculation')}<label>Lieu *<select name="location"><option value="">Choisir</option>${locations.map(v=>`<option ${d.location===v?'selected':''}>${esc(v)}</option>`).join('')}<option value="other" ${other?'selected':''}>Autre lieu / à l’étranger</option></select></label><label id="custom-location" ${other?'':'hidden'}>Préciser le lieu<input name="locationOther" value="${other?esc(d.location):''}" maxlength="120"></label></div><p class="note">VIN : 17 caractères, sans I, O ni Q. Les champs marqués * sont nécessaires pour poursuivre. Les coordonnées de localisation restent privées.</p><button type="button" id="cancel-identification">Annuler</button>`;
 $('editor').innerHTML=`<h2>Mon véhicule</h2><p class="status">${esc(label(current))}</p>${current.feedback?`<p class="warning">${esc(current.feedback)}</p>`:''}<p id="progress-label" aria-live="polite"></p><progress id="progress" max="8"></progress><nav class="wizard-nav" aria-label="Étapes du formulaire">${stepNames.map((n,i)=>`<button type="button" data-step="${i}">${i+1}. ${esc(n)}</button>`).join('')}</nav><form id="vehicle-form"><fieldset ${canEdit?'':'disabled'}>
 <div id="identification-step"><h3>1. Identifier le véhicule</h3>${initial}</div>
 <div id="model-step"><h3>2. Caractéristiques techniques</h3><div class="grid">${fields(S.TECH_FIELDS)}</div></div>
 <div id="equipment-step"><h3>3. Équipements</h3><label>Rechercher un équipement<input id="equipment-search" type="search"></label>${Object.entries(S.EQUIPMENT).map(([category,items])=>`<fieldset class="equipment-category"><legend>${esc(category)}</legend>${items.map(v=>`<label class="check equipment-choice"><input type="checkbox" name="equipment" value="${esc(v)}" ${(d.equipment||[]).includes(v)?'checked':''}>${esc(v)}</label>`).join('')}</fieldset>`).join('')}</div>
 <div id="history-step"><h3>4. Historique et entretien</h3><div class="grid">${fields(S.HISTORY_FIELDS)}</div></div>
 <div id="photos-step"><h3>5. Photos</h3><p>Au moins 8 photos : avant, arrière, côtés gauche/droit, intérieur, tableau de bord, moteur et coffre. Ajoutez les dommages visibles si nécessaire. JPEG/PNG/WebP, 10 Mo maximum avant compression ; images réduites à 2560 px.</p><label>Catégorie pour le glisser-déposer<select id="drop-kind">${S.PHOTO_KINDS.filter(k=>k!=='exterior').map(k=>`<option value="${k}">${esc(S.FILE_LABELS[k])}</option>`).join('')}</select></label><div id="photo-drop" tabindex="0">Déposez les photos ici ou utilisez les sélecteurs ci-dessous.</div><div class="grid">${S.PHOTO_KINDS.filter(k=>k!=='exterior').map(k=>`<label>${esc(S.FILE_LABELS[k])}<input type="file" data-upload="${k}" multiple accept="image/jpeg,image/png,image/webp"></label>`).join('')}</div><div class="seller-photos">${photoCards(canEdit)}</div></div>
 <div id="damage-step"><h3>6. Inspection des dommages</h3>${damagePanel()}</div>
 <div id="diagnostic-step"><h3>7. Diagnostic et documents privés</h3><p class="warning">Un fichier téléversé n’est pas automatiquement authentique. Notre équipe vérifiera le rapport et son VIN avec le garage agréé.</p><div class="grid"><label>Garage agréé<select name="garageId"><option value="">Choisir</option>${garages.map(g=>`<option value="${g.id}" ${d.garageId===g.id?'selected':''}>${esc(g.name)} — agrément ${esc(g.valid_until)}</option>`).join('')}</select></label>${field('diagnosticDate','Date de l’inspection','date')}${field('diagnosticReference','Référence du rapport')}${field('diagnosticMileageKm','Kilométrage relevé','number')}${field('diagnosticVin','VIN inscrit dans le rapport')}</div><p>Si le VIN est illisible, demandez une correction au garage ; l’administrateur doit confirmer sa correspondance avant approbation.</p><div class="grid">${Object.entries(S.SYSTEMS).map(([k,l])=>`<label>${esc(l)}<textarea name="obs-${k}" maxlength="2000">${esc(d.observations?.[k])}</textarea></label>`).join('')}</div><p>Carte grise, droit de vente et diagnostic obligatoires. Contrôle technique si déclaré applicable ; facture de vente pour les professionnels. Le carnet d’entretien et les autres justificatifs sont facultatifs. Les exigences nationales doivent être confirmées par l’équipe.</p><div class="grid">${uploads.map(([k,l])=>`<label>${esc(l)}<input type="file" data-upload="${k}" multiple accept="${k==='diagnostic'?'application/pdf':'application/pdf,image/jpeg,image/png,image/webp'}"></label>`).join('')}</div><ul>${current.files.filter(f=>!S.PHOTO_KINDS.includes(f.kind)).map(f=>`<li>${esc(S.FILE_LABELS[f.kind])} <button type="button" data-access="${f.id}">Accès privé temporaire</button>${canEdit?`<button type="button" data-remove="${f.id}">Supprimer</button>`:''}</li>`).join('')}</ul></div>
 <div id="sale-step"><h3>8. Prix, mode de vente et prévisualisation</h3><div class="grid">${field('saleType','Mode de vente','select',{values:['sale','auction']})}${field('priceAmount','Prix fixe / prix de départ','number')}${field('priceCurrency','Devise','select',{values:['TND','EUR']})}${field('reservePriceTnd','Prix de réserve facultatif (TND)','number')}${field('auctionStart','Début souhaité des enchères','datetime-local')}${field('auctionEnd','Fin souhaitée des enchères','datetime-local')}${field('description','Description commerciale','textarea')}</div><label class="check"><input type="checkbox" name="allowOffers" ${d.allowOffers?'checked':''}>Recevoir des propositions de prix en vente directe</label><p>Les enchères ne démarrent jamais automatiquement à la soumission. L’administration confirme leur programmation après validation. Pour un prix en EUR, elle valide le montant de publication en TND.</p><div id="preview"></div><h3>Pièces et informations manquantes</h3><ul id="missing">${detail.missing.map(m=>`<li>${esc(m)}</li>`).join('')||'<li>Dossier complet pour soumission.</li>'}</ul></div>
 </fieldset><div class="actions"><button type="button" id="previous-step">Précédent</button><button type="button" id="continue-identification">Poursuivre</button><button type="button" id="next-step">Poursuivre</button><button type="submit" id="save-draft">Enregistrer le brouillon</button><button type="button" id="submit-dossier" ${!canEdit||detail.missing.length?'disabled':''}>Soumettre à vérification</button></div></form><h3>État de validation et messages de l’administration</h3>${eventList(current)}${canEdit||current.status==='archived'?'':'<p>Les données sont verrouillées pendant la validation et après approbation.</p>'}${canEdit?'<button type="button" id="archive-draft">Archiver le brouillon</button>':''}`;
 const form=$('vehicle-form');
 // Valeurs de compatibilité des premiers brouillons.
 form.elements.priceCurrency.value=d.priceCurrency||'TND';form.elements.priceAmount.value=d.priceAmount??d.priceTnd??'';
 form.addEventListener('input',event=>{if(!event.target.name)return;dirty=true;$('submit-dossier').disabled=true;$('continue-identification').disabled=!initialValid();$('custom-location').hidden=form.elements.location.value!=='other';});
 form.addEventListener('change',()=>{$('custom-location').hidden=form.elements.location.value!=='other';$('continue-identification').disabled=!initialValid();});
 form.addEventListener('submit',safely(async()=>{await saveDraft();const id=current.id;await refresh();await openSubmission(id,step);message('Brouillon enregistré.');}));
 const next=safely(async()=>{if(busy||!initialValid())return;busy=true;try{await saveDraft();showStep(Math.min(7,step+1));}finally{busy=false;showStep(step);}});
 $('continue-identification').onclick=next;$('next-step').onclick=next;
 $('previous-step').onclick=safely(async()=>{await saveDraft();showStep(Math.max(0,step-1));});
 $('cancel-identification').onclick=safely(async()=>{await saveDraft();await refresh();$('editor').hidden=true;message('Brouillon conservé dans vos dossiers.');});
 $('archive-draft')?.addEventListener('click',safely(async()=>{await saveDraft();await api(prefix+'submissions/'+current.id+'/archive',{method:'POST',body:{revision:current.revision}});$('editor').hidden=true;await refresh();message('Brouillon archivé.');}));
 $('submit-dossier').onclick=safely(async()=>{
  if(busy)return;busy=true;$('submit-dossier').disabled=true;
  try{await saveDraft();const {submission}=await api(prefix+'submissions/'+current.id+'/submit',{method:'POST',body:{revision:current.revision}});current=submission;await refresh();await openSubmission(current.id,7);message('Dossier soumis, aucune publication automatique.');}finally{busy=false;}
 });
 $('equipment-search').oninput=()=>{const q=$('equipment-search').value.trim().toLocaleLowerCase('fr');document.querySelectorAll('.equipment-choice').forEach(l=>l.hidden=!l.textContent.toLocaleLowerCase('fr').includes(q));};
 for(const input of document.querySelectorAll('[data-upload]'))input.onchange=safely(()=>upload([...input.files],input.dataset.upload));
 $('photo-drop').ondragover=e=>e.preventDefault();$('photo-drop').ondrop=safely(e=>{e.preventDefault();return upload([...e.dataTransfer.files],$('drop-kind').value);});
 let dragged=null;
 for(const card of document.querySelectorAll('[data-photo]')){card.ondragstart=e=>{dragged=card.dataset.photo;e.dataTransfer.setData('text/plain',dragged);};card.ondragover=e=>e.preventDefault();card.ondrop=safely(async e=>{e.preventDefault();e.stopPropagation();if(dragged&&dragged!==card.dataset.photo){const order=photos().map(f=>f.id);order.splice(order.indexOf(dragged),1);order.splice(order.indexOf(card.dataset.photo),0,dragged);await reorder(order);}dragged=null;});}
 renderDamages();showStep(requestedStep??0);
}
async function reorder(order,main){
 await saveDraft();const oldMain=photos().find(f=>f.is_primary)?.id;
 const {submission}=await api(prefix+'submissions/'+current.id+'/photos',{method:'PUT',body:{revision:current.revision,order,main:main||oldMain||order[0]}});current=submission;await openSubmission(current.id,4);
}
function renderAdmin(detail){
 const d=current.data,canReview=['submitted','reviewing'].includes(current.status),fs=current.files;
 const known={...Object.fromEntries(S.TECH_FIELDS.map(([k,l])=>[k,l])),...Object.fromEntries(S.HISTORY_FIELDS.map(([k,l])=>[k,l])),make:'Marque',model:'Modèle',trim:'Finition',vin:'VIN',licensePlate:'Immatriculation',firstRegistrationDate:'Première immatriculation',productionDate:'Production',year:'Année',mileageKm:'Kilométrage',originCountry:'Pays d’origine',firstRegistrationCountry:'Première immatriculation (pays)',location:'Lieu',saleType:'Mode de vente',priceAmount:'Prix demandé',priceCurrency:'Devise',priceTnd:'Prix TND',reservePriceTnd:'Réserve TND',auctionStart:'Début souhaité',auctionEnd:'Fin souhaitée',description:'Description',diagnosticDate:'Date du diagnostic',diagnosticReference:'Référence du rapport',diagnosticVin:'VIN du rapport',diagnosticMileageKm:'Kilométrage du diagnostic'};
 const seller=rows.find(r=>r.id===current.id)||{};
 $('editor').innerHTML=`<h2>Vérification du dossier</h2><p class="status">${esc(label(current))}</p><p>${esc(seller.seller_name)} · ${esc(seller.seller_phone)} · ${esc(seller.seller_email)}<br>${esc(seller.seller_address)} · ${esc(seller.seller_type)} ${esc(seller.professional_number)}</p><dl>${Object.entries(known).map(([k,l])=>`<dt><strong>${esc(l)}</strong></dt><dd>${esc(d[k])}</dd>`).join('')}</dl><p>Garage : ${esc(garages.find(g=>g.id===d.garageId)?.name||'Inconnu')} · validité ${esc(garages.find(g=>g.id===d.garageId)?.valid_until)}</p><h3>Observations du diagnostic</h3>${Object.entries(S.SYSTEMS).map(([k,l])=>`<p><strong>${esc(l)}</strong> : ${esc(d.observations?.[k])}</p>`).join('')}<h3>Équipements</h3><p>${esc((d.equipment||[]).join(' · '))}</p><h3>Photos privées</h3><div class="seller-photos">${photoCards(false)}</div><h3>Dommages déclarés</h3>${(d.damages||[]).map(x=>`<p>${esc(S.ZONES[x.zone])} · ${esc(x.type)} · ${esc(x.severity)} : ${esc(x.description)} (${x.photoIds.length} photo(s))</p>`).join('')||'<p>Aucun dommage déclaré.</p>'}<h3>Documents confidentiels</h3><ul>${fs.filter(f=>!S.PHOTO_KINDS.includes(f.kind)).map(f=>`<li>${esc(S.FILE_LABELS[f.kind])} <button data-access="${f.id}">Accès temporaire sécurisé</button></li>`).join('')}</ul>${detail.missing.length?`<p class="warning">${esc(detail.missing.join(' · '))}</p>`:''}${current.feedback?`<p class="warning">${esc(current.feedback)}</p>`:''}${current.status==='submitted'?'<button id="begin-review">Commencer la vérification</button>':''}${canReview?`<form id="review-form" class="stack"><p class="warning">La lecture du VIN dans le PDF et l’authenticité du rapport doivent être vérifiées humainement auprès du garage ; les métadonnées saisies ne sont pas une preuve.</p><label class="check"><input type="checkbox" name="diagnosticAuthentic">Rapport authentifié auprès du garage</label><label class="check"><input type="checkbox" name="vinChecked">VIN du rapport vérifié et correspondant au véhicule</label><label class="check"><input type="checkbox" name="documentsChecked">Justificatifs vérifiés</label><label>Résumé du diagnostic autorisé à publication<textarea name="publicSummary" maxlength="3000"></textarea></label><label>Motif / message au vendeur<textarea name="feedback" maxlength="2000"></textarea></label><label>Décision<select name="decision"><option value="corrections">Demander des corrections</option><option value="rejected">Refuser</option><option value="approved">Approuver sans publier</option></select></label><button>Enregistrer la décision</button></form>`:''}${current.status==='approved'?`<form id="publish-form"><p class="warning">L’approbation n’a pas publié cette annonce. Cette action autorise sa publication. Les enchères resteront « À venir ».</p>${d.priceCurrency==='EUR'?'<label>Prix de publication validé en TND<input name="priceTnd" type="number" min="1" required></label>':''}<button id="publish-submission">Autoriser la publication</button></form>`:''}${['published','draft','rejected','corrections'].includes(current.status)?'<button id="archive-submission">Archiver / retirer l’annonce</button>':''}<h3>Historique de validation</h3>${eventList(current)}`;
 const decide=async body=>{await api(prefix+'submissions/'+current.id+'/review',{method:'POST',body:{revision:current.revision,...body}});await refresh();await openSubmission(current.id);message('Décision enregistrée.');};
 $('begin-review')?.addEventListener('click',safely(()=>decide({decision:'reviewing'})));
 $('review-form')?.addEventListener('submit',safely(()=>{const f=$('review-form');return decide({decision:f.elements.decision.value,feedback:f.elements.feedback.value,publicSummary:f.elements.publicSummary.value,diagnosticAuthentic:f.elements.diagnosticAuthentic.checked,documentsChecked:f.elements.documentsChecked.checked,vinChecked:f.elements.vinChecked.checked});}));
 $('publish-form')?.addEventListener('submit',safely(async()=>{const f=$('publish-form');await api(prefix+'submissions/'+current.id+'/publish',{method:'POST',body:{revision:current.revision,priceTnd:f.elements.priceTnd?.value}});await refresh();await openSubmission(current.id);message('Annonce publiée après validation.');}));
 $('archive-submission')?.addEventListener('click',safely(async()=>{await api(prefix+'submissions/'+current.id+'/archive',{method:'POST',body:{revision:current.revision}});await refresh();await openSubmission(current.id);}));
}
for(const kind of ['login','register'])$(kind+'-form')?.addEventListener('submit',safely(async()=>{await api('/api/'+kind,{method:'POST',body:Object.fromEntries(new FormData($(kind+'-form')))});$(kind+'-form').reset();message();await refresh();}));
$('logout').onclick=safely(async()=>{await api('/api/logout',{method:'POST'});location.reload();});
$('profile-form')?.addEventListener('submit',safely(async()=>{await api(prefix+'profile',{method:'PUT',body:Object.fromEntries(new FormData($('profile-form')))});message('Coordonnées enregistrées.');}));
$('document-rule-form')?.addEventListener('submit',safely(async()=>{const d=Object.fromEntries(new FormData($('document-rule-form')));d.countryCode=d.countryCode.toUpperCase();d.required=d.required==='true';await api(prefix+'document-rules',{method:'POST',body:d});await refresh();message('Règle documentaire enregistrée.');}));
$('cleanup-files')?.addEventListener('click',safely(async()=>{const {deleted}=await api(prefix+'cleanup',{method:'POST'});message(`${deleted} fichier(s) supprimé(s) de la file de purge.`);}));
$('garage-form')?.addEventListener('submit',safely(async()=>{await api(prefix+'garages',{method:'POST',body:Object.fromEntries(new FormData($('garage-form')))});$('garage-form').reset();await refresh();message('Garage agréé ajouté.');}));
$('new-submission')?.addEventListener('click',safely(async()=>{const {submission}=await api(prefix+'submissions',{method:'POST'});filter='active';view='list';await refresh();await openSubmission(submission.id);$('editor').scrollIntoView({block:'start'});}));
document.addEventListener('click',safely(async e=>{
 const target=e.target,open=target.closest('[data-open]'),filterButton=target.closest('[data-vehicle-filter]'),v=target.closest('[data-seller-view]'),access=target.closest('[data-access]'),remove=target.closest('[data-remove]'),g=target.closest('[data-garage]'),stepButton=target.closest('[data-step]');
 if(open)await openSubmission(open.dataset.open);
 if(filterButton){filter=filterButton.dataset.vehicleFilter;$('editor').hidden=true;renderList();}
 if(v){view=v.dataset.sellerView;$('editor').hidden=true;renderList();}
 if(g){await api(prefix+'garages/'+g.dataset.garage,{method:'PUT',body:{active:g.dataset.active==='true'}});await refresh();}
 if(access){const {url}=await api(prefix+'files/'+access.dataset.access+'/access',{method:'POST'});location.assign(url);}
 if(remove){if(busy)return;await saveDraft();await api(prefix+'files/'+remove.dataset.remove,{method:'DELETE',body:{revision:current.revision}});const detail=await api(prefix+'submissions/'+current.id);current=detail.submission;damages=damages.map(x=>({...x,photoIds:x.photoIds.filter(id=>id!==remove.dataset.remove)}));await saveDraft();await openSubmission(current.id,step);}
 if(stepButton&&!busy){const n=Number(stepButton.dataset.step);if(n>0&&!initialValid()){message('Complétez l’identification avant de poursuivre.');return;}await saveDraft();showStep(n);}
 const zone=target.closest('[data-zone]');if(zone)editDamage(zone.dataset.zone);
 const de=target.closest('[data-damage-edit]'),dr=target.closest('[data-damage-remove]');
 if(de)editDamage(damages[Number(de.dataset.damageEdit)].zone,Number(de.dataset.damageEdit));
 if(dr){damages.splice(Number(dr.dataset.damageRemove),1);dirty=true;renderDamages();}
 const main=target.closest('[data-photo-main]'),move=target.closest('[data-photo-move]');
 if(main)await reorder(photos().map(f=>f.id),main.dataset.photoMain);
 if(move){const order=photos().map(f=>f.id),i=order.indexOf(move.dataset.photoMove),j=i+Number(move.dataset.direction);if(j>=0&&j<order.length){[order[i],order[j]]=[order[j],order[i]];await reorder(order);}}
}));
document.addEventListener('keydown',e=>{const z=e.target.closest('[data-zone]');if(z&&['Enter',' '].includes(e.key)){e.preventDefault();editDamage(z.dataset.zone);}});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
refresh().catch(e=>message(e.message));
