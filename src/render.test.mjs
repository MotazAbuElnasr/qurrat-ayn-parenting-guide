/* node src/render.test.mjs
   The one thing that silently breaks the rendered pages is a slug collision:
   two items that reduce to the same path leave one of them unreachable, and
   nothing else in the build would notice. Everything below is downstream.

   Every case walks PAGES rather than a list of its own, so a fifth content type
   is covered the day it is added instead of the day someone remembers. */
import { readFileSync } from 'node:fs';
import assert from 'node:assert';
import { slug, bundle, itemHTML, itemMD, sitemap, llmsTxt, PAGES, PREFIX } from './render.js';

const ORIGIN = 'https://qurrat-ain.aro.day';
const env = {
  ASSETS: {
    fetch: req => Promise.resolve(
      new Response(readFileSync('docs' + new URL(req.url).pathname, 'utf8'), { status: 200 })),
  },
};

const pack = await bundle(env, ORIGIN, 'eg');
assert(pack, 'bundle loaded');
const { data, index } = pack;
const TYPES = Object.entries(PAGES);
const titleOf = (p, it) => it[p.key];

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

ok('every item slugifies to something non-empty and unique within its type', () => {
  for (const [kind, p] of TYPES) {
    const seen = new Map();
    for (const it of p.list(data)) {
      const s = slug(titleOf(p, it));
      assert(s.length > 0, kind + ': empty slug for ' + titleOf(p, it));
      assert(!seen.has(s), kind + ' slug collision: ' + titleOf(p, it) + ' vs ' + seen.get(s));
      seen.set(s, titleOf(p, it));
    }
    assert.equal(seen.size, p.list(data).length);
  }
});

ok('slugs are stable — slugifying one twice does not move it', () => {
  for (const [, p] of TYPES) {
    for (const it of p.list(data)) {
      const s = slug(titleOf(p, it));
      assert.equal(slug(s), s, titleOf(p, it));
    }
  }
});

ok('every item is reachable through the index the router uses', () => {
  for (const [kind, p] of TYPES) {
    for (const it of p.list(data)) {
      assert(index[kind].has(slug(titleOf(p, it))), kind + ': ' + titleOf(p, it));
    }
  }
});

ok('every path prefix maps back to a known type', () => {
  for (const [prefix, kind] of Object.entries(PREFIX)) {
    assert(PAGES[kind], prefix + ' → ' + kind);
    assert.equal(PAGES[kind].dir, '/' + prefix + '/');
  }
  assert.equal(Object.keys(PREFIX).length, TYPES.length);
});

ok('every value a situation points at has a page to land on', () => {
  for (const x of data.SITS) {
    for (const name of (x.vals || [])) {
      assert(index.val.has(slug(name)), x.t + ' → ' + name + ' has no value page');
    }
  }
});

ok('every item renders HTML with its own title, canonical and h1', () => {
  for (const [kind, p] of TYPES) {
    for (const it of p.list(data)) {
      const html = itemHTML(kind, it, ORIGIN);
      assert(html.includes('<link rel="canonical" href="' + ORIGIN + p.dir +
        encodeURIComponent(slug(titleOf(p, it))) + '">'), 'canonical: ' + titleOf(p, it));
      assert(html.includes('<h1>' + titleOf(p, it).replace(/&/g, '&amp;') + '</h1>'),
        'h1: ' + titleOf(p, it));
      assert(/<meta name="description" content="[^"]{20,}">/.test(html),
        'description too short: ' + titleOf(p, it));
      assert(!html.includes('href=""'), 'empty anchor: ' + titleOf(p, it));
      assert(!html.includes('undefined'), 'undefined leaked: ' + titleOf(p, it));
    }
  }
});

ok('JSON-LD parses and never breaks out of its script tag', () => {
  for (const [kind, p] of TYPES) {
    for (const it of p.list(data)) {
      const blocks = [...itemHTML(kind, it, ORIGIN)
        .matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
      assert.equal(blocks.length, 2, 'two ld+json blocks: ' + titleOf(p, it));
      for (const b of blocks) {
        assert(!b[1].includes('<'), 'raw < inside ld+json: ' + titleOf(p, it));
        JSON.parse(b[1].replace(/\\u003c/g, '<'));
      }
    }
  }
});

ok('markdown carries the content, not just the heading', () => {
  for (const [kind, p] of TYPES) {
    for (const it of p.list(data)) {
      const md = itemMD(kind, it, ORIGIN);
      const t = titleOf(p, it);
      assert(md.startsWith('# ' + t), 'md heading: ' + t);
      assert(md.length > 250, 'thin markdown (' + md.length + '): ' + t);
      assert(!md.includes('<b>'), 'unstripped markup: ' + t);
      assert(!md.includes('undefined'), 'undefined leaked: ' + t);
      // a .md is read on its own, so a relative link in it resolves against nothing
      for (const [, href] of md.matchAll(/\]\((.*?)\)/g)) {
        assert(/^https?:\/\//.test(href), 'relative link in md: ' + href + ' — ' + t);
        if (href.startsWith(ORIGIN)) assert(href.endsWith('.md'), 'internal link not .md: ' + href);
      }
    }
  }
});

ok('sitemap lists the home page and every item exactly once, and nothing else', () => {
  const locs = [...sitemap(data, ORIGIN).matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
  assert.equal(new Set(locs).size, locs.length, 'duplicate <loc>');
  let expected = 1;
  for (const [, p] of TYPES) {
    assert.equal(locs.filter(u => u.startsWith(ORIGIN + p.dir)).length, p.list(data).length, p.dir);
    expected += p.list(data).length;
  }
  assert(locs.includes(ORIGIN + '/'), 'home in sitemap');
  // the tab paths self-canonical to / — listing them would ask for an index of
  // a page that disclaims itself
  assert.equal(locs.length, expected, 'unexpected extra URLs in sitemap');
});

ok('llms.txt links every item and points at the .md twin', () => {
  const txt = llmsTxt(data, ORIGIN);
  for (const [, p] of TYPES) {
    const rx = new RegExp('\\(' + ORIGIN + p.dir + '[^)]+\\.md\\)', 'g');
    assert.equal((txt.match(rx) || []).length, p.list(data).length, p.dir);
    assert(txt.includes('## ' + p.crumb + ' ('), 'section heading: ' + p.crumb);
  }
});

const total = TYPES.reduce((a, [, p]) => a + p.list(data).length, 0);
console.log('\n✓ ' + n + ' render cases pass — ' + total + ' pages: ' +
  TYPES.map(([, p]) => p.list(data).length + ' ' + p.crumb).join(' · '));
