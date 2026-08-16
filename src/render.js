/* Every value and every موقف gets its own URL here.
   The app itself is one page by design — the bundle loads once and the reader
   moves between tabs without another request. That is right for a reader and
   invisible to a crawler: a #go= fragment is not a URL Google will ever hold.
   So the same JSON is read a second way, server side, and served as documents.

   One extractor per type builds a block list; two walkers turn it into HTML for
   readers and markdown for agents. Adding a field to the page adds it to the
   agent feed with no second edit — the drift between the two is the whole bug
   this shape exists to prevent. */

const SITE = 'قُرّة عين';

/* Absolute URLs are pinned rather than taken from the request. A canonical that
   echoes whatever host answered is how a preview deployment ends up telling
   Google it is the original — and in `wrangler dev` the worker sees the routed
   hostname over plain http, so the arriving origin is not even right locally. */
export const CANONICAL_ORIGIN = 'https://qurrat-ain.aro.day';

const FONTS = 'https://fonts.googleapis.com/css2?family=Aref+Ruqaa:wght@400;700' +
  '&family=IBM+Plex+Sans+Arabic:wght@300;400;600;700&display=swap';
/* spelled with escapes on purpose: an Arabic character class is unreadable as
   literals and one stray mark inside it silently changes every slug on the site */
