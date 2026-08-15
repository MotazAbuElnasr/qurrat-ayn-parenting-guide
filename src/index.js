/**
 * قُرّة عين — community API on Cloudflare Workers + D1.
 * Static assets fall through to ./docs; only /api/* is handled here.
 *
 * Identity note: visitor_id is a client-generated id kept in localStorage.
 * It is a lightweight "same browser = same person" handle, NOT authentication —
 * anyone can forge one. It is good enough for names and like-dedupe, and is
 * deliberately not used to protect anything that matters.
 */

import { moderate } from './moderation.js';

const KINDS = ['موقف', 'قصة', 'قيمة', 'وجبة'];
const LIMITS = { name: 40, title: 120, body: 4000, tag: 30, feedback: 1200, quote: 400 };
const MAX_TAGS = 5;

// A reader can leave more notes than posts in a day: a note costs them a
// sentence and costs us a row, and the whole point is to hear the ones who
// would never write a post.
const FEEDBACK_PER_DAY = 20;
const FEEDBACK_PER_IP_DAY = 60;

// What a note can hang on, and why it was written. Both lists are closed so a
// row in the queue is always something that can be grouped and acted on.
const FB_TARGETS = ['sit', 'val', 'meal', 'act', 'ref', 'home'];
const FB_KINDS = ['مش واضح', 'مش شغال معايا', 'غلط', 'ناقص', 'اقتراح'];
const PAGE = 20;

/** Tags are stored pipe-wrapped ('|a|b|') so LIKE '%|a|%' can never match half a tag. */
const packTags = list => (list && list.length) ? '|' + list.join('|') + '|' : '';
const unpackTags = t => String(t || '').split('|').filter(Boolean);

function cleanTags(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set(), out = [];
  for (const t of raw) {
    // a pipe inside a tag would break the storage format
    const v = str(t, LIMITS.tag).replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
    if (v.length < 2) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); out.push(v);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
const POSTS_PER_DAY = 10;      // per visitor id (cosmetic — the id is client-chosen)
const POSTS_PER_IP_DAY = 25;   // per source IP (the cap that actually holds)
const MAX_BODY = 64 * 1024;
const DAY = 86400000;

const json = (data, status = 200, extra) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
const bad = (msg, status = 400, extra) => json({ error: msg }, status, extra);

/**
 * Per-IP burst limit. Fails open when the binding is missing so a local run or a
 * config slip degrades to today's behaviour instead of locking everyone out.
 */
/* Which Arabic a reader is most likely to want, from where they are.
   Countries with many nationalities in one place default to formal Arabic —
   a Levantine phrase would land wrong on half the room. Countries with one
   dominant dialect get that dialect. The reader can always override. */
// what a reader could want, and what has actually been written and reviewed.
// Sending someone to a bundle that does not exist costs them a failed request.
const DIALECTS = ['msa', 'eg', 'sham', 'gulf', 'maghreb'];
const AVAILABLE = ["msa","eg","sham"]; /* build:dialects */
const BY_COUNTRY = {
  EG: 'eg',
  SY: 'sham', LB: 'sham', JO: 'sham', PS: 'sham',
  MA: 'maghreb', DZ: 'maghreb', TN: 'maghreb', LY: 'maghreb',
};

function dialectFor(request, url) {
  const country = (request.cf && request.cf.country) || null;
  const asked = url.searchParams.get('d');
  const want = (asked && DIALECTS.includes(asked)) ? asked
    : (country && BY_COUNTRY[country]) || 'msa';
  const dialect = AVAILABLE.includes(want) ? want : AVAILABLE[0];
  return {
    dialect,
    wanted: want,
    from: asked ? 'query' : (BY_COUNTRY[country] ? 'country' : 'default'),
    country,
  };
}

async function overLimit(binding, key) {
  if (!binding || typeof binding.limit !== 'function') return false;
  try {
    const { success } = await binding.limit({ key });
    return !success;
  } catch {
    return false;
  }
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const vid = req => str(req.headers.get('x-visitor-id') || '', 64).replace(/[^a-zA-Z0-9_-]/g, '');
/** Set by Cloudflare and not forgeable by the client. */
const clientIp = req => str(req.headers.get('cf-connecting-ip') || '', 64);

async function readBody(req) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) return null;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return null;
    return JSON.parse(text);
  } catch { return null; }
}

