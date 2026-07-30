import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const locDir = base + '/lib/i18n/locales';
const langs = ['fr', 'tr', 'en', 'es', 'de', 'ar'];
const data = Object.fromEntries(langs.map(l => [l, JSON.parse(fs.readFileSync(`${locDir}/${l}.json`, 'utf8'))]));
function flatten(o, p = '', out = {}) {
  for (const [k, v] of Object.entries(o)) { const key = p ? `${p}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out); else out[key] = v; }
  return out;
}
const flat = Object.fromEntries(langs.map(l => [l, flatten(data[l])]));
const frKeys = Object.keys(flat.fr);
console.log('fr toplam anahtar: ' + frKeys.length);
let missTotal = 0;
for (const l of langs.slice(1)) { const m = frKeys.filter(k => !(k in flat[l])); if (m.length) { console.log(`${l}: ${m.length} EKSIK`); m.slice(0, 10).forEach(k => console.log('  ! ' + k)); missTotal += m.length; } }
for (const l of langs.slice(1)) { const e = Object.keys(flat[l]).filter(k => !(k in flat.fr)); if (e.length) { console.log(`${l}: ${e.length} FAZLA`); e.slice(0,10).forEach(k=>console.log('  + '+k)); } }
console.log('EKSIK TOPLAM: ' + missTotal);
function has(k) { return k.split('.').reduce((o, p) => (o && typeof o === 'object' && p in o) ? o[p] : undefined, data.fr) !== undefined; }
function walk(dir, acc = []) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, acc); else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) acc.push(p); } return acc; }
const files = [...walk(base + '/app'), ...walk(base + '/components')];
const re = /\bt\(\s*(["'])((?:[^"'`\\])+?)\1/g;
let miss = [];
for (const f of files) { const s = fs.readFileSync(f, 'utf8'); const seen = new Set(); let m; while ((m = re.exec(s))) seen.add(m[2]); for (const k of seen) if (k.includes('.') && !k.endsWith('.') && !has(k)) miss.push(path.basename(f) + ' : ' + k); }
console.log('taranan dosya: ' + files.length + ', cozulmeyen statik t() anahtari: ' + miss.length);
miss.slice(0, 60).forEach(x => console.log('  ! ' + x));
