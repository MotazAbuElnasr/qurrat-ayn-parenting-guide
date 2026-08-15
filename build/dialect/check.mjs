// Compare one translated batch against its Egyptian source, mechanically.
//   node check.mjs VALUES-03      one batch
//   node check.mjs                every batch that has an output
//
// Catches the whole class a human reviewer is bad at: a dropped item, a renamed
// key, a digit that drifted, a URL that lost a character, a tag that moved.
import fs from 'fs';
import path from 'path';

/* batches live outside the repo — set WORK to a scratch dir */
const HERE = process.env.WORK || path.dirname(new URL(import.meta.url).pathname);
const IN = path.join(HERE, 'in'), OUT = path.join(HERE, 'out');

/* indices/keys the code matches on — translating them breaks the site silently */
const LITERAL = {
  /* adapt[].kid is a fixed vocabulary repeated across all 72 values — msa kept all
     216 of them untouched, and a per-batch translation would splinter the label */
  VALUES: ['name', 'cat', 'age', 'lvl', 'ord', 'tag', 'src', 'evi.c', 'evi.schools', 'evi.src', 'adapt[].kid'],
  SITS: ['group', 'vals', 'evi.c', 'evi.schools', 'evi.src'],
  MEALS: ['k', 'tg', 'nu', 'age'],
  ACT: [0, 3, 6],
  DAY: [0, 1, 3],
  BOX: [],
  SCHOOLS: [0, 1],
  RES: [0, 2, 3],
  YTC: [0, 1, 3],
  VID: [0, 1, 2, 3, 4, 5],
};
const LOCATOR = /(?<!\p{L})(?:ال)?(?:إمارات|امارات|أبوظبي|دبي|شارقة|مصر|إسكندرية|درهم|جنيه|ريال|ليرة|شيكل|دينار)(?!\p{L})/gu;
const SOURCEISH = /href=|مكتبة|مكتبات|منصة|قناة|مؤسسة|هيئة|جامعة|مهرجان|دار |Twinkl|منهج|بالعربي/;

