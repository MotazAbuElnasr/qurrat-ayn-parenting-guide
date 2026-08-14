// Pull the content out of the single-file site into one JSON per dialect.
// The page becomes a shell; this is the only thing that knows how to read it.
//
//   node build/extract.js            -> docs/content/eg.json
//   node build/extract.js --check    -> verify only, write nothing
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'docs', 'index.html');
const OUT_DIR = path.join(ROOT, 'docs', 'content');

const html = fs.readFileSync(SRC, 'utf8');

/* ---- locate a top-level literal by counting brackets, never by regex ---- */
function span(name) {
  const i = html.indexOf('const ' + name + '=');
  if (i < 0) throw new Error('no ' + name);
  const eq = html.indexOf('=', i);
  let j = eq + 1, depth = 0, started = false, quote = null;
  for (; j < html.length; j++) {
    const c = html[j];
    if (quote) { if (c === '\\') j++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '[' || c === '{') { depth++; started = true; }
    else if (c === ']' || c === '}') { depth--; if (started && depth === 0) { j++; break; } }
  }
  return [eq + 1, j];
}
const grab = name => JSON.parse(html.slice(...span(name)));

const ARRAYS = ['VALUES', 'SITS', 'MEALS', 'ACT', 'DAY', 'BOX', 'SCHOOLS', 'RES', 'YTC', 'VID', 'ST', 'STX'];
const data = {};
for (const n of ARRAYS) data[n] = grab(n);

/* ---- the prose lives in template literals; render them once, here, so the
        JSON carries plain HTML and the browser never evaluates what it fetched ---- */
function template(startMark, endMark, label) {
  const a = html.indexOf(startMark);
  if (a < 0) throw new Error('no template: ' + label);
  const open = html.indexOf('`', a);
  let j = open + 1, quote = null;
  for (; j < html.length; j++) {
    const c = html[j];
    if (c === '\\') { j++; continue; }
    if (c === '`' && !quote) break;
    if (c === '$' && html[j + 1] === '{') {          // step over ${...}, braces may nest
      let d = 0; j += 1;
      for (; j < html.length; j++) {
        if (html[j] === '{') d++;
        else if (html[j] === '}') { d--; if (!d) break; }
      }
    }
  }
  const body = html.slice(open, j + 1);
  const end = html.indexOf(endMark, a);
  if (end >= 0 && j > end) throw new Error(label + ': template runs past its section');
  return body;
}

/* evaluate a template with the data in scope — the interpolations are all
   loops over static arrays, so the result is fixed per dialect */
function render(body, label) {
  const names = Object.keys(data);
  const fn = new Function(...names, 'return ' + body);
  const out = fn(...names.map(n => data[n]));
  if (typeof out !== 'string') throw new Error(label + ': did not render to a string');
  if (out.includes('${')) throw new Error(label + ': an interpolation survived');
  return out;
}

const prose = {};
const ZONES = [
  ['ref', '$("ref").innerHTML', '/* sits */'],
  ['food', '$("food").innerHTML', '/* meals'],
];
for (const [key, start, end] of ZONES) prose[key] = render(template(start, end, key), key);

/* ---- shape and sanity ---- */
const bundle = {
  dialect: 'eg',
  name: 'مصري',
  version: 1,
  data,
  prose,
};

const arabic = s => (s.match(/[؀-ۿ]/g) || []).length;
const stats = {};
for (const n of ARRAYS) stats[n] = data[n].length;
const chars = arabic(JSON.stringify(data)) + arabic(prose.ref) + arabic(prose.food);

/* the site's own rules, enforced at the boundary rather than trusted */
const text = JSON.stringify(bundle);
// match position by position — indexOf on the matched word always finds the first
// one, which quietly judges every hit by the context of hit number one
const RX = /(?<!\p{L})(?:ال)?(?:إمارات|امارات|أبوظبي|دبي|شارقة|مصر|إسكندرية|درهم|جنيه|ريال)(?!\p{L})/gu;
// citing a source is not telling the reader where they live, so a name inside a
// link or a resource entry is fine; running prose is not
const allowed = /href=|مكتبة|مكتبات|منصة|قناة|مؤسسة|هيئة|جامعة|مهرجان|دار |Twinkl|منهج|بالعربي/;
const realLocators = [];
for (let m; (m = RX.exec(text));) {
  const ctx = text.slice(Math.max(0, m.index - 420), m.index + 80);
  if (!allowed.test(ctx)) realLocators.push(m[0] + ' → ' + ctx.slice(360, 480));
}

console.log('عناصر:', JSON.stringify(stats));
console.log('نص عربي:', chars.toLocaleString(), 'حرف');
console.log('prose.ref:', (prose.ref.length / 1024).toFixed(0) + 'KB · prose.food:', (prose.food.length / 1024).toFixed(0) + 'KB');
console.log('تحديد مكان القارئ:', realLocators.length);
realLocators.slice(0,6).forEach(x=>console.log("  · "+x));

if (process.argv.includes('--check')) { console.log('فحص فقط — مفيش كتابة'); process.exit(0); }

fs.mkdirSync(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, 'eg.json');
fs.writeFileSync(out, JSON.stringify(bundle));
console.log('اتكتب:', path.relative(ROOT, out), (fs.statSync(out).size / 1024).toFixed(0) + 'KB');
