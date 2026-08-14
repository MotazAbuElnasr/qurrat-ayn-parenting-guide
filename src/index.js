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

const KINDS = ['موقف', 'قصة', 'قيمة'];
const LIMITS = { name: 40, title: 120, body: 4000, teaches: 300 };
const POSTS_PER_DAY = 10;
const DAY = 86400000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const bad = (msg, status = 400) => json({ error: msg }, status);

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const vid = req => str(req.headers.get('x-visitor-id') || '', 64).replace(/[^a-zA-Z0-9_-]/g, '');

async function readBody(req) {
  try { return await req.json(); } catch { return null; }
}

/** GET /api/feed — posts newest-first with like counts, plus the caller's own likes. */
async function feed(env, me) {
  const { results: posts } = await env.DB.prepare(
    `SELECT p.id, p.author_name, p.kind, p.title, p.body, p.teaches, p.age_min, p.age_max, p.created_at,
            (SELECT COUNT(*) FROM likes l WHERE l.target_type='post' AND l.target_id = CAST(p.id AS TEXT)) AS likes
       FROM posts p WHERE p.status='live' ORDER BY p.created_at DESC LIMIT 200`
  ).all();

  let mine = [];
  if (me) {
    const { results } = await env.DB.prepare(
      `SELECT target_type, target_id FROM likes WHERE visitor_id = ?`
    ).bind(me).all();
    mine = results.map(r => `${r.target_type}:${r.target_id}`);
  }
  const { results: sitLikes } = await env.DB.prepare(
    `SELECT target_id, COUNT(*) AS n FROM likes WHERE target_type='sit' GROUP BY target_id`
  ).all();

  return json({
    posts,
    sitLikes: Object.fromEntries(sitLikes.map(r => [r.target_id, r.n])),
    myLikes: mine,
  });
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
async function createPost(env, me, body) {
  const kind = str(body?.kind, 20);
  if (!KINDS.includes(kind)) return bad('اختار نوع المشاركة');

  const title = str(body?.title, LIMITS.title);
  const text = str(body?.body, LIMITS.body);
  const teaches = str(body?.teaches, LIMITS.teaches);
  const ageMin = Number(body?.age_min), ageMax = Number(body?.age_max);
  const name = str(body?.name, LIMITS.name);

  if (title.length < 4) return bad('العنوان قصير أوي');
  if (text.length < 30) return bad('المشاركة قصيرة — احكي التفاصيل اللي هتفيد حد تاني');
  if (teaches.length < 4) return bad('اكتب بتعلّم إيه');
  if (!Number.isInteger(ageMin) || !Number.isInteger(ageMax) || ageMin < 1 || ageMax > 18 || ageMin > ageMax)
    return bad('حدد الفئة العمرية صح');
  if (name.length < 2) return bad('اكتب اسمك الأول');

  const since = Date.now() - DAY;
  const { count } = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM posts WHERE visitor_id = ? AND created_at > ?`
  ).bind(me, since).first();
  if (count >= POSTS_PER_DAY) return bad('وصلت للحد اليومي للمشاركات — بكرة تقدر تكمل', 429);

  const verdict = moderate({ title, body: text, teaches, name });
  if (verdict.action === 'reject') return bad(verdict.message, 422);

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (visitor_id, name, created_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(visitor_id) DO UPDATE SET name = ?2`
  ).bind(me, name, now).run();

  const status = verdict.action === 'review' ? 'pending' : 'live';
  const res = await env.DB.prepare(
    `INSERT INTO posts (visitor_id, author_name, kind, title, body, teaches, age_min, age_max, status, flags, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(me, name, kind, title, text, teaches, ageMin, ageMax, status, verdict.reasons.join(','), now).run();

  return json({ ok: true, id: res.meta.last_row_id, status, message: verdict.message });
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
const isAdmin = (env, req) => !!env.ADMIN_KEY && req.headers.get('x-admin-key') === env.ADMIN_KEY;

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
    `SELECT id, author_name, kind, title, body, teaches, age_min, age_max, status, flags, created_at
       FROM posts WHERE status='pending' ORDER BY created_at ASC LIMIT 100`
  ).all();
  return json({ pending: results });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!env.DB) return bad('قاعدة البيانات مش متوصلة', 503);

    const me = vid(request);
    const route = url.pathname.slice(5);

    try {
      if (request.method === 'GET' && route === 'feed') return await feed(env, me);
      if (request.method === 'GET' && route === 'queue') return await queue(env, request);
      if (request.method === 'POST') {
        if (!me) return bad('visitor id ناقص');
        const body = await readBody(request);
        if (!body) return bad('محتوى غير صالح');
        if (route === 'name') return await setName(env, me, body);
        if (route === 'post') return await createPost(env, me, body);
        if (route === 'like') return await toggleLike(env, me, body);
        if (route === 'moderate') return await moderatePost(env, request, body);
      }
      return bad('مش موجود', 404);
    } catch (err) {
      return bad('حصل خطأ في السيرفر: ' + err.message, 500);
    }
  },
};
