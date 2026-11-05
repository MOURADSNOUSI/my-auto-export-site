import {toMinor} from './marketplace-i18n.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const floorMessage='Votre offre doit être supérieure ou égale au prix de réserve de ce véhicule.';
const money=(n,c)=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:c,minimumFractionDigits:c==='TND'?3:2}).format(n/(c==='TND'?1000:100));
async function request(path,method='GET',body){const r=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});let data;try{data=await r.json();}catch{throw new Error('Service momentanément indisponible.');}if(!r.ok)throw Object.assign(new Error(data.error||'Erreur'),{status:r.status});return data;}
let dialog,opener;
function shell(){
 if(dialog)return dialog;
 dialog=document.createElement('dialog');dialog.className='proposal-modal';dialog.id='proposal-dialog';dialog.setAttribute('aria-labelledby','proposal-title');
 dialog.innerHTML='<button class="proposal-close" type="button" aria-label="Fermer la proposition">×</button><h2 id="proposal-title">Proposer une offre</h2><div id="proposal-content"></div><p class="proposal-error" role="alert" aria-live="polite"></p>';
 dialog.querySelector('.proposal-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>opener?.focus());document.body.append(dialog);return dialog;
}
async function open(reference,button){
 opener=button;const d=shell(),content=d.querySelector('#proposal-content'),error=d.querySelector('.proposal-error');content.textContent='Chargement de l’annonce…';error.textContent='';if(!d.open)d.showModal();
 try{
  const info=await request('/api/marketplace/proposal-vehicles/'+encodeURIComponent(reference)),v=info.vehicle;
  let authenticated=false,buyerActive=false;try{const account=await request('/api/me');authenticated=true;buyerActive=account.user.profiles.buyer;}catch(e){if(e.status!==401)throw e;}
  const unavailable=info.rules.freeSubmission?'Cette annonce est actuellement indisponible pour les propositions.':'Vous pouvez renseigner votre montant et votre message. L’envoi reste indisponible tant que le vendeur n’a pas renseigné la réserve et ouvert cette annonce aux propositions.';
  content.innerHTML=`<p><strong>${esc(v.make)} ${esc(v.model)}</strong><br>Référence : ${esc(v.reference)}</p><p class="proposal-reserve">Prix de réserve : <strong>${v.reserveMinor?esc(money(v.reserveMinor,v.currency)):'À renseigner par le vendeur'}</strong></p><p>${esc(info.notice)}</p>${!v.active?`<p class="proposal-unavailable">${unavailable}</p>`:''}<section id="proposal-auth" ${authenticated?'hidden':''}><h3>Connectez-vous pour envoyer votre proposition</h3><form id="proposal-login"><label>E-mail<input name="email" type="email" autocomplete="email" required></label><label>Mot de passe<input name="password" type="password" autocomplete="current-password" required></label><button>Se connecter</button></form><p><a href="/vendre">Créer un compte</a></p></section><form id="proposal-form"><label>Montant proposé (${esc(v.currency||'')})<input id="proposal-amount" name="amount" type="text" inputmode="decimal" autocomplete="off" required></label><label>Message au vendeur (facultatif)<textarea name="message" maxlength="2000" rows="3"></textarea></label><p>Validité de la proposition : ${info.rules.offerHours} heures à partir de son envoi. ${info.rules.withdrawalAllowed?'Vous pouvez annuler tant qu’elle est en attente.':'Les demandes d’annulation seront examinées par l’équipe.'}</p><label class="proposal-consent"><input name="intention" type="checkbox" required>J’ai lu les <a href="/conditions-marketplace" target="_blank" rel="noopener">conditions des propositions (modèle à valider)</a> et je confirme l’envoi de ma proposition privée.</label><button id="proposal-send" ${v.active&&authenticated?'':'disabled'}>Envoyer ma proposition</button></form>`;
  if(info.rules.freeSubmission){
   content.querySelector('.proposal-reserve').textContent='Montant libre : proposez le prix qui vous convient, sans minimum de réserve.';
   content.querySelector('label:has(textarea)').firstChild.textContent='Message au vendeur ou à M&Y (facultatif)';
  }
  const form=content.querySelector('#proposal-form'),send=content.querySelector('#proposal-send');
  const updateBuyer=()=>{
   content.querySelector('#proposal-enable-buyer')?.remove();
   send.disabled=!v.active||!authenticated||!buyerActive;
   if(authenticated&&!buyerActive){
    const button=document.createElement('button');button.type='button';button.id='proposal-enable-buyer';button.textContent='Activer mon profil Acheteur';
    form.before(button);
    button.onclick=async()=>{button.disabled=true;error.textContent='';try{const account=await request('/api/account/profiles','POST',{profile:'buyer'});buyerActive=account.user.profiles.buyer;updateBuyer();window.dispatchEvent(new Event('account-profiles-changed'));}catch(e){error.textContent=e.message;button.disabled=false;}};
   }
  };
  updateBuyer();
  content.querySelector('#proposal-login')?.addEventListener('submit',async event=>{event.preventDefault();error.textContent='';try{const account=await request('/api/login','POST',Object.fromEntries(new FormData(event.currentTarget)));authenticated=true;buyerActive=account.user.profiles.buyer;content.querySelector('#proposal-auth').hidden=true;updateBuyer();window.dispatchEvent(new Event('account-profiles-changed'));form.elements.amount.focus();}catch(e){error.textContent=e.message;}});
  form.addEventListener('submit',async event=>{
   event.preventDefault();error.textContent='';if(!v.active){error.textContent=unavailable;return;}if(!authenticated){error.textContent='Connectez-vous avant d’envoyer votre proposition.';return;}if(!buyerActive){error.textContent='Activez votre profil Acheteur avant d’envoyer votre proposition.';return;}
   let amount;try{amount=toMinor(form.elements.amount.value,v.currency);}catch(e){error.textContent=e.message;return;}
   if(!info.rules.freeSubmission&&amount<v.reserveMinor){error.textContent=floorMessage;return;}send.disabled=true;
   try{await request('/api/marketplace/offers','POST',{reference:v.reference,amountMinor:amount,currency:v.currency,buyerMessage:form.elements.message.value,confirmIntent:form.elements.intention.checked,rulesVersion:info.rules.version});content.innerHTML='<p class="proposal-success" role="status">Votre proposition a été envoyée au vendeur ou à l’administration M&Y pour examen.</p><p><a href="/mes-offres">Consulter Mes offres</a></p>';}
   catch(e){error.textContent=e.message;send.disabled=false;}
  });
 }catch(e){error.textContent=e.message;content.textContent='';}
}
document.addEventListener('click',event=>{const b=event.target.closest('[data-proposal-ref]');if(!b)return;event.preventDefault();open(b.dataset.proposalRef,b);});
