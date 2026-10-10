const fs = require('node:fs');
const acorn = { exports: {} };
new Function('exports', 'module', process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'])(acorn.exports, acorn);
const found = new Map();
const french = /[àâçéèêëîïôùûüœ]|\b(?:Aucun|Aucune|Ajouter|Afficher|Annuler|Appel|Appels|Amis|Bannir|Caméra|Chargement|Choisir|Clique|Compte|Connexion|Créer|Date|Demandes|Déconnecter|Enregistrer|Envoyer|Erreur|Fermer|Hors ligne|Impossible|Inviter|Membre|Modifier|Paramètres|Pseudo|Quitter|Rejoindre|Raccrocher|Refuser|Retirer|Retour|Rôles|Salon|Serveur|Supprimer|Son|Tous|Vocal|Vous|Tu|Ton|Ta|Tes|Votre|Sons|Micro|Recherche|Copier|Liste|Personne|Pas|Voir|Ouvrir|Accepter|Activer|Actif|Couleur|par défaut|en cours|seulement|mot de passe|description|Notification|connecter)\b/i;
for (const file of ['server.js', ...fs.readdirSync('public').filter(f => f.endsWith('.js')).map(f => 'public/' + f)]) {
  const source = fs.readFileSync(file, 'utf8');
  const tree = acorn.exports.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  function visit(node, parent) {
    const value = node.type === 'Literal' && typeof node.value === 'string' ? node.value : node.type === 'TemplateElement' ? node.value.cooked : null;
    if (value && french.test(value) && !value.startsWith('[People') && !/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|ON |WHERE |JOIN |FROM |AND |ORDER )/.test(value)) {
      const context = source.slice(Math.max(0, (parent?.start ?? node.start) - 45), Math.min(source.length, (parent?.end ?? node.end) + 15)).replace(/\s+/g, ' ').slice(0, 170);
      if (!found.has(value)) found.set(value, []);
      found.get(value).push({ file, line: source.slice(0, node.start).split('\n').length, context });
    }
    for (const [key, child] of Object.entries(node)) if (!['start', 'end', 'raw'].includes(key)) {
      if (Array.isArray(child)) child.forEach(c => { if (c?.type) visit(c, node); }); else if (child?.type) visit(child, node);
    }
  }
  visit(tree);
}
fs.writeFileSync('patchcorrection/translation-inventory.json', JSON.stringify([...found].map(([text, uses]) => ({ text, uses })), null, 2));
console.log(found.size + ' candidate strings');
console.log([...found.keys()].filter(t => !t.includes('<')).join('\n'));