/** GET /api/feed?offset=&kind=&tag= — a page of posts plus what you can filter by. */
async function feed(env, me, url, ctx) {
  const offset = Math.max(0, Math.min(5000, Number(url.searchParams.get('offset')) || 0));
  const kind = str(url.searchParams.get('kind'), 20);
  const tag = str(url.searchParams.get('tag'), LIMITS.tag);

  // Four of the five queries are the same for everyone, so they are cached at the
  // edge and a flood of reads costs one round of queries per window, not one per
  // request. Only «which of these did I like» is per-visitor and always fresh.
  const shared = await cachedShared(env, ctx, { offset, kind, tag },
    url.searchParams.get('fresh') === '1');

  let mine = [];
  if (me) {
    const { results } = await env.DB.prepare(
      `SELECT target_type, target_id FROM likes WHERE visitor_id = ?`
    ).bind(me).all();
    mine = results.map(r => `${r.target_type}:${r.target_id}`);
  }
  return json({ ...shared, myLikes: mine });
}

const FEED_TTL = 15;

async function cachedShared(env, ctx, q, fresh) {
  const key = new Request(
    `https://feed.cache/v1?o=${q.offset}&k=${encodeURIComponent(q.kind)}&t=${encodeURIComponent(q.tag)}`
  );
  const cache = caches.default;
  if (!fresh) {
    const hit = await cache.match(key);
    if (hit) return await hit.json();
  }
  const data = await sharedFeed(env, q);
  const body = new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${FEED_TTL}` },
  });
  if (ctx) ctx.waitUntil(cache.put(key, body.clone()));
  return data;
}

async function sharedFeed(env, { offset, kind, tag }) {
  const where = ["p.status='live'"];
  const args = [];
  if (KINDS.includes(kind)) { where.push('p.kind = ?'); args.push(kind); }
  if (tag) { where.push('p.tags LIKE ?'); args.push('%|' + tag + '|%'); }
  const clause = where.join(' AND ');

  const { total } = await env.DB.prepare(`SELECT COUNT(*) AS total FROM posts p WHERE ${clause}`)
    .bind(...args).first();

  const { results: posts } = await env.DB.prepare(
    `SELECT p.id, p.author_name, p.kind, p.title, p.body, p.tags, p.age_min, p.age_max, p.created_at,
            (SELECT COUNT(*) FROM likes l WHERE l.target_type='post' AND l.target_id = CAST(p.id AS TEXT)) AS likes
       FROM posts p WHERE ${clause} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...args, PAGE, offset).all();

  // the whole tag vocabulary, so the filter bar shows every tag people have used
  const { results: tagRows } = await env.DB.prepare(
    `SELECT tags FROM posts WHERE status='live' AND tags != '' ORDER BY created_at DESC LIMIT 500`
  ).all();
  const counts = {};
  tagRows.forEach(r => unpackTags(r.tags).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));

  const { results: sitLikes } = await env.DB.prepare(
    `SELECT target_id, COUNT(*) AS n FROM likes WHERE target_type='sit' GROUP BY target_id`
  ).all();

  return {
    posts: posts.map(p => ({ ...p, tags: unpackTags(p.tags) })),
    total, offset, page: PAGE,
    tags: Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ t, n })),
    sitLikes: Object.fromEntries(sitLikes.map(r => [r.target_id, r.n])),
  };
}

