# People

Les paramètres de serveur permettent de gérer le nom, l’image, les salons,
les rôles et leurs permissions, les membres et les bannissements. Le rôle
« Administrateur » donne toutes les permissions disponibles et ignore les
restrictions des salons. La hiérarchie protège le propriétaire et les rôles
égaux ou supérieurs. Les administrateurs peuvent supprimer les messages des
autres membres et déconnecter un membre du vocal. Sur téléphone, un appui long
sur un message ouvre ses actions. La section Modération affiche aussi le
journal des actions d’administration.

Dans un serveur, les pseudos prennent la couleur du rôle attribué le plus haut.
Les profils affichent les rôles du serveur consulté. Le sélecteur sous le profil
permet de choisir En ligne, Absent, Ne pas déranger ou Invisible. Le choix est
conservé après redémarrage ; un compte déconnecté apparaît hors ligne.
Ne pas déranger coupe les notifications de messages et les sons d’appel.

People peut être installée sur téléphone comme application web (PWA). Sur
Android, utiliser « Installer People » quand le navigateur le propose. Sur
iPhone, ouvrir le site dans Safari puis Partager → Sur l’écran d’accueil.
L’installation sur un téléphone nécessite un site servi en HTTPS. La
navigation, les paramètres et la zone de saisie s’adaptent aux petits écrans
et à la hauteur disponible lorsque le clavier apparaît.

Validation locale : `npm test`. Sous Windows avec Edge installé à son emplacement
standard : `npm run test:browser`. Les tests utilisent des comptes, des données
et un profil de navigateur temporaires. Ils vérifient les accès administrateur,
la hiérarchie, les bannissements, la déconnexion vocale, le journal, les rôles,
les statuts et leur persistance. Le test navigateur vérifie aussi les couleurs,
les profils, la suppression de messages et les paramètres de 320 à 768 pixels.
La branche PostgreSQL utilise les tables `people_presence_preferences` et
`people_admin_audit`, créées automatiquement au démarrage ; les tests locaux
utilisent le stockage JSON.

Mini site privé pour discuter avec ses amis :

- un salon texte `# général`
- un salon vocal
- liste en direct des personnes présentes dans le vocal
- état micro activé / coupé
- messages temps réel avec Socket.IO
- audio WebRTC
- prêt pour Render avec `render.yaml`

## URL Render demandée

`https://peoplethenewappbetterthanthebluebotandwithoutcapitalism.onrender.com`

Le nom doit être disponible au moment de la création du service Render.

## Lancer en local

Sous Windows, double-clique sur `LANCER_LOCAL.bat`.

Ou :

```bash
npm install
npm start
```

Puis ouvre `http://localhost:3000`.


## Dossier Windows conseillé

`D:\\crack\\Discord 2`