const DIACRITICS = /[ً-ْـٰ]/g;
const PUNCT = /[«»“”‘’‚„,،؛.؟?!:()\[\]{}—–…\/\\|"'*#]/g;
const EVI = { strong: 'قوية', moderate: 'متوسطة', practice: 'ممارسة شائعة' };

/* \b does not work against Arabic letters, and neither does any of the ASCII
   slug advice — the letters stay, only the marks that would percent-encode into
   noise come out. The result is readable in the address bar and carries the
   keyword, which is most of why an Arabic slug is worth the encoding. */
export const slug = s => String(s).trim()
  .replace(DIACRITICS, '')
  .replace(PUNCT, '')
  .replace(/\s+/g, '-')
  .replace(/-{2,}/g, '-')
  .replace(/^-|-$/g, '');

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* a few authored fields carry <b>; everything else in them is still escaped */
const rich = s => esc(s).replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
const plain = s => String(s).replace(/<[^>]+>/g, '');

const trunc = (s, n = 155) => {
  const t = plain(s).replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return t.slice(0, t.lastIndexOf(' ', n) > 40 ? t.lastIndexOf(' ', n) : n).trim() + '…';
};

/* JSON-LD sits inside <script>, so a < in the data would close it early */
const ld = o => JSON.stringify(o).replace(/</g, '\\u003c');

/* ── the bundle, parsed once per isolate ──────────────────────────────────
   2.2MB of JSON is too much to parse per request and cheap to keep: the isolate
   stays warm across requests, so this is parsed on a cold start and then read.
   ponytail: one dialect held at a time — AVAILABLE is ["eg"] today; if several
   ever ship at once this wants an LRU rather than an evict-all. */
let CACHED = null;

export async function bundle(env, origin, dialect) {
  if (CACHED && CACHED.dialect === dialect) return CACHED;
  const res = await env.ASSETS.fetch(new Request(new URL('/content/' + dialect + '.json', origin)));
  if (!res.ok) return null;
  const data = (await res.json()).data;
  // ACT ships as tuples to keep the bundle small. Naming the columns once here
  // means nothing downstream has to remember that dur is index 3.
  data.ACTS = data.ACT.map(([c, t, d, dur, prep, how, age]) => ({ c, t, d, dur, prep, how, age }));
  const index = { val: new Map(), sit: new Map(), meal: new Map(), act: new Map() };
  for (const v of data.VALUES) index.val.set(slug(v.name), v);
  for (const x of data.SITS) index.sit.set(slug(x.t), x);
  for (const m of data.MEALS) index.meal.set(slug(m.t), m);
  for (const a of data.ACTS) index.act.set(slug(a.t), a);
  CACHED = { dialect, data, index };
  return CACHED;
}

/* ── extractors ───────────────────────────────────────────────────────────
   blocks: ['h',t] ['p',t] ['say',t] ['facts',[[k,v]]] ['steps',[{t,d,say}]]
           ['pairs',[[label,body]]] ['links',[[title,url,kind]]] */

const eviLabel = e => (e && EVI[e.c]) || null;

function valueBlocks(v) {
  const b = [];
  b.push(['facts', [
    ['الفئة', v.cat],
    ['المستوى', String(v.lvl)],
    ['السن', v.age[0] + '–' + v.age[1] + ' سنة'],
    ['قوة الأدلة', eviLabel(v.evi)],
  ].filter(p => p[1])]);

  b.push(['h', 'الطريقة']);
  b.push(['p', v.how]);

  if (v.say) b.push(['say', v.say]);

  if (v.steps && v.steps.length) {
    b.push(['h', 'الخطوات — على مهلك، مفيش مواعيد']);
    b.push(['steps', v.steps]);
  }

  if (v.mastery) {
    b.push(['h', 'علامة الإتقان']);
    b.push(['p', v.mastery]);
    b.push(['p', 'شفتها بتتكرر من غير تدخل منك؟ القيمة ثبتت، انتقل للي بعدها.']);
  }

  if (v.mistakes && v.mistakes.length) {
    b.push(['h', 'أخطاء شائعة']);
    b.push(['pairs', v.mistakes.flatMap(m => [['الغلطة', m.m], ['بدالها', m.fix]])]);
  }

  if (v.adapt && v.adapt.length) {
    b.push(['h', 'تكييف على طبع طفلك']);
    b.push(['pairs', v.adapt.map(a => [a.kid, a.how])]);
  }

  if (v.acts && v.acts.length) {
    b.push(['h', 'أنشطة']);
    for (const a of v.acts) {
      b.push(['h3', a.t]);
      b.push(['pairs', [['الخامات', a.mat], ['التحضير', a.prep], ['التنفيذ', a.run]].filter(p => p[1])]);
    }
  }

  if (v.skill) {
    b.push(['h', 'مهارة عملية جنب القيمة']);
    b.push(['p', v.skill]);
  }

  if (v.deen && v.deen.length) {
    b.push(['h', 'المحور الإسلامي' + (v.deen[0] ? ' — ' + v.deen[0] : '')]);
    for (const d of v.deen.slice(1)) b.push(['p', d]);
  }

  if (v.sunnah && v.sunnah.hadith) {
    const s = v.sunnah;
    b.push(['h3', 'من السنة']);
    b.push(['say', s.hadith]);
    b.push(['pairs', [
      ['المصدر', [s.src, s.grade].filter(Boolean).join(' — ')],
      ['الشرح', [s.sharh, s.sharhSrc].filter(Boolean).join(' — ')],
      ['في البيت', s.lesson],
    ].filter(p => p[1])]);
  }

  if (v.evi) {
    b.push(['h', 'قوة الأدلة وراء الطريقة دي']);
    if (v.evi.why) b.push(['p', v.evi.why]);
    if (v.evi.cav) b.push(['pairs', [['حدود الكلام ده', v.evi.cav]]]);
    if (v.evi.schools && v.evi.schools.length) {
      b.push(['pairs', [['المدارس', v.evi.schools.join(' · ')]]]);
    }
    if (v.evi.src && v.evi.src.length) {
      b.push(['links', v.evi.src.map(s => [s.t, s.u, s.k])]);
    }
  }

  if (v.src && v.src.length) {
    b.push(['h', 'قصص ومصادر']);
    b.push(['links', v.src.map(s => [s[1], s[2], s[0]])]);
  }
  return b;
}

function sitBlocks(x) {
  const b = [];
  b.push(['facts', [
    ['المجموعة', x.group],
    ['قوة الأدلة', eviLabel(x.evi)],
  ].filter(p => p[1])]);

  b.push(['h', 'ليه بيحصل']);
  b.push(['p', x.why]);

  if (x.now && x.now.length) {
    b.push(['h', 'في اللحظة']);
    b.push(['steps', x.now.map(n => ({ t: '', d: n.d, say: n.say }))]);
  }
  if (x.fallback) { b.push(['h', 'لو مانفعتش']); b.push(['p', x.fallback]); }
  if (x.after) { b.push(['h', 'بعد الهدوء']); b.push(['p', x.after]); }
  if (x.mistake) { b.push(['h', 'الخطأ الشائع']); b.push(['p', x.mistake]); }
  if (x.prevent) { b.push(['h', 'الوقاية']); b.push(['p', x.prevent]); }
  if (x.schools) { b.push(['h', 'رأي المدارس']); b.push(['p', x.schools]); }

  if (x.evi) {
    b.push(['h', 'الكلام ده مبني على إيه']);
    if (x.evi.why) b.push(['p', x.evi.why]);
    if (x.evi.cav) b.push(['pairs', [['حدود الكلام ده', x.evi.cav]]]);
    if (x.evi.src && x.evi.src.length) {
      b.push(['links', x.evi.src.map(s => [s.t, s.u, s.k])]);
    }
  }
  if (x.vals && x.vals.length) {
    b.push(['h', 'القيم المرتبطة']);
    // absolute on purpose: a .md file gets fetched on its own and a relative
    // link in it resolves against nothing
    b.push(['links', x.vals.map(
      n => [n, CANONICAL_ORIGIN + '/v/' + encodeURIComponent(slug(n)), 'قيمة'])]);
  }
  return b;
}

function mealBlocks(m) {
  const b = [];
  b.push(['facts', [
    ['النوع', m.k],
    ['التحضير', m.p],
    ['السن', m.age[0] + '–' + m.age[1] + ' سنة'],
    ...(m.nu ? [['', 'ينفع للحضانة']] : []),
  ].filter(p => p[1])]);

  b.push(['h', 'المقادير']);
  b.push(['list', m.i]);

  b.push(['h', 'بيدي إيه']);
  b.push(['p', m.w]);

  if (m.kj) { b.push(['h', 'حتة طفلك']); b.push(['p', m.kj]); }
  if (m.sf) { b.push(['h', 'انتبه']); b.push(['p', m.sf]); }
  if (m.tg && m.tg.length) b.push(['facts', m.tg.map(t => ['', t])]);
  return b;
}

function actBlocks(a) {
  const b = [];
  b.push(['facts', [
    ['الفئة', a.c],
    ['المدة', a.dur],
    ['التحضير', a.prep],
    ['السن', a.age[0] + '–' + a.age[1] + ' سنة'],
  ].filter(p => p[1])]);

  // ACT[2] is the materials line, not a summary — the card prints it right under
  // the title, which reads fine there and would read as a description here
  b.push(['h', 'الخامات']);
  b.push(['p', a.d]);
  if (a.how) { b.push(['h', 'إزاي تعملوه']); b.push(['p', a.how]); }
  return b;
}

/* ── walkers ──────────────────────────────────────────────────────────── */

function toHTML(blocks) {
  const out = [];
  for (const [kind, body] of blocks) {
    if (kind === 'h') out.push('<h2>' + esc(body) + '</h2>');
    else if (kind === 'h3') out.push('<h3>' + esc(body) + '</h3>');
    else if (kind === 'p') out.push('<p>' + rich(body) + '</p>');
    else if (kind === 'say') out.push('<blockquote>' + rich(body) + '</blockquote>');
    else if (kind === 'facts') {
      // a fact with no label is a standalone tag ("ينفع للحضانة", "رخيص")
      out.push('<ul class="facts">' + body.map(
        ([k, v]) => '<li>' + (k ? '<b>' + esc(k) + ':</b> ' : '') + esc(v) + '</li>').join('') + '</ul>');
    } else if (kind === 'list') {
      out.push('<ul class="items">' + body.map(x => '<li>' + rich(x) + '</li>').join('') + '</ul>');
    } else if (kind === 'steps') {
      out.push('<ol class="steps">' + body.map(s =>
        '<li>' + (s.t ? '<h3>' + esc(s.t) + '</h3>' : '') + '<p>' + rich(s.d) + '</p>' +
        (s.say ? '<blockquote>' + rich(s.say) + '</blockquote>' : '') + '</li>').join('') + '</ol>');
    } else if (kind === 'pairs') {
      out.push('<dl>' + body.map(
        ([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + rich(v) + '</dd>').join('') + '</dl>');
    } else if (kind === 'links') {
      out.push('<ul class="src">' + body.map(([t, u, k]) => {
        const tag = k ? ' <i>' + esc(k) + '</i>' : '';
        // a source with no link is a book, and the site would rather print it as
        // text than invent a URL for it — an empty href is the invented one
        if (!u) return '<li>' + esc(t) + tag + '</li>';
        // links back into the site are the cluster and must stay followable;
        // only what leaves the site opens in a new tab
        const away = !u.startsWith(CANONICAL_ORIGIN) && !u.startsWith('/');
        return '<li><a href="' + esc(u) + '"' + (away ? ' target="_blank" rel="noopener"' : '') +
          '>' + esc(t) + '</a>' + tag + '</li>';
      }).join('') + '</ul>');
    }
  }
  return out.join('\n');
}

function toMD(blocks) {
  const out = [];
  for (const [kind, body] of blocks) {
    if (kind === 'h') out.push('## ' + plain(body));
    else if (kind === 'h3') out.push('### ' + plain(body));
    else if (kind === 'p') out.push(plain(body));
    else if (kind === 'say') out.push('> ' + plain(body).replace(/\n/g, '\n> '));
    else if (kind === 'facts') {
      out.push(body.map(([k, v]) => (k ? '**' + k + ':** ' : '') + plain(v)).join(' · '));
    } else if (kind === 'list') out.push(body.map(x => '- ' + plain(x)).join('\n'));
    else if (kind === 'steps') {
      out.push(body.map((s, i) =>
        (i + 1) + '. ' + (s.t ? '**' + plain(s.t) + '** — ' : '') + plain(s.d) +
        (s.say ? '\n   > ' + plain(s.say) : '')).join('\n'));
    } else if (kind === 'pairs') {
      out.push(body.map(([k, v]) => '**' + plain(k) + ':** ' + plain(v)).join('\n\n'));
    } else if (kind === 'links') {
      // an agent reading markdown wants to land on markdown; a linkless source
      // stays a bare line rather than becoming a link to nowhere
      out.push(body.map(([t, u, k]) => {
        const label = u ? '[' + plain(t) + '](' +
          (u.startsWith(CANONICAL_ORIGIN) ? u + '.md' : u) + ')' : plain(t);
        return '- ' + label + (k ? ' — ' + k : '');
      }).join('\n'));
    }
  }
  return out.join('\n\n');
}

/* ── pages ────────────────────────────────────────────────────────────── */

export const PAGES = {
  val: {
    dir: '/v/', key: 'name', tab: 'val', crumb: 'مسار القيم', crumbPath: '/values',
    list: d => d.VALUES, blocks: valueBlocks,
    title: v => v.name + ' — إزاي تربّيها في طفلك خطوة بخطوة',
    desc: v => trunc(v.how),
  },
  sit: {
    dir: '/s/', key: 't', tab: 'sit', crumb: 'دليل المواقف', crumbPath: '/sits',
    list: d => d.SITS, blocks: sitBlocks,
    title: x => x.t + ' — تعمل إيه في اللحظة',
    desc: x => trunc(x.why),
  },
  meal: {
    dir: '/m/', key: 't', tab: 'meal', crumb: 'بنك الوجبات', crumbPath: '/food',
    list: d => d.MEALS, blocks: mealBlocks,
    title: m => m.t + ' — ' + m.k + ' لطفلك، بالمقادير والتحضير',
    desc: m => trunc(m.w),
  },
  act: {
    dir: '/a/', key: 't', tab: 'act', crumb: 'بنك الأنشطة', crumbPath: '/acts',
    list: d => d.ACTS, blocks: actBlocks,
    title: a => a.t + ' — نشاط ' + a.c + ' لطفلك في ' + a.dur,
    // the materials line alone is a few words on some activities, which is not a
    // description — the method carries the rest
    desc: a => trunc('نشاط ' + a.c + ' لطفلك في ' + a.dur + '. الخامات: ' + a.d + ' ' + (a.how || '')),
  },
};

/* 'v' → 'val'. The router builds its path matcher from this rather than keeping
   a second list that has to be remembered when a fifth type shows up. */
export const PREFIX = Object.fromEntries(
  Object.entries(PAGES).map(([kind, p]) => [p.dir.slice(1, -1), kind]));

export function itemMD(kind, item, origin) {
  const p = PAGES[kind];
  const url = origin + p.dir + encodeURIComponent(slug(item[p.key]));
  // no summary line: desc() is a truncation of the first section, and repeating
  // it here would be the same paragraph twice in a row. llms.txt carries the
  // one-line version, which is where a skim actually happens.
  return '# ' + item[p.key] + '\n\n' +
    toMD(p.blocks(item)) + '\n\n---\n\n' +
    'المصدر: ' + SITE + ' — ' + url + '\n';
}

export function itemHTML(kind, item, origin) {
  const p = PAGES[kind];
  const s = slug(item[p.key]);
  const url = origin + p.dir + encodeURIComponent(s);
  const name = item[p.key];
  const title = p.title(item);
  const desc = p.desc(item);
  const cites = (item.evi && item.evi.src || []).filter(x => x && x.u)
    .map(x => ({ '@type': 'CreativeWork', name: x.t, url: x.u }));

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | ${SITE}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<link rel="alternate" type="text/markdown" href="${esc(url)}.md" title="نسخة نصية للوكلاء">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${SITE}">
<meta property="og:locale" content="ar_EG">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(origin)}/og.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(origin)}/og.jpg">
<script type="application/ld+json">${ld({
    '@context': 'https://schema.org', '@type': 'Article',
    headline: title, description: desc, inLanguage: 'ar',
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    isPartOf: { '@type': 'WebSite', name: SITE, url: origin + '/' },
    about: { '@type': 'Thing', name },
    audience: { '@type': 'ParentAudience', name: 'أهالي أطفال الطفولة المبكرة' },
    ...(cites.length ? { citation: cites } : {}),
  })}</script>
<script type="application/ld+json">${ld({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: SITE, item: origin + '/' },
      { '@type': 'ListItem', position: 2, name: p.crumb, item: origin + p.crumbPath },
      { '@type': 'ListItem', position: 3, name },
    ],
  })}</script>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#1D6A6A">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<!-- media=print parks the request off the critical path, onload promotes it. The
     URL already says display=swap, so fallback-then-swap is what happened anyway. -->
