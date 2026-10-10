const fs=require('node:fs');
const acorn={exports:{}};new Function('exports','module',process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'])(acorn.exports,acorn);
const rows=`Couleur invalide pour |Invalid color for
Cette personne t'a deja envoye une demande. |This person has already sent you a request.
Accepte-la dans Demandes d'ami.|Accept it in Friend Requests.
Le contenu doit être un Buffer.|The content must be a Buffer.
La pièce jointe doit faire moins de |The attachment must be smaller than
Impossible de modifier la réaction.|Unable to update the reaction.
Nom ou type de salon invalide.|Invalid channel name or type.
Impossible de créer cet élément.|Unable to create this item.
Nom de salon invalide.|Invalid channel name.
Impossible de modifier cet élément.|Unable to update this item.
Voir les salons|View Channels
Envoyer des messages|Send Messages
Ajouter des réactions|Add Reactions
Rejoindre les vocaux|Connect to Voice
Vocal|Voice
Caméra et partage d'écran|Camera and Screen Sharing
Créer / copier des invitations|Create / Copy Invitations
Gérer les messages|Manage Messages
Modération|Moderation
Gérer les salons|Manage Channels
Gérer les rôles|Manage Roles
Bannir des membres|Ban Members
Gérer le serveur|Manage Server
Avancé|Advanced
Déconnecter les membres du vocal|Disconnect Voice Members
Tu ne peux pas te modérer toi-même.|You cannot moderate yourself.
Le propriétaire du serveur ne peut pas être modéré.|The server owner cannot be moderated.
Tu n'as pas cette permission de modération.|You do not have this moderation permission.
Ce membre a un rôle égal ou supérieur au tien.|This member has an equal or higher role than yours.
Impossible de créer ce rôle.|Unable to create this role.
Impossible de supprimer ce rôle.|Unable to delete this role.
Tu ne peux pas attribuer ou retirer un rôle égal ou supérieur au tien.|You cannot assign or remove a role equal to or higher than yours.
Impossible de modifier les rôles de ce membre.|Unable to update this member's roles.
Tu ne peux pas autoriser une permission que tu ne possèdes pas.|You cannot allow a permission you do not have.
Impossible de modifier ces permissions.|Unable to update these permissions.
Cet appareil E2EE n'est pas enregistré.|This E2EE device is not registered.
Requête E2EE invalide.|Invalid E2EE request.
Un autre appareil prépare déjà la clé de ce salon.|Another device is already preparing this channel's key.
Cet appareil ne possède plus le verrou de génération de clé.|This device no longer holds the key generation lock.
La liste des appareils autorisés a changé pendant la rotation.|The authorized device list changed during key rotation.
Aucun appareil E2EE autorisé n'est disponible.|No authorized E2EE device is available.
📞 Appel refusé|📞 Call declined
📞 Appel annulé|📞 Call cancelled
📞 Appel manqué|📞 Missed call
📞 Appel interrompu|📞 Call interrupted
Impossible de rejoindre cet appel.|Unable to join this call.
Tu n'as pas la permission de parler dans ce vocal.|You do not have permission to speak in this voice channel.
Tu n'as pas la permission d'activer ta caméra dans ce vocal.|You do not have permission to enable your camera in this voice channel.
Tu n'as pas la permission de partager ton écran dans ce vocal.|You do not have permission to share your screen in this voice channel.
Le serveur n'a pas répondu.|The server did not respond.
Ce serveur n'a pas encore été synchronisé sur cet appareil.|This server has not been synced on this device yet.
Ce salon n'a pas encore été synchronisé sur cet appareil.|This channel has not been synced on this device yet.
Le serveur vocal n'a pas répondu.|The voice server did not respond.
ICE candidate ignoré|ICE candidate ignored
Impossible de créer l'offre|Unable to create the offer
Erreur offre WebRTC|WebRTC offer error
Erreur réponse WebRTC|WebRTC answer error
ICE candidate refusé|ICE candidate rejected
Thème importé|Imported theme
Thème personnalisé People|Custom People theme
En cours|Active
Entrant|Incoming
Sonnerie|Ringing
Reconnexion|Reconnecting
Tu as atteint la limite de 2 appels simultanés. Raccroche un appel pour continuer.|You have reached the limit of two simultaneous calls. End a call to continue.
Aucun|None
Mosaïque|Mosaic
Appel refusé|Call declined
Appel annulé|Call cancelled
Pas de réponse|No answer
Tu as quitté l'appel|You left the call
Appel fermé après 3 min seul|Call ended after three minutes alone
Connexion quittée|Disconnected
Appel indisponible|Call unavailable
Tu as atteint la limite de 2 appels simultanés|You have reached the limit of two simultaneous calls
Appel rejoint ailleurs|Call joined on another device
Appel pris ailleurs|Call answered on another device
Salon texte|Text channel
Service Worker sans réponse (ancienne version ou timeout)|Service Worker did not respond (outdated version or timeout)
Réponse vide du Service Worker|Empty Service Worker response
Les notifications système fonctionnent.|System notifications are working.
Erreur HTTP |HTTP error
Serveur — |Server —
Salon — #|Channel — #
Erreur d'envoi|Send failed
Créer une catégorie|Create Category
Nom de la catégorie|Category name
Créer un salon textuel|Create Text Channel
Nom du salon textuel|Text channel name
Créer un salon vocal|Create Voice Channel
Nom du salon vocal|Voice channel name
Nouvelle catégorie|New category
nouveau-salon|new-channel
Nouveau vocal|New voice channel
cet élément|this item
Déplacer le salon|Move channel
Choisis la catégorie avec son numéro :|Choose the category by number:
Déplacer|Move
Seul le propriétaire peut gérer les salons pour le moment.|Only the owner can manage channels at this time.
Type de salon invalide.|Invalid channel type.
Erreur E2EE|E2EE error
Rôles personnalisés et permissions globales ou propres à chaque salon.|Custom roles and permissions for the server or individual channels.
Outils de sécurité, journal d’actions et paramètres de modération.|Security tools, audit log and moderation settings.
Création|Created
Modification|Updated
Suppression / retrait|Deleted / removed
bannissement|ban
salon|channel
Journal d’administration|Administration Log
Une notification plus douce.|A softer notification.
Une notification vibe retro comme on aime.|A retro notification sound.
Une notification plus petite, rapide et lumineuse.|A short, bright notification.
Une sonnerie rythmée.|A rhythmic ringtone.
Rétro|Retro
Une sonnerie plus discrète.|A more subtle ringtone.
Le double bip actuel de People.|People's current double beep.
Appel manqué — pas de réponse|Missed call — no answer
Appel interrompu|Call interrupted
Enregistrement…|Saving...
Image invalide.|Invalid image.
↓ Derniers messages|↓ Latest messages
 messages non lus| unread messages
Rechercher|Search
Réduire|Minimize
Chargement…|Loading...
Effets de visage|Face effects
Effets|Effects
Canvas indisponible.|Canvas is unavailable.
Dimensions de l’image invalides.|Invalid image dimensions.
Photo de profil de|Profile picture of
Avatar indisponible.|Avatar unavailable.
En attente de|Waiting for
En attente|Pending
Mute local de|Local mute for
Volume local de|Local volume for
@ Ping de|@ Mention from
Message de|Message from
People — message de|People — message from
Quelqu'un|Someone
IndexedDB indisponible.|IndexedDB is unavailable.
Cache local indisponible.|Local cache is unavailable.
en attente|pending
Reconnexion • envoi de|Reconnecting • sending
Salons|Channels
Indisponible|Unavailable
Raison du bannissement de|Reason for banning
La sonnerie actuelle.|The current ringtone.
Module d'apparence indisponible.|Appearance module is unavailable.
Envoi de la photo…|Uploading picture...
IndexedDB E2EE indisponible.|E2EE IndexedDB is unavailable.
@ Ping MP de|@ DM mention from
MP de|DM from
People — MP de|People — DM from`;
const extra = `Utilisateur|User
utilisateur|user
Joindre des fichiers|Attach Files
Exclure des membres|Kick Members
Cet epoch E2EE n'est plus en attente.|This E2EE epoch is no longer pending.
Un destinataire E2EE est invalide.|Invalid E2EE recipient.
Une nouvelle version de People est disponible.|A new version of People is available.
L?image source est trop lourde (25 Mo maximum).|The source image is too large (25 MB maximum).
Non prises en charge dans cet environnement.|Not supported in this environment.
avec|with
fichiers maximum dans un message.|files maximum per message.
Nouveau nom pour «|New name for “
E2EE People indisponible sur cet appareil.|People E2EE is unavailable on this device.
Appareil E2EE invalide.|Invalid E2EE device.
Choisis une image PNG, JPEG ou WebP.|Choose a PNG, JPEG or WebP image.
Choisis une image de moins de 10 Mo.|Choose an image smaller than 10 MB.
cet utilisateur|this user
Une sonnerie de vieille console.|A classic console ringtone.
Une sonnerie plus douce et moins agressive.|A softer, gentler ringtone.
Taille E2EE invalide.|Invalid E2EE size.
Message indisponible sur cet appareil|Message unavailable on this device
Conversation avec|Conversation with
Nouveau message|New message
1 nouveau message|1 new message
Message dans #|Message in #
Bienvenue dans #|Welcome to #`;
const mapping=new Map((rows+'\n'+extra).split('\n').map(row=>{const i=row.indexOf('|');return [row.slice(0,i).trim(),row.slice(i+1)];}));
const translate=value=>{if(value.trim() === 'Choisis la cat?gorie avec son num?ro :') return value.match(/^\s*/)[0]+'Choose the category by number:'+value.match(/\s*$/)[0];const replacement=mapping.get(value.trim());return replacement===undefined?value:value.match(/^\s*/)[0]+replacement+value.match(/\s*$/)[0];};
const files=['server.js',...fs.readdirSync('public').filter(f=>f.endsWith('.js')&&f!=='people-i18n.js').map(f=>'public/'+f)];
let count=0;
for(const file of files){const source=fs.readFileSync(file,'utf8'), changes=[];const tree=acorn.exports.parse(source,{ecmaVersion:'latest'});
function visit(node,parent){if(node.type==='Literal'&&typeof node.value==='string'&&!(parent?.type==='Property'&&parent.key===node&&!parent.computed)){
let value=translate(node.value);if(node.value.includes('<'))value=node.value.replace(/>([^<>]+)(?=<|$)/g,(_,v)=>'>'+translate(v)).replace(/((?:title|placeholder|aria-label|alt|value)\s*=\s*")([^"]*)(")/g,(_,a,v,b)=>a+translate(v)+b);
if(value!==node.value)changes.push({start:node.start,end:node.end,value:JSON.stringify(value)});
}if(node.type==='TemplateElement'){let value=node.value.raw.includes('<')?node.value.raw.replace(/>([^<>]+)(?=<|$)/g,(_,v)=>'>'+translate(v)).replace(/((?:title|placeholder|aria-label|alt|value)\s*=\s*")([^"]*)(")/g,(_,a,v,b)=>a+translate(v)+b):translate(node.value.raw);if(value!==node.value.raw)changes.push({start:node.start,end:node.end,value});}
for(const [key,child]of Object.entries(node))if(!['start','end','raw'].includes(key)){if(Array.isArray(child))child.forEach(c=>c?.type&&visit(c,node));else if(child?.type)visit(child,node);}}
visit(tree);let output=source;for(const change of changes.sort((a,b)=>b.start-a.start))output=output.slice(0,change.start)+change.value+output.slice(change.end);acorn.exports.parse(output,{ecmaVersion:'latest'});if(output!==source){fs.writeFileSync(file,output);console.log(file+': '+changes.length);count+=changes.length;}}
console.log('Reviewed static UI replacements: '+count);