const num = s => (String(s).match(/[\d٠-٩]+/g) || []).sort();
const url = s => (String(s).match(/https?:\/\/[^\s"'<>)\]]+/g) || []).sort();
const lat = s => (String(s).match(/[A-Za-z][A-Za-z.&''-]*/g) || []).sort();
const tags = s => (String(s).match(/<[^>]+>/g) || []);
const gov = s => [...String(s).matchAll(/goVal\('([^']*)'\)/g)].map(m => m[1]);
const txt = v => JSON.stringify(v);
const eqs = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function shape(a, b, p, out) {
  if (Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null) || typeof a !== typeof b)
    return out.push(`${p}: نوع مختلف (${Array.isArray(a) ? 'array' : typeof a} ← ${Array.isArray(b) ? 'array' : typeof b})`);
  if (Array.isArray(a)) {
    if (a.length !== b.length) return out.push(`${p}: طول ${b.length} والأصل ${a.length}`);
    a.forEach((x, i) => shape(x, b[i], `${p}[${i}]`, out));
  } else if (a && typeof a === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    for (const k of ka) if (!(k in b)) out.push(`${p}.${k}: مفتاح ناقص`);
    for (const k of kb) if (!(k in a)) out.push(`${p}.${k}: مفتاح زايد`);
    for (const k of ka) if (k in b) shape(a[k], b[k], `${p}.${k}`, out);
  }
}

/* "evi.c" walks in; "adapt[].kid" maps over the array and collects the field */
const dig = (o, p) => {
  const s = String(p).split('[].');
  const walk = (x, path) => path.split('.').reduce((y, k) => (y == null ? y : y[k]), x);
  if (s.length === 1) return walk(o, s[0]);
  const arr = walk(o, s[0]);
  return Array.isArray(arr) ? arr.map(x => walk(x, s[1])) : arr;
};

function pair(src, dst, label, out) {
  const [a, b] = [txt(src), txt(dst)];
  if (!eqs(num(a), num(b))) out.push(`${label}: أرقام اتغيرت — الأصل [${num(a).join(',')}] والترجمة [${num(b).join(',')}]`);
  if (!eqs(url(a), url(b))) out.push(`${label}: روابط اتغيرت`);
  /* distinct tokens, not counts — a translator may say AAP once where the Egyptian
     said it twice, and that is not a defect. A token that vanished is. */
  const A = new Set(lat(a)), B = new Set(lat(b));
  const gone = [...A].filter(x => !B.has(x)), add = [...B].filter(x => !A.has(x));
  if (gone.length || add.length)
    out.push(`${label}: لاتيني اتغير — ناقص [${gone.slice(0, 8)}] زايد [${add.slice(0, 8)}]`);
}

function banned(s, label, out) {
  if (/`|\$\{/.test(s)) out.push(`${label}: فيه backtick أو \${`);
  for (let m; (m = LOCATOR.exec(s));) {
    const ctx = s.slice(Math.max(0, m.index - 420), m.index + 60);
    if (!SOURCEISH.test(ctx)) out.push(`${label}: بيحدد مكان القارئ «${m[0]}» — …${ctx.slice(-90)}…`);
  }
  LOCATOR.lastIndex = 0;
}

function checkArrayBatch(inp, o, out) {
  const key = inp.array;
  shape(inp.items, o.items, key, out);
  if (out.length) return;                       // shape first; the rest assumes it holds
  inp.items.forEach((src, i) => {
    const dst = o.items[i], label = `${key}[${inp.from + i}]`;
    for (const f of LITERAL[key] || [])
      if (txt(dig(src, f)) !== txt(dig(dst, f)))
        out.push(`${label}.${f}: لازم يتنسخ حرفيًا — الأصل ${txt(dig(src, f))} والترجمة ${txt(dig(dst, f))}`);
    pair(src, dst, label, out);
  });
  banned(txt(o.items), key, out);
}

function checkArraysBatch(inp, o, out) {
  for (const key of Object.keys(inp.arrays)) {
    const a = inp.arrays[key], b = (o.arrays || {})[key];
    if (!b) { out.push(`${key}: ناقصة من المخرج`); continue; }
    const s = []; shape(a, b, key, s);
    if (s.length) { out.push(...s); continue; }
    a.forEach((src, i) => {
      const label = `${key}[${i}]`;
      for (const f of LITERAL[key] || [])
        if (txt(dig(src, f)) !== txt(dig(b[i], f)))
          out.push(`${label}[${f}]: لازم يتنسخ حرفيًا — الأصل ${txt(dig(src, f))} والترجمة ${txt(dig(b[i], f))}`);
      pair(src, b[i], label, out);
    });
    banned(txt(b), key, out);
  }
}

function checkProse(a, b, out) {
  const [ta, tb] = [tags(a), tags(b)];
  if (ta.length !== tb.length) out.push(`عدد الوسوم ${tb.length} والأصل ${ta.length}`);
  else { const i = ta.findIndex((t, j) => t !== tb[j]); if (i >= 0) out.push(`وسم رقم ${i} اتغير: ${ta[i]} ← ${tb[i]}`); }
  const [ga, gb] = [gov(a), gov(b)];
  if (!eqs(ga, gb)) out.push(`goVal اتغير — الأصل [${ga.filter(x => !gb.includes(x))}] والترجمة [${gb.filter(x => !ga.includes(x))}]`);
  const h = s => (s.match(/<h2 class="sec">/g) || []).length;
  if (h(a) !== h(b)) out.push(`عدد أقسام h2 ${h(b)} والأصل ${h(a)}`);
  pair(a, b, 'النثر', out);
  banned(b, 'النثر', out);
}

function checkUI(inp, o, out) {
  shape(inp.ui, o.ui, 'ui', out);
  /* nav markers are not translated by hand — assemble.mjs derives them positionally
     from the translated headings. Only the visible group labels come from here. */
  const n = o.navLabels || {};
  const wantT = Object.keys(inp.nav.toc2).length;
  if (!Array.isArray(n.toc2) || n.toc2.length !== wantT) out.push(`navLabels.toc2: لازم ${wantT} عنوان مجموعة بالترتيب`);
  for (const k of ['sits', 'food']) {
    const w = inp.nav.subpages[k].length;
    if (!Array.isArray(n.subpages?.[k]) || n.subpages[k].length !== w) out.push(`navLabels.subpages.${k}: لازم ${w} عنوان بالترتيب`);
  }
  if (out.length) return;
  const leaves = (obj, p = '', acc = {}) => {
    for (const [k, v] of Object.entries(obj)) {
      const q = p ? p + '.' + k : k;
      if (v && typeof v === 'object') leaves(v, q, acc); else acc[q] = String(v);
    }
    return acc;
  };
  const A = leaves(inp.ui), B = leaves(o.ui);
  for (const k of Object.keys(A)) {
    const ph = s => (s.match(/\{\d\}/g) || []).sort();
    if (!eqs(ph(A[k]), ph(B[k]))) out.push(`ui.${k}: خانات {0}/{1} اتغيرت — الأصل «${A[k]}» الترجمة «${B[k]}»`);
  }
  pair(inp.ui, o.ui, 'ui', out);
  banned(txt(o.ui) + txt(o.navLabels), 'ui/nav', out);
}

const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'manifest.json'), 'utf8'));
const want = process.argv[2];
let fails = 0, done = 0, missing = [];
for (const m of manifest) {
  if (want && m.name !== want) continue;
  const ext = m.kind === 'prose' ? '.html' : '.json';
  const of = path.join(OUT, m.name + ext);
  if (!fs.existsSync(of)) { missing.push(m.name); continue; }
  done++;
  const out = [];
  try {
    if (m.kind === 'prose') checkProse(fs.readFileSync(path.join(IN, m.name + ext), 'utf8'), fs.readFileSync(of, 'utf8'), out);
    else {
      const inp = JSON.parse(fs.readFileSync(path.join(IN, m.name + ext), 'utf8'));
      const o = JSON.parse(fs.readFileSync(of, 'utf8'));
      if (m.kind === 'array') checkArrayBatch(inp, o, out);
      else if (m.kind === 'arrays') checkArraysBatch(inp, o, out);
      else checkUI(inp, o, out);
    }
  } catch (e) { out.push('انفجر: ' + e.message); }
  if (out.length) { fails++; console.log(`✗ ${m.name}`); out.slice(0, 14).forEach(p => console.log('    ' + p)); if (out.length > 14) console.log(`    … و${out.length - 14} كمان`); }
  else console.log(`✓ ${m.name}`);
}
if (!want && missing.length) console.log(`\nلسه ما اتسلّمت (${missing.length}): ${missing.join(' ')}`);
console.log(fails ? `\n${fails} من ${done} فيها مشاكل` : `\n${done} تمام`);
process.exit(fails ? 1 : 0);
