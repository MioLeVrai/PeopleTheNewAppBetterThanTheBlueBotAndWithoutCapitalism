// Translate parsed source literals, never runtime user content or saved names.
const fs = require('node:fs'), crypto = require('node:crypto');
const acorn = { exports: {} };
new Function('exports', 'module', process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'])(acorn.exports, acorn);
const translations = new Map(fs.readFileSync('patchcorrection/en-translations.tsv', 'utf8').split(/\r?\n/).filter(line => line.includes('\t')).map(line => { const [key, value] = line.split('\t'); return [key.trim().replace(/\s+/g, ' '), value]; }));
const dictionary = fs.existsSync('public/people-i18n.js') ? require('../public/people-i18n.js').messages : {};
function lookup(value) {
  const text = value.trim().replace(/\s+/g, ' ');
  if (!translations.has(text)) return null;
  const english = translations.get(text);
  const id = 'ui_' + crypto.createHash('sha256').update(english).digest('hex').slice(0, 10);
  dictionary[id] = english;
  return { id, english, leading: value.match(/^\s*/)[0], trailing: value.match(/\s*$/)[0] };
}
function translateMarkup(value, fn) {
  return value.replace(/>([^<>]+)(?=<|$)/g, (all, text) => '>' + fn(text)).replace(/((?:title|placeholder|aria-label|alt)\s*=\s*")([^"]*)(")/g, (all, before, text, after) => before + fn(text) + after);
}
for (const file of ['server.js', ...fs.readdirSync('public').filter(f => f.endsWith('.js') && f !== 'people-i18n.js').map(f => 'public/' + f)]) {
  let source = fs.readFileSync(file, 'utf8');
  const tree = acorn.exports.parse(source, { ecmaVersion: 'latest' });
  const changes = [], prefix = file === 'server.js' ? 'peopleText' : 'window.PeopleI18n.t';
  const expression = value => { const item = lookup(value); return item ? JSON.stringify(item.leading) + ' + ' + prefix + '(' + JSON.stringify(item.id) + ') + ' + JSON.stringify(item.trailing) : null; };
  const template = value => { const item = lookup(value); return item ? item.leading + '${' + prefix + '(' + JSON.stringify(item.id) + ')}' + item.trailing : value; };
  function visit(node, parent) {
    if (node.type === 'Literal' && typeof node.value === 'string' && !(parent?.type === 'Property' && parent.key === node && !parent.computed)) {
      const replacement = expression(node.value);
      if (replacement && !['système', 'vocal', 'général'].includes(node.value)) changes.push({ start: node.start, end: node.end, replacement: '(' + replacement + ')' });
    }
    if (node.type === 'TemplateElement') {
      let next = node.value.raw.includes('<') ? translateMarkup(node.value.raw, template) : template(node.value.raw);
      // A static CSS drop-zone label is intentionally translated too.
      next = next.replace('content:"Dépose tes fichiers ici"', 'content:"Drop your files here"');
      if (next !== node.value.raw) changes.push({ start: node.start, end: node.end, replacement: next });
    }
    for (const [name, child] of Object.entries(node)) if (!['start', 'end', 'raw'].includes(name)) {
      if (Array.isArray(child)) child.forEach(c => { if (c?.type) visit(c, node); }); else if (child?.type) visit(child, node);
    }
  }
  visit(tree);
  for (const change of changes.sort((a, b) => b.start - a.start)) source = source.slice(0, change.start) + change.replacement + source.slice(change.end);
  if (file === 'server.js' && !source.includes('const peopleText =')) source = source.replace('const cryptoAccounts = require("crypto");', 'const cryptoAccounts = require("crypto");\nconst peopleText = require(pathAccounts.join(fsAccounts.existsSync(pathAccounts.join(__dirname, "public")) ? __dirname : process.cwd(), "public/people-i18n.js")).t;');
  if (file.includes('people-social.js')) source = source.replace(/new Intl.DateTimeFormat\(\s*"fr-FR"/g, 'new Intl.DateTimeFormat("en-US"');
  // Locale formatting does not affect stored identifiers or user text.
  source = source.replace(/toLocaleString\("fr-FR"\)/g, 'toLocaleString("en-US")');
  acorn.exports.parse(source, { ecmaVersion: 'latest' });
  if (source !== fs.readFileSync(file, 'utf8')) fs.writeFileSync(file, source);
}
let html = fs.readFileSync('public/index.html', 'utf8');
html = translateMarkup(html, value => { const item = lookup(value); return item ? item.leading + item.english + item.trailing : value; });
html = html.replace('<html lang="fr">', '<html lang="en">');
if (!html.includes('src="people-i18n.js')) html = html.replace('<script src="/socket.io/socket.io.js">', '<script src="people-i18n.js?v=20261010"></script>\n  <script src="/socket.io/socket.io.js">');
fs.writeFileSync('public/index.html', html);
fs.writeFileSync('public/people-i18n.js', '/* English UI catalogue shared by browser and server. User content is never passed through translation. */\n(function (root) {\n  const messages = ' + JSON.stringify(dictionary, null, 2) + ';\n  const api = { messages, t: key => messages[key] || key };\n  if (typeof module !== "undefined" && module.exports) module.exports = api;\n  else root.PeopleI18n = api;\n})(typeof window === "undefined" ? globalThis : window);\n');
console.log(Object.keys(dictionary).length + ' centralized English labels');