<link rel="stylesheet" href="${FONTS}" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="${FONTS}"></noscript>
<style>
:root{--ink:#14201C;--soft:#54615B;--paper:#E9EDE7;--card:#fff;--line:#D4DACF;--a:#1D6A6A}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-size:16px;line-height:1.72;
 font-family:"IBM Plex Sans Arabic",system-ui,"Segoe UI",Tahoma,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:0 16px 70px}
a{color:var(--a)}
header{border-bottom:1px solid var(--line);background:rgba(233,237,231,.96)}
header .wrap{padding-top:12px;padding-bottom:12px}
nav{font-size:13px;color:var(--soft)}
h1{font-family:"Aref Ruqaa",serif;font-size:clamp(26px,6vw,40px);line-height:1.3;margin:26px 0 12px}
h2{font-family:"Aref Ruqaa",serif;font-size:22px;margin:32px 0 6px;padding-top:12px;border-top:2px solid var(--a)}
h3{font-size:16.5px;margin:18px 0 4px}
p{margin:0 0 12px}
blockquote{margin:0 0 14px;padding:9px 13px;border-inline-start:3px solid var(--a);
 background:var(--card);border-radius:0 9px 9px 0;font-weight:600}
ul.facts{list-style:none;display:flex;flex-wrap:wrap;gap:6px 14px;margin:0 0 6px;padding:0;
 font-size:13.5px;color:var(--soft)}
