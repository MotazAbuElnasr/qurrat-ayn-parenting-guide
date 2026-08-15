// Build docs/content/sham.json out of the translated batches.
//   node assemble.mjs
//
// Nothing here is a judgement call: batches land at the index they were cut from,
// the story arrays are copied, the value renames are applied everywhere at once,
// and the sub-page markers are read off the translated headings by position.
import fs from 'fs';
import path from 'path';

/* batches live outside the repo — set WORK to a scratch dir */
const HERE = process.env.WORK || path.dirname(new URL(import.meta.url).pathname);
const SELF = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(SELF, '..', '..');
const IN = path.join(HERE, 'in'), OUT = path.join(HERE, 'out');
const eg = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/content/eg.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'manifest.json'), 'utf8'));

/* A value's name is a key three other places point at, so it is renamed once, here,
   and propagated — never by the translator, who can only reach one of the four. */
const DIALECT = process.argv[2] || 'sham';
const NAMES = { msa: 'العربية الفصحى', eg: 'مصري', sham: 'شامي', gulf: 'خليجي', maghreb: 'مغربي' };
/* per-dialect; a name only moves when the Egyptian one carries a word the
   dialect does not use. Keep it short — every entry is a rename to propagate. */
const RENAME_BY_DIALECT = {
  sham: {
    'ضم الآخرين: محدش يتساب لوحده': 'ضم الآخرين: ما حدا بينترك لحاله',
    'الانتماء وهويتي: أنا مين': 'الانتماء وهويتي: مين أنا',
    'الغيرة بين الإخوات': 'الغيرة بين الإخوة',
  },
};
const RENAMES = RENAME_BY_DIALECT[DIALECT] || {};
const rename = n => RENAMES[n] || n;

const die = m => { console.error('✗ ' + m); process.exit(1); };
const read = n => JSON.parse(fs.readFileSync(path.join(OUT, n + '.json'), 'utf8'));

/* ---- data ---------------------------------------------------------------- */
const data = {};
for (const m of manifest.filter(x => x.kind === 'array')) {
  const o = read(m.name);
  const a = (data[m.array] = data[m.array] || []);
  if (o.items.length !== m.to - m.from) die(`${m.name}: ${o.items.length} عنصر والمفروض ${m.to - m.from}`);
  o.items.forEach((it, i) => {
    if (a[m.from + i] !== undefined) die(`${m.name}: العنصر ${m.from + i} متكرر`);
    a[m.from + i] = it;
  });
}
for (const m of manifest.filter(x => x.kind === 'arrays')) {
  const o = read(m.name);
  for (const k of m.arrays) {
    if (!Array.isArray(o.arrays?.[k])) die(`${m.name}: ${k} ناقصة`);
    data[k] = o.arrays[k];
  }
}
/* story titles and links are the same in every dialect — msa left all 604 untouched */
data.ST = eg.data.ST;
data.STX = eg.data.STX;

for (const k of Object.keys(eg.data)) {
  if (!data[k]) die(`${k} ما اتجمعتش`);
  if (data[k].length !== eg.data[k].length) die(`${k}: ${data[k].length} والمصري ${eg.data[k].length}`);
  if (data[k].some(x => x === undefined)) die(`${k}: فيها فجوة — دفعة ناقصة`);
}

/* ---- prose --------------------------------------------------------------- */
const prose = {};
for (const field of ['ref', 'food']) {
  const parts = manifest.filter(x => x.kind === 'prose' && x.field === field);
  prose[field] = parts.map(m => {
    const f = path.join(OUT, m.name + '.html');
    if (!fs.existsSync(f)) die(`${m.name}.html ناقص`);
    return fs.readFileSync(f, 'utf8');
  }).join('');
}

/* ---- the rename, everywhere it is pointed at ----------------------------- */
for (const v of data.VALUES) v.name = rename(v.name);
for (const s of data.SITS) s.vals = (s.vals || []).map(rename);
for (const v of data.VID) if (Array.isArray(v[5])) v[5] = v[5].map(rename);
for (const [from, to] of Object.entries(RENAMES))
  for (const f of ['ref', 'food'])
    prose[f] = prose[f].split(`goVal('${from}')`).join(`goVal('${to}')`);

/* ---- ui + nav ------------------------------------------------------------ */
const ui = read('UI-01');
const labels = ui.navLabels || die('UI-01: navLabels ناقصة');

