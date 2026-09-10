PEOPLE — PERSONNALISATION V4
============================

Ce patch corrige le décalage entre l’aperçu de palette et le rendu réel.

CAUSE DU BUG
------------
Le gros style.css historique contient plusieurs variables :root déclarées
avec !important (ex. --people-night, --people-deep, --people-ink).
Le module de personnalisation V3 écrivait les nouvelles couleurs en style
inline SANS !important. Résultat : certaines couleurs custom passaient
(champs / valeurs dérivées), mais les fonds principaux restaient bloqués
sur l’ancien thème sombre. D’où le rendu moitié violet / moitié sombre.

CORRECTIONS V4
--------------
- Les tokens actifs sont maintenant posés inline avec priorité !important.
- Les anciens alias --bg / --panel / --input / --brand / etc. sont aussi
  synchronisés pour neutraliser les vieux blocs CSS du projet.
- L’aperçu n’est plus trois gros rectangles : c’est une miniature de la vraie
  interface People (rail, sidebar, topbar, recherche, demandes, amis).
- La miniature utilise les mêmes rôles de couleur et les mêmes mélanges que
  l’interface réelle pour les champs, surfaces, texte secondaire et bordures.
- Cache-busting passé en V4.

INSTALLATION
------------
Copier le dossier public/ de ce patch à la racine du projet et remplacer les
fichiers existants. Aucun changement SQL ni serveur n’est nécessaire.

FICHIERS
--------
public/index.html
public/people-appearance.js
public/people-appearance.css
public/people-settings.js
public/people-settings.css