/** POST /api/name — register or rename the visitor. */
async function setName(env, me, body) {
  const name = str(body?.name, LIMITS.name);
  if (name.length < 2) return bad('الاسم قصير أوي');
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (visitor_id, name, created_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(visitor_id) DO UPDATE SET name = ?2`
  ).bind(me, name, now).run();
  return json({ ok: true, name });
}

/** POST /api/post — create a community post. */
async function createPost(env, me, body, ip) {
  const kind = str(body?.kind, 20);
  if (!KINDS.includes(kind)) return bad('اختار نوع المشاركة');

  const title = str(body?.title, LIMITS.title);
  const text = str(body?.body, LIMITS.body);
  const tags = cleanTags(body?.tags);
  const ageMin = Number(body?.age_min), ageMax = Number(body?.age_max);
  const name = str(body?.name, LIMITS.name);

  if (title.length < 4) return bad('العنوان قصير أوي');
  if (text.length < 30) return bad('المشاركة قصيرة — احكي التفاصيل اللي هتفيد حد تاني');
  if (!tags.length) return bad('اختار تاج واحد على الأقل — بتعلّم إيه؟');
  if (!Number.isInteger(ageMin) || !Number.isInteger(ageMax) || ageMin < 1 || ageMax > 18 || ageMin > ageMax)
    return bad('حدد الفئة العمرية صح');
  if (name.length < 2) return bad('اكتب اسمك الأول');

  const since = Date.now() - DAY;
  const { count } = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM posts WHERE visitor_id = ? AND created_at > ?`
  ).bind(me, since).first();
  if (count >= POSTS_PER_DAY) return bad('وصلت للحد اليومي للمشاركات — بكرة تقدر تكمل', 429);

  if (ip) {
    const { n } = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM posts WHERE ip_hash = ? AND created_at > ?`
    ).bind(ip, since).first();
    if (n >= POSTS_PER_IP_DAY) return bad('وصلنا للحد اليومي من الشبكة دي — جرّب بكرة', 429);
  }

  const verdict = moderate({ title, body: text, teaches: tags.join(' '), name });
  if (verdict.action === 'reject') return bad(verdict.message, 422);

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (visitor_id, name, created_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(visitor_id) DO UPDATE SET name = ?2`
  ).bind(me, name, now).run();

  const status = verdict.action === 'review' ? 'pending' : 'live';
  const res = await env.DB.prepare(
    `INSERT INTO posts (visitor_id, author_name, kind, title, body, tags, age_min, age_max, status, flags, ip_hash, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(me, name, kind, title, text, packTags(tags), ageMin, ageMax, status, verdict.reasons.join(','), ip, now).run();

  return json({ ok: true, id: res.meta.last_row_id, status, message: verdict.message });
}

/**
 * POST /api/feedback — a reader says something about one piece of the reference.
 *
 * Deliberately lighter than a post: no name, no tags, no age. The barrier a
 * post needs is what stops a reader from saying «الخطوة دي مش شغالة معايا»,
 * and that sentence is worth more than any post on the board.
 */
async function createFeedback(env, me, body, ip) {
  const type = str(body?.target_type, 8);
  const id = str(body?.target_id, LIMITS.title);
  const kind = str(body?.kind, 20);
  const text = str(body?.body, LIMITS.feedback);
  const quote = str(body?.quote, LIMITS.quote);
  const dialect = str(body?.dialect, 8);

  if (!FB_TARGETS.includes(type)) return bad('نوع المحتوى مش معروف');
  if (!FB_KINDS.includes(kind)) return bad('اختار نوع الملاحظة');
  if (text.length < 5) return bad('اكتب الملاحظة — كلمتين يكفّوا');

  const since = Date.now() - DAY;
  const { count } = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM feedback WHERE visitor_id = ? AND created_at > ?`
  ).bind(me, since).first();
  if (count >= FEEDBACK_PER_DAY) return bad('وصلت للحد اليومي للملاحظات — بكرة تقدر تكمل', 429);

  if (ip) {
    const { n } = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM feedback WHERE ip_hash = ? AND created_at > ?`
    ).bind(ip, since).first();
    if (n >= FEEDBACK_PER_IP_DAY) return bad('وصلنا للحد اليومي من الشبكة دي — جرّب بكرة', 429);
  }

  // the same filter the board uses; a rejected note is not stored at all
  const verdict = moderate({ title: id, body: text, teaches: '', name: '' });
  if (verdict.action === 'reject') return bad(verdict.message, 422);

  await env.DB.prepare(
    `INSERT INTO feedback (visitor_id, target_type, target_id, kind, body, quote, dialect, status, flags, ip_hash, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(me, type, id, kind, text, quote, dialect,
    verdict.action === 'review' ? 'flagged' : 'new', verdict.reasons.join(','), ip, Date.now()).run();

  return json({ ok: true, message: 'وصلتنا. شكرًا — ده بيتقرا فعلًا.' });
}

/** GET /api/feedback?status=new — the queue, for whoever holds the admin key. */
async function feedbackQueue(env, req, url) {
  if (!isAdmin(env, req)) return bad('غير مصرّح', 403);
  const status = str(url.searchParams.get('status'), 10) || 'new';
  const { results } = await env.DB.prepare(
    `SELECT id, target_type, target_id, kind, body, quote, dialect, status, flags, created_at
       FROM feedback WHERE status = ? ORDER BY created_at ASC LIMIT 200`
  ).bind(status).all();
  return json({ feedback: results });
}

/** POST /api/like — toggle a like on a post or a built-in situation. */
async function toggleLike(env, me, body) {
  const type = str(body?.target_type, 8);
  const id = str(body?.target_id, 120);
  if (type !== 'post' && type !== 'sit') return bad('نوع غير معروف');
  if (!id) return bad('عنصر غير معروف');

  const existing = await env.DB.prepare(
    `SELECT 1 FROM likes WHERE target_type=? AND target_id=? AND visitor_id=?`
  ).bind(type, id, me).first();

  if (existing) {
    await env.DB.prepare(
      `DELETE FROM likes WHERE target_type=? AND target_id=? AND visitor_id=?`
    ).bind(type, id, me).run();
  } else {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO likes (target_type, target_id, visitor_id, created_at) VALUES (?,?,?,?)`
    ).bind(type, id, me, Date.now()).run();
  }

  const { n } = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM likes WHERE target_type=? AND target_id=?`
  ).bind(type, id).first();
  return json({ ok: true, liked: !existing, count: n });
}

/** Maintainer-only endpoints, gated on the ADMIN_KEY secret. */
function isAdmin(env, req) {
  const given = req.headers.get('x-admin-key') || '';
  const want = env.ADMIN_KEY || '';
  // no key configured means the endpoint stays shut, never open
  if (!want || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

/** POST /api/moderate — set a post's status: live | pending | hidden. */
async function moderatePost(env, req, body) {
  if (!isAdmin(env, req)) return bad('غير مصرّح', 403);
  const id = Number(body?.id);
  const status = str(body?.status, 10);
  if (!Number.isInteger(id)) return bad('id غير صحيح');
  if (!['live', 'pending', 'hidden'].includes(status)) return bad('حالة غير معروفة');
  await env.DB.prepare(`UPDATE posts SET status=? WHERE id=?`).bind(status, id).run();
  return json({ ok: true });
}

/** GET /api/queue — everything awaiting a human decision, with why it was flagged. */
async function queue(env, req) {
  if (!isAdmin(env, req)) return bad('غير مصرّح', 403);
  const { results } = await env.DB.prepare(
    `SELECT id, author_name, kind, title, body, tags, age_min, age_max, status, flags, created_at
       FROM posts WHERE status='pending' ORDER BY created_at ASC LIMIT 100`
  ).all();
  return json({ pending: results });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Cloudflare's asset layer answers Range requests with the whole file, so a
    // browser cannot seek past what it has buffered. Slice it here instead.
    if (url.pathname.endsWith('.mp4')) {
      const range = request.headers.get('range');
      // slicing means holding the whole file in memory, so this path gets the
      // same burst limit the API has — otherwise it is the cheapest way to tire
      // the worker out
      if (range && await overLimit(env.RL_READ, clientIp(request) + ':mp4')) {
        return new Response(null, { status: 429, headers: { 'retry-after': '60' } });
      }
      const asset = await env.ASSETS.fetch(new Request(url.toString()));
      if (!asset.ok || !range) return asset;
      const buf = await asset.arrayBuffer();
      const total = buf.byteLength;
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (!m) return asset;
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
      if (!(start >= 0 && start <= end && end < total)) {
        return new Response(null, { status: 416, headers: { 'content-range': `bytes */${total}` } });
      }
      return new Response(buf.slice(start, end + 1), {
        status: 206,
        headers: {
          'content-type': asset.headers.get('content-type') || 'video/mp4',
          'content-range': `bytes ${start}-${end}/${total}`,
          'content-length': String(end - start + 1),
          'accept-ranges': 'bytes',
          'cache-control': 'public, max-age=86400',
        },
      });
    }

    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    // Which dialect to load. The bundle itself is a static asset so it never
    // passes through here — this only answers the question, in a few hundred bytes.
    if (url.pathname === '/api/dialect') {
      const pick = dialectFor(request, url);
      return new Response(JSON.stringify({ ...pick, available: AVAILABLE }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          // varies by country, so it is the reader's to keep, not a shared cache's
          'cache-control': 'private, max-age=86400',
        },
      });
    }

    if (!env.DB) return bad('قاعدة البيانات مش متوصلة', 503);

    const me = vid(request);
    const route = url.pathname.slice(5);

    // The daily caps live in D1, so checking them already costs a query — a burst
    // would drain the database before its own limit applied. This runs first and
    // costs nothing, leaving the D1 caps to do what they are good at: the long game.
    const ip = clientIp(request);
    if (ip && await overLimit(request.method === 'POST' ? env.RL_WRITE : env.RL_READ, ip)) {
      return bad('طلبات كتير في وقت قصير — استنى شوية وجرّب تاني', 429, { 'retry-after': '60' });
    }

    try {
      if (request.method === 'GET' && route === 'feed') return await feed(env, me, url, ctx);
      if (request.method === 'GET' && route === 'queue') return await queue(env, request);
      if (request.method === 'GET' && route === 'feedback') return await feedbackQueue(env, request, url);
      if (request.method === 'POST') {
        // writes must come from this site, not from a page someone else hosts
        const origin = request.headers.get('origin');
        if (origin && new URL(origin).host !== url.host) return bad('مصدر غير مسموح', 403);
        if (!me) return bad('visitor id ناقص');
        const body = await readBody(request);
        if (!body) return bad('محتوى غير صالح');
        if (route === 'name') return await setName(env, me, body);
        if (route === 'post') return await createPost(env, me, body, clientIp(request));
        if (route === 'like') return await toggleLike(env, me, body);
        if (route === 'feedback') return await createFeedback(env, me, body, clientIp(request));
        if (route === 'moderate') return await moderatePost(env, request, body);
      }
      return bad('مش موجود', 404);
    } catch (err) {
      // the message can carry SQL and internals — log it, do not ship it
      console.error('api error', route, err && err.message);
      return bad('حصل خطأ في السيرفر، جرّب تاني', 500);
    }
  },
};