ol.steps{padding-inline-start:20px}
ol.steps li{margin-bottom:14px}
dl{margin:0 0 12px}dt{font-weight:700;font-size:14.5px;margin-top:10px}dd{margin:0;font-size:14.5px}
ul.src{padding-inline-start:20px;font-size:14px}
ul.src i{font-style:normal;color:var(--soft);font-size:12.5px}
.open{display:inline-block;margin:22px 0 0;background:var(--ink);color:#fff;text-decoration:none;
 padding:10px 18px;border-radius:10px;font-weight:600}
footer{margin-top:34px;padding-top:14px;border-top:1px solid var(--line);font-size:13px;color:var(--soft)}
</style>
</head>
<body>
<header><div class="wrap">
<nav><a href="/">${SITE}</a> ← <a href="${esc(p.crumbPath)}">${esc(p.crumb)}</a></nav>
</div></header>
<div class="wrap">
<main>
<h1>${esc(name)}</h1>
${toHTML(p.blocks(item))}
<a class="open" href="/#go=${p.tab}:${encodeURIComponent(name)}">افتح دي جوه الموقع</a>
</main>
<footer>
<p>كل نصيحة هنا مكتوب جنبها مصدرها وقوة أدلتها. <a href="${esc(url)}.md">نسخة نصية</a>.</p>
</footer>
</div>
</body>
</html>`;
}

/* ── crawler surfaces ─────────────────────────────────────────────────── */

const loc = (origin, path, pri) =>
  '  <url><loc>' + origin + path + '</loc><changefreq>monthly</changefreq><priority>' + pri + '</priority></url>';

export function sitemap(data, origin) {
  // the tab paths are left out on purpose: they all serve the same shell with a
  // canonical pointing at /, so listing them would ask for an index of a page
  // that disclaims itself. They belong here the day they get their own head.
  const rows = [
    '  <url><loc>' + origin + '/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>',
    ...Object.values(PAGES).flatMap(p => p.list(data).map(
      it => loc(origin, p.dir + encodeURIComponent(slug(it[p.key])), '0.9'))),
  ];
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + rows.join('\n') + '\n</urlset>\n';
}

/* What an agent reads before it reads anything else. The evidence policy is the
   part worth stating plainly: it is the reason a line from here is quotable. */
export function llmsTxt(data, origin) {
  const section = p => {
    const items = p.list(data);
    return '## ' + p.crumb + ' (' + items.length + ')\n\n' + items.map(
      it => '- [' + it[p.key] + '](' + origin + p.dir +
        encodeURIComponent(slug(it[p.key])) + '.md): ' + trunc(p.desc(it), 120)).join('\n');
  };
  return `# ${SITE}

> مرجع تربوي عربي للطفولة المبكرة بالعامية المصرية: ${data.VALUES.length} قيمة بخطوات عملية، ${data.SITS.length} موقف يومي بجُملها الحرفية، ${data.MEALS.length} وجبة بمقاديرها، و${data.ACTS.length} نشاط بخامات البيت.

كل قيمة وكل موقف عليه شارة قوة أدلة — قوية أو متوسطة أو ممارسة شائعة — ومصادره
مكتوبة بلينكاتها. اللي مالوش دراسة مكتوب عليه «ممارسة شائعة» بالنص، والتقنية
اللي أصلها غربي متنوّه عليها. لو نقلت حاجة من هنا، انقل شارة الأدلة معاها:
النصيحة من غير قوة دليلها نص ناقص.

كل صفحة ليها نسخة نصية بإضافة \`.md\` على اللينك.

${Object.values(PAGES).map(section).join('\n\n')}

## كمان

- [الموقع](${origin}/): بنك القصص والفيديوهات المرشحة وجدول اليوم والمرجع التربوي.
`;
}
