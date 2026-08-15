// Cut the Egyptian bundle into batches small enough for one agent to write in one file.
//   node slice.mjs
import fs from 'fs';
import path from 'path';

/* batches live outside the repo — set WORK to a scratch dir */
const HERE = process.env.WORK || path.dirname(new URL(import.meta.url).pathname);
const IN = path.join(HERE, 'in');
fs.rmSync(IN, { recursive: true, force: true });
fs.mkdirSync(IN, { recursive: true });

const SELF = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(SELF, '..', '..');
const eg = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/content/eg.json'), 'utf8'));

const put = (name, obj) => fs.writeFileSync(path.join(IN, name + '.json'), JSON.stringify(obj, null, 1));
const putRaw = (name, txt) => fs.writeFileSync(path.join(IN, name + '.html'), txt);

const manifest = [];
const pad = n => String(n).padStart(2, '0');

/* array batches: {name, from, to} so a batch that drifts by one item can still be
   merged back at the right index */
function chunkArray(key, capKB, maxItems) {
  const a = eg.data[key], cap = capKB * 1024;
  let from = 0, n = 1;
  while (from < a.length) {
    let to = from, bytes = 0;
    while (to < a.length) {
      const b = JSON.stringify(a[to]).length;
      if (to > from && (bytes + b > cap || to - from >= maxItems)) break;
      bytes += b; to++;
    }
    const name = `${key}-${pad(n++)}`;
    put(name, { batch: name, array: key, from, to, count: to - from, items: a.slice(from, to) });
    manifest.push({ name, kind: 'array', array: key, from, to, kb: +(JSON.stringify(a.slice(from, to)).length / 1024).toFixed(1) });
    from = to;
  }
}

chunkArray('VALUES', 34, 6);
chunkArray('SITS', 34, 8);
chunkArray('MEALS', 26, 45);
chunkArray('ACT', 26, 40);

/* the small arrays travel together */
const smalls = [['SMALL-01', ['DAY', 'BOX', 'SCHOOLS']], ['SMALL-02', ['RES', 'YTC']], ['SMALL-03', ['VID']]];
for (const [name, keys] of smalls) {
  const o = { batch: name, arrays: {} };
  for (const k of keys) o.arrays[k] = eg.data[k];
  put(name, o);
  manifest.push({ name, kind: 'arrays', arrays: keys, kb: +(JSON.stringify(o).length / 1024).toFixed(1) });
}

/* prose splits on section boundaries only — a batch that starts mid-tag is unfixable */
function chunkProse(field, capKB, prefix) {
  const html = eg.prose[field];
  const starts = [...html.matchAll(/<h2 class="sec">/g)].map(m => m.index);
  const bounds = [0, ...starts.slice(1), html.length];      // preamble rides with section 1
  const cap = capKB * 1024;
  let n = 1, s = 0;
  for (let i = 1; i < bounds.length; i++) {
    const next = bounds[i];
    const isLast = i === bounds.length - 1;
    const wouldBe = next - s;
    const nextNext = isLast ? null : bounds[i + 1];
    // close the batch when adding the following section would blow the cap
    if (isLast || (nextNext != null && nextNext - s > cap && wouldBe > 0)) {
      const name = `${prefix}-${pad(n++)}`;
      putRaw(name, html.slice(s, next));
      manifest.push({ name, kind: 'prose', field, from: s, to: next, kb: +((next - s) / 1024).toFixed(1) });
      s = next;
    }
  }
}
chunkProse('ref', 26, 'REF');
chunkProse('food', 22, 'FOOD');

/* only the visible nav labels travel to the translator — the section markers under
   them are derived from the translated headings by assemble.mjs, so they cannot
   drift out of sync with the prose the way hand-written markers do */
put('UI-01', {
  batch: 'UI-01', ui: eg.ui, nav: eg.nav,
  navLabels: {
    toc2: Object.keys(eg.nav.toc2),
    subpages: { sits: eg.nav.subpages.sits.map(p => p[0]), food: eg.nav.subpages.food.map(p => p[0]) },
  },
});
manifest.push({ name: 'UI-01', kind: 'ui', kb: +((JSON.stringify(eg.ui).length + JSON.stringify(eg.nav).length) / 1024).toFixed(1) });

fs.writeFileSync(path.join(HERE, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(manifest.map(m => `${m.name.padEnd(11)} ${String(m.kb).padStart(6)}KB  ${m.kind}${m.array ? ' ' + m.array + ' [' + m.from + ',' + m.to + ')' : ''}${m.arrays ? ' ' + m.arrays.join(',') : ''}`).join('\n'));
console.log('\nbatches:', manifest.length, '· total', manifest.reduce((a, b) => a + b.kb, 0).toFixed(0) + 'KB');
