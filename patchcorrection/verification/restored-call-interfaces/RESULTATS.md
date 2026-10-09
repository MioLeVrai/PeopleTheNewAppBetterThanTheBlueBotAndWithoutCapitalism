# Restauration des interfaces d’appel

Comparaison effectuée avant les modifications : commits `ef7dce8` (deux appels, avant barre globale) et `3462d6d` (barre globale), sauvegardes `patchcorrection/backups/compact-calls-20261009-173534`. Les extensions MP V2/V3 et le composant vocal `people-server-voice-ui` ont été réutilisés.

## Modifications

- `public/people-dm-calls.js` : placement, volume, poignée de taille et mini-vidéo d’origine appliqués aux deux appels ; état du panneau indépendant ; restauration depuis la barre ; prise en compte de la page parente masquée.
- `public/people-dm-calls.css` : suppression du positionnement flottant forcé du deuxième appel.
- `public/people-call-bar.js` et `.css` : barre de 40 px conservée ; clic vers le MP ou le vocal correspondant ; suppression de la fenêtre simplifiée et des règles masquant les composants d’origine ; transport secondaire conservé.
- `public/app.js` : tuiles vidéo d’origine réutilisables dans le deuxième vocal ; cliquer sur un vocal déjà rejoint ouvre son interface ; commandes propres à l’appel ; effets caméra utilisant la source de chaque appel.
- `public/people-server-voice-ui.js` et `.css` : composant vocal d’origine adapté aux deux connexions ; participants, commandes audio/vidéo, effets, plein écran et déplacement entre serveurs ; disposition mobile sans débordement ; navigation conservée.
- `public/people-camera-effects.js` : réutilisation du bouton d’effets de la tuile locale, sans création d’un doublon dans le deuxième vocal.
- `public/index.html` : versions des ressources mises à jour pour renouveler le cache.
- `tests/simultaneous-calls-browser.cjs` : attentes adaptées à la restauration ; vérifications de géométrie, déplacement réel des poignées, état de taille indépendant, navigation par les indicateurs, participants, caméra secondaire, effets/plein écran, commandes mobiles et arrêt indépendant dans les deux sens. Délai maximal des commandes navigateur et détection des dialogues inattendus.

## Scénarios demandés

| Vérification | Résultat |
| --- | --- |
| MP en appel : panneau d’origine visible automatiquement | PASS, pour les deux MP |
| Messages, liste des MP et composition accessibles ; redimensionnement | PASS : géométrie du panneau au-dessus des messages ; déplacement réel de chaque poignée par CDP ; hauteur conservée au retour |
| Clic sur vocal : interface native et commandes visibles | PASS : vocal principal et secondaire ; un clic sur le vocal déjà rejoint conserve les deux connexions |
| Deux appels, navigation depuis la barre | PASS : deux MP, MP + vocal, deux vocaux ; indicateurs cliqués dans le navigateur |
| Navigation MP / serveurs / salons texte / paramètres et retour | PASS : identifiants MP et salons vocaux conservés ; reconnexions MP, principal et secondaire |
| Arrêter un appel sans couper l’autre | PASS : MP secondaire ; vocal principal puis secondaire ; audio secondaire encore joué après arrêt du principal |
| Tests navigateur et régressions existantes | PASS : suites ci-dessous, codes de sortie 0 |

Audio WebRTC bidirectionnel vérifié avec un deuxième navigateur authentifié. Caméra secondaire vérifiée avec le périphérique de test d’Edge. Largeurs 320, 390 et 1440 px vérifiées pour les panneaux MP et les commandes vocales. Confidentialité des noms et titres, permissions serveur et quota total de deux appels vérifiés. Le partage d’écran conserve ses commandes et son protocole ; le sélecteur interactif `getDisplayMedia` n’est pas automatisé dans cette suite.

## Commandes et résultats exacts

`node tests/simultaneous-calls.cjs --browser` — code de sortie **0** :

```text
PASS: DM panel geometry at 320/390/1440px.
PASS: real browser original DM panels and independent pointer resizing, native server stages and secondary camera, compact global bar, two accepted DMs, mixed calls, two server voices in one tab, bidirectional WebRTC audio with another browser, navigation through DMs/servers/text/settings, cross-server move preserving the other call, 320/390/1440 widths and reachable composer, privacy including titles, independent microphones/sound/hangup, DM/primary/secondary reconnect, clean final hide, no JavaScript errors.
PASS: two DMs, mixed calls, two server voices, cross-server camera/screen quota, concurrent joins, third rejected, ringing reservation, leave/disconnect release, switching, permissions, anonymous observer payloads, device synchronization, reconnect snapshot, preference restart persistence.
```

`node tests/admin-presence.cjs --browser` — code de sortie **0** :

```text
PASS: mobile browser, role colors, profile badges, admin settings, keyboard viewport, no JavaScript errors.
PASS: admin permissions, hierarchy, bans, audit, role profiles, live presence, invisibility, restart persistence, PWA assets.
```

`node --check` sur `public/app.js`, `public/people-call-bar.js`, `public/people-camera-effects.js`, `public/people-dm-calls.js`, `public/people-server-voice-ui.js` et `tests/simultaneous-calls-browser.cjs` : **6 validations réussies**, aucune sortie d’erreur.

`git diff --check` : **code de sortie 0**, aucune sortie.

Captures : `bar-320.png`, `bar-390.png`, `bar-1440.png`, `voice-320.png`, `voice-390.png`, `voice-1440.png` dans ce dossier.
