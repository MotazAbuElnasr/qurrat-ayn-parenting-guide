// Check every content bundle and stamp the shell with the ones that exist.
//
//   node build/build.js
//
// The bundles in docs/content are the content now — docs/index.html is the shell
// that loads one of them. Editing content means editing a bundle, not the page.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'docs', 'content');
const SHELL = path.join(ROOT, 'docs', 'index.html');
const ORDER = ['msa', 'eg', 'sham', 'gulf', 'maghreb'];

/* اللهجات اللي بتتفحص غير اللي بتتنشر. البناء بيتحقق من كل حزمة موجودة
   عشان الدرف يبان، بس القارئ بيتعرضله اللي في PUBLISHED بس. المصري تحت
   المراجعة دلوقتي والباقي لسه على التركيب القديم — فمفيش سويتشر. */
const PUBLISHED = ['eg'];
const NAMES = { msa: 'العربية الفصحى', eg: 'مصري', sham: 'شامي', gulf: 'خليجي', maghreb: 'مغربي' };

const ARRAYS = ['VALUES', 'SITS', 'MEALS', 'ACT', 'DAY', 'BOX', 'SCHOOLS', 'RES', 'YTC', 'VID', 'PVID', 'ST', 'STX'];

/* what the site's rules say, as a check rather than a hope */
const LOCATOR = /(?<!\p{L})(?:ال)?(?:إمارات|امارات|أبوظبي|دبي|شارقة|مصر|إسكندرية|درهم|جنيه|ريال)(?!\p{L})/gu;
// citing a source is not telling the reader where they live
const SOURCEISH = /href=|مكتبة|مكتبات|منصة|قناة|مؤسسة|هيئة|جامعة|مهرجان|دار |Twinkl|منهج|بالعربي/;

function check(file) {
  const d = path.basename(file, '.json');
  const problems = [];
  let b;
  try { b = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return { d, problems: ['JSON مكسور: ' + e.message] }; }

  if (b.dialect !== d) problems.push(`dialect في الملف "${b.dialect}" مش "${d}"`);
  if (!b.data) problems.push('مفيش data');
  else for (const n of ARRAYS) {
    if (!Array.isArray(b.data[n])) problems.push(`${n} ناقصة`);
    else if (!b.data[n].length) problems.push(`${n} فاضية`);
  }
  if (!b.prose || !b.prose.ref || !b.prose.food) problems.push('prose ناقصة');

  const text = JSON.stringify(b);
  if (/`|\$\{/.test(text)) problems.push('فيه backtick أو ${ — بيكسر أي حقن في قالب');
  for (let m; (m = LOCATOR.exec(text));) {
    const ctx = text.slice(Math.max(0, m.index - 420), m.index + 80);
    if (!SOURCEISH.test(ctx)) problems.push(`بيحدد مكان القارئ: ${m[0]} — …${ctx.slice(380, 470)}…`);
  }
  /* A value's name is a key, not just a heading: situations point at it through
     vals, videos through VID[5], and the reference through goVal('…'). Translate
     the name without moving the references and every one of those links dies
     silently — the chip renders, the click does nothing. */
  if (b.data?.VALUES) {
    const names = new Set(b.data.VALUES.map(v => v.name));
    const dead = new Set();
    for (const s of b.data.SITS || []) for (const v of s.vals || []) if (!names.has(v)) dead.add(`SITS «${s.t}» → ${v}`);
    for (const v of b.data.VID || []) for (const n of (Array.isArray(v[5]) ? v[5] : [])) if (!names.has(n)) dead.add(`VID → ${n}`);
    for (const m of (b.prose?.ref || '').matchAll(/goVal\('([^']+)'\)/g)) if (!names.has(m[1])) dead.add(`prose.ref → ${m[1]}`);
    for (const m of (b.prose?.food || '').matchAll(/goVal\('([^']+)'\)/g)) if (!names.has(m[1])) dead.add(`prose.food → ${m[1]}`);
    for (const x of [...dead].slice(0, 10)) problems.push('وصلة ميتة لقيمة: ' + x);
    if (dead.size > 10) problems.push(`… و${dead.size - 10} وصلة ميتة كمان`);
  }

  /* The sub-page maps match on heading text, and headings are translated. A marker
     that matches nothing does not error — the splitter just leaves that section
     with whichever group matched last, so the pages quietly fill up wrong. */
  if (b.nav && b.prose) {
    const heads = html => [...String(html).matchAll(/<h2 class="sec">([\s\S]*?)<\/h2>/g)]
      .map(m => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    const refHeads = heads(b.prose.ref);
    const seen = new Set();
    for (const [group, marks] of Object.entries(b.nav.toc2 || {}))
      for (const m of marks) {
        const hit = refHeads.filter(h => h.includes(m));
        if (!hit.length) problems.push(`علامة قسم مش بتطابق أي عنوان: «${m}» في «${group}»`);
        else if (hit.length > 1) problems.push(`علامة قسم بتطابق ${hit.length} عناوين: «${m}»`);
        hit.forEach(h => seen.add(h));
      }
    const missed = refHeads.filter(h => !seen.has(h));
    if (missed.length) problems.push(`${missed.length} قسم مش في أي مجموعة، أولهم «${missed[0].slice(0, 40)}»`);
  }

  const counts = Object.fromEntries(ARRAYS.filter(n => b.data?.[n]).map(n => [n, b.data[n].length]));
  return { d, problems, counts, size: fs.statSync(file).size };
}

const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => f.endsWith('.json')) : [];
if (!files.length) { console.error('مفيش حزم في docs/content'); process.exit(1); }

let bad = 0;
const ok = [];
for (const f of files.sort()) {
  const r = check(path.join(DIR, f));
  const head = `${(NAMES[r.d] || r.d).padEnd(14)} ${((r.size || 0) / 1024).toFixed(0)}KB`;
  if (r.problems.length) {
    bad++;
    console.log(`✗ ${head}`);
    r.problems.slice(0, 8).forEach(p => console.log('    ' + p));
  } else {
    ok.push(r.d);
    console.log(`✓ ${head}  ${JSON.stringify(r.counts)}`);
  }
}

/* Egyptian is the source every other dialect is written from, so the shapes
   must line up — a missing value in a translation is a hole, not a choice */
const base = ok.includes('eg') && JSON.parse(fs.readFileSync(path.join(DIR, 'eg.json'), 'utf8'));

/* every leaf of ui, as a path — the shell reads these by name */
const uiKeys = (o, p = '', out = []) => {
  for (const [k, v] of Object.entries(o || {})) {
    const q = p ? `${p}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) uiKeys(v, q, out); else out.push(q);
  }
  return out;
};

