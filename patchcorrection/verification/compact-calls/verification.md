Refonte de la barre globale des appels — 9 octobre 2026

La barre commune aux MP et aux vocaux serveur occupe 40 px en haut de l'application. Un indicateur ouvre les commandes de son appel. Les panneaux MP existants sont réutilisés à la demande, sans duplication ni dépendance à la page affichée. Les noms et les infobulles suivent le réglage de confidentialité existant.

Le protocole serveur conserve une session vocale par socket. Le second vocal utilise une connexion authentifiée indépendante et le même quota serveur de deux appels par compte. Les sessions sont conservées pendant la navigation. Le menu « Déplacer cet appel… » permet de changer de salon ou de serveur sans quitter l'autre appel.

Validation effectuée avec `node tests/simultaneous-calls.cjs --browser` :

- Deux MP acceptés, combinaison MP/vocal, deux vocaux serveur dans le même onglet.
- Navigation répétée entre MP, accueil, salons texte, serveurs et paramètres : barre visible et sessions conservées.
- Redimensionnements à 320, 390 et 1440 px : hauteur de 40 px, indicateurs cliquables, absence des grands panneaux automatiques, champ de message dans la fenêtre.
- Réglage de confidentialité activé puis désactivé depuis les paramètres : noms et infobulles actualisés.
- Microphones, son et départ indépendants ; conservation de l'autre indicateur ; disparition propre après le dernier départ.
- Reconnexion des MP et des deux transports vocaux ; invitations silencieuses à des appels quittés exclues des sessions actives.
- Autre compte dans un contexte navigateur isolé : réception de pistes audio WebRTC et lecture effective dans les deux sens, puis rétablissement après reconnexion du second vocal.
- Déplacement du second vocal entre deux serveurs puis retour : premier vocal conservé et transport audio rétabli.
- Tests serveur : quotas, demandes simultanées, permissions, confidentialité des observateurs, déconnexion et préférence persistée après redémarrage.
- Aucune exception JavaScript navigateur.

Régression existante : `node tests/admin-presence.cjs --browser` passe également (interface mobile, couleurs des rôles, profils, paramètres administratifs, clavier, permissions et présence). La vérification syntaxique des scripts modifiés et `git diff --check` passent.

Edge utilise des périphériques multimédias simulés. Ces essais vérifient la signalisation et le transport WebRTC réels sur le serveur local ; ils ne constituent pas une écoute humaine ni un test de périphériques physiques ou de réseau distant.

Captures inspectées : `bar-320.png`, `bar-390.png`, `bar-1440.png`.

Sauvegardes des fichiers existants : `patchcorrection/backups/compact-calls-20261009-173534/`. Les anciennes sauvegardes restent conservées.