const heads = html => [...String(html).matchAll(/<h2 class="sec">([\s\S]*?)<\/h2>/g)]
  .map(m => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
const egRef = heads(eg.prose.ref), shRef = heads(prose.ref);
const egFood = heads(eg.prose.food), shFood = heads(prose.food);
if (egRef.length !== shRef.length) die(`عناوين المرجع ${shRef.length} والمصري ${egRef.length}`);
if (egFood.length !== shFood.length) die(`عناوين الأكل ${shFood.length} والمصري ${egFood.length}`);

/* An Egyptian marker names one Egyptian heading; the translated marker is whatever
   heading sits at that same index. No text matching across languages, so a marker
   cannot quietly fall through to the previous group the way a hand-written one can. */
function mark(m, egH, shH, where) {
  const hits = egH.map((h, i) => (h.includes(m) ? i : -1)).filter(i => i >= 0);
  if (hits.length !== 1) die(`${where}: «${m}» بيطابق ${hits.length} عناوين في المصري`);
  const t = shH[hits[0]];
  const back = shH.filter(h => h.includes(t)).length;
  if (back !== 1) die(`${where}: العنوان المترجم «${t}» بيطابق ${back} عناوين — علامة ملتبسة`);
  return t;
}

/* secGo jumps to a section by matching its heading text, and fails silently when
   nothing matches — no error, the chip just does nothing. msa translated its
   headings but left these arguments Egyptian and lost 4 of 24 jumps that way.
   So the argument is rewritten here, positionally, exactly like the nav markers,
   and the chip's visible text with it. */
const shortLabel = h => h
  .replace(/^\s*\d+\s*·\s*/, '')
  .replace(/\s*(?:أدلة (?:قوية|متوسطة)|ممارسة شائعة)\s*$/, '')
  .trim();

function sectionKey(arg) {
  const needle = arg.replace(/^\s*\d+\s*·\s*/, '');
  const hits = egRef.map((h, i) => (h.includes(needle) ? i : -1)).filter(i => i >= 0);
  if (hits.length !== 1) die(`secGo: «${arg}» بيطابق ${hits.length} عناوين في المصري`);
  const full = shortLabel(shRef[hits[0]]);
  /* prefer the part before a colon — closer in length to the Egyptian chip —
     but only when it still names exactly one section */
  const short = full.split(/\s*[:—]\s*/)[0].trim();
  for (const cand of [short, full]) {
    if (cand && shRef.filter(h => h.includes(cand)).length === 1) return cand;
  }
  die(`secGo: ما لقيتش نص فريد لقسم «${arg}» (${full})`);
}

let jumps = 0;
for (const f of ['ref', 'food']) {
  /* the chip carries the same words twice: inside the call and on its face */
  prose[f] = prose[f].replace(
    /(<span class="chip" onclick="secGo\('ref',')([^']*)('\)">)([^<]*?)(\s*<i>)/g,
    (_, a, arg, b, __, d) => { jumps++; const k = sectionKey(arg); return a + k + b + k + ' ' + d.trimStart(); });
  /* anything not in that shape still needs a live argument */
  prose[f] = prose[f].replace(/secGo\('ref','([^']*)'\)/g,
    (m, arg) => (egRef.some(h => h.includes(arg.replace(/^\s*\d+\s*·\s*/, ''))) && !shRef.some(h => h.includes(arg.replace(/^\s*\d+\s*·\s*/, '')))
      ? `secGo('ref','${sectionKey(arg)}')` : m));
}

/* one label above the related-sections row; translators worded it three ways */
const lbls = [...new Set([...prose.ref.matchAll(/<span class="lbl">([^<]*)<\/span>/g)].map(m => m[1]))];
if (lbls.length > 1) {
  const pick = lbls.map(l => [l, prose.ref.split(`>${l}<`).length]).sort((a, b) => b[1] - a[1])[0][0];
  for (const f of ['ref', 'food'])
    for (const l of lbls) if (l !== pick) prose[f] = prose[f].split(`<span class="lbl">${l}</span>`).join(`<span class="lbl">${pick}</span>`);
  console.log(`  لافتة «مرتبط»: وحّدت ${lbls.length} صيغة على «${pick}»`);
}

const toc2 = {};
Object.entries(eg.nav.toc2).forEach(([g, marks], i) => {
  const label = labels.toc2[i];
  if (!label) die(`navLabels.toc2[${i}] ناقص`);
  if (toc2[label]) die(`عنوان مجموعة متكرر: «${label}»`);
  toc2[label] = marks.map(m => mark(m, egRef, shRef, `toc2/${g}`));
});

const subpages = { sits: [], food: [] };
eg.nav.subpages.sits.forEach(([, marks], i) => {
  const label = labels.subpages.sits[i] || die(`navLabels.subpages.sits[${i}] ناقص`);
  subpages.sits.push([label, marks.slice()]);   // SITS[].group is literal, so are these
});
eg.nav.subpages.food.forEach(([, marks], i) => {
  const label = labels.subpages.food[i] || die(`navLabels.subpages.food[${i}] ناقص`);
  /* two of these markers name headings the shell prints itself, identical in every
     dialect — they have no translated twin to look up */
  subpages.food.push([label, marks.map(m => (egFood.some(h => h.includes(m)) ? mark(m, egFood, shFood, 'subpages/food') : m))]);
});

/* ---- every jump has to land, or it is worse than not being there ---------- */
{
  const bad = [];
  for (const f of ['ref', 'food'])
    for (const m of prose[f].matchAll(/secGo\('ref','([^']*)'\)/g)) {
      const n = m[1].replace(/^\s*\d+\s*·\s*/, '');
      const hits = shRef.filter(h => h.includes(n)).length;
      if (hits !== 1) bad.push(`${f}: «${m[1]}» → ${hits} عناوين`);
    }
  if (bad.length) { bad.forEach(b => console.error('✗ وصلة قسم: ' + b)); process.exit(1); }
}

/* ---- write --------------------------------------------------------------- */
const bundle = { dialect: DIALECT, name: NAMES[DIALECT] || DIALECT, version: eg.version, data, prose, ui: ui.ui, nav: { toc2, subpages } };
for (const k of Object.keys(eg.data)) bundle.data[k] = data[k];
const dst = path.join(REPO, `docs/content/${DIALECT}.json`);
fs.writeFileSync(dst, JSON.stringify(bundle));
console.log(`✓ ${path.relative(REPO, dst)} — ${(fs.statSync(dst).size / 1024).toFixed(0)}KB`);
console.log('  ' + Object.entries(data).map(([k, v]) => `${k}=${v.length}`).join(' '));
console.log(`  أقسام المرجع ${shRef.length} · مجموعات ${Object.keys(toc2).length} (${Object.values(toc2).map(v => v.length).join('-')})`);
console.log(`  تسميات اتنقلت: ${Object.keys(RENAMES).length} · وصلات أقسام اتصلّحت: ${jumps}`);