if (base) {
  const baseUI = uiKeys(base.ui);
  const baseSecs = h => (String(h).match(/<h2 class="sec">/g) || []).length;
  for (const d of ok.filter(x => x !== 'eg')) {
    const b = JSON.parse(fs.readFileSync(path.join(DIR, d + '.json'), 'utf8'));
    for (const n of ARRAYS) {
      if (b.data[n].length !== base.data[n].length) {
        console.log(`✗ ${d}: ${n} فيها ${b.data[n].length} والمصري فيه ${base.data[n].length}`);
        bad++;
      }
    }
    /* A ui key the shell asks for and the bundle does not have is not a missing
       word — the read throws and the whole bundle renders as nothing. Adding a
       key to Egyptian without adding it everywhere took the site down once. */
    const mine = new Set(uiKeys(b.ui));
    const missing = baseUI.filter(k => !mine.has(k));
    if (missing.length) {
      console.log(`✗ ${d}: ${missing.length} مفتاح ui ناقص — ${missing.slice(0, 6).join(' · ')}`);
      bad++;
    }
    /* sections live in prose, so nothing above would notice a dialect that kept
       a section the Egyptian dropped */
    for (const f of ['ref', 'food']) {
      const [a, c] = [baseSecs(base.prose[f]), baseSecs(b.prose[f])];
      if (a !== c) { console.log(`✗ ${d}: prose.${f} فيها ${c} قسم والمصري فيه ${a}`); bad++; }
    }
  }
}

if (bad) { console.error(`\n${bad} مشكلة — مفيش ختم`); process.exit(1); }

const list = ORDER.filter(d => ok.includes(d) && PUBLISHED.includes(d));
if (!list.length) { console.error('مفيش لهجة منشورة'); process.exit(1); }
const held = ORDER.filter(d => ok.includes(d) && !PUBLISHED.includes(d));

/* Two places have to agree on which bundles exist: the shell, so the selector
   only offers real ones, and the worker, so it never sends a reader to a file
   that is not there. Neither is kept by hand — a stale list is invisible. */
const STAMPS = [
  [SHELL, /const DIALECTS_AVAILABLE=\[[^\]]*\]; \/\* build:dialects \*\//,
    l => `const DIALECTS_AVAILABLE=${l}; /* build:dialects */`],
  [path.join(ROOT, 'src', 'index.js'), /const AVAILABLE = \[[^\]]*\]; \/\* build:dialects \*\//,
    l => `const AVAILABLE = ${l}; /* build:dialects */`],
];
for (const [file, rx, make] of STAMPS) {
  let txt = fs.readFileSync(file, 'utf8');
  if (!rx.test(txt)) { console.error('مفيش ختم لهجات في ' + path.relative(ROOT, file)); process.exit(1); }
  fs.writeFileSync(file, txt.replace(rx, make(JSON.stringify(list))));
}

/* The counters inside the app compute themselves; the ones in <head> cannot —
   it is static markup, and nothing on the page would ever look wrong when it
   goes stale. It already did: the description said 42 مواقف while the bundle
   had 50, and that number is what a search result shows. Stamped from the
   Egyptian bundle, which is the origin every other dialect is checked against. */
{
  const src = JSON.parse(fs.readFileSync(path.join(DIR, 'eg.json'), 'utf8')).data;
  const line = /مرجع تربوي عربي للطفولة المبكرة: \d+ قيمة بخطوات عملية، \d+ موقف يومي بجُمل جاهزة، \d+ قصة/g;
  let txt = fs.readFileSync(SHELL, 'utf8');
  const hits = (txt.match(line) || []).length;
  if (!hits) { console.error('مفيش وصف في القشرة يتختم عليه'); process.exit(1); }
  txt = txt.replace(line, `مرجع تربوي عربي للطفولة المبكرة: ${src.VALUES.length} قيمة بخطوات عملية، ` +
    `${src.SITS.length} موقف يومي بجُمل جاهزة، ${src.ST.length + src.STX.length} قصة`);
  fs.writeFileSync(SHELL, txt);
  console.log(`اتختم الوصف في ${hits} موضع: ${src.VALUES.length} قيمة · ${src.SITS.length} موقف · ${src.ST.length + src.STX.length} قصة`);
}
console.log(`\nاتختم في القشرة والـworker: ${list.map(d => NAMES[d]).join(' · ')}`);
if (held.length) console.log(`متحجوزة (اتفحصت ومش منشورة): ${held.map(d => NAMES[d]).join(' · ')}`);
