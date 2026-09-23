// The canonical on-disk shape of a content pack: one field per line, and every
// prose field split into one HTML block per line. A minified pack diffs as a
// single changed line on GitHub; this shape diffs as the sentence that changed.
//
// The split is lossless — join('') gives back the exact string — so readers
// only need `joinProse` and never care which shape they got.

// before every block-level opener (and the closers of lists/details), nothing else
const BLOCK = /(?=<(?:h[1-4]|p|li|div|details|summary|ul|ol|table|tr)\b|<\/(?:ul|ol|details|table)>)/;

const joinProse = p => (Array.isArray(p) ? p.join('') : p);

// short arrays of scalars (age [3,5], story tuples) stay on one line
function fmt(v, ind = '') {
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    if (v.every(x => x === null || typeof x !== 'object')) {
      const one = JSON.stringify(v);
      if (one.length <= 120) return one;
    }
    const n = ind + ' ';
    return '[\n' + v.map(x => n + fmt(x, n)).join(',\n') + '\n' + ind + ']';
  }
  if (v && typeof v === 'object') {
    const ks = Object.keys(v);
    if (!ks.length) return '{}';
    const n = ind + ' ';
    return '{\n' + ks.map(k => n + JSON.stringify(k) + ': ' + fmt(v[k], n)).join(',\n') + '\n' + ind + '}';
  }
  return JSON.stringify(v);
}

// pack → text. Throws if the text would not parse back to the same pack.
function pack(J) {
  const prose = {};
  for (const [k, v] of Object.entries(J.prose || {})) prose[k] = joinProse(v).split(BLOCK);
  const text = fmt({ ...J, prose }) + '\n';
  const back = JSON.parse(text);
  for (const k of Object.keys(prose)) back.prose[k] = joinProse(back.prose[k]);
  const same = JSON.stringify({ ...J, prose: Object.fromEntries(Object.entries(J.prose || {}).map(([k, v]) => [k, joinProse(v)])) });
  if (JSON.stringify(back) !== same) throw new Error('format.js: pack does not round-trip');
  return text;
}

// text → pack with every prose field as one string, the shape the code works on
function unpack(text) {
  const J = JSON.parse(text);
  for (const k of Object.keys(J.prose || {})) J.prose[k] = joinProse(J.prose[k]);
  return J;
}

module.exports = { pack, unpack, joinProse };
