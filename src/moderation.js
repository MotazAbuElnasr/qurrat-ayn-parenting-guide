/**
 * Content moderation for قُرّة عين community posts.
 *
 * A plain wordlist is trivial to evade (spacing, diacritics, digit-for-letter,
 * repeated letters, Latin/Arabic mixing). So every check runs against
 * AGGRESSIVELY NORMALIZED text, including a "squeezed" form with all separators
 * removed — that is what catches س.ك.س, س ك س, and س_ك_س with one entry.
 *
 * Outcomes:
 *   reject — never stored, the author gets told why
 *   review — stored as 'pending', invisible until the maintainer approves
 *   ok     — published immediately
 *
 * Deliberate nuance: descriptions of hitting/shouting are NOT rejected. A parent
 * writing «زعقت له وندمت» is exactly who this site is for. Those go to review,
 * never to auto-reject.
 */

/* ---------- normalization ---------- */

const DIACRITICS = /[ً-ْٰـ]/g;          // tashkeel + tatweel
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿­]/g;

/** Unify Arabic letter variants so ألف/همزة/تاء مربوطة spellings collapse together. */
function unifyArabic(t) {
  return t
    .replace(INVISIBLE, '')
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىی]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/گ/g, 'ك')
    .replace(/[ڤﭬ]/g, 'ف')
    .replace(/پ/g, 'ب');
}

/** Arabizi / leetspeak: digits and symbols standing in for letters. */
function foldSubstitutions(t) {
  return t
    .replace(/[٣3]/g, 'ع').replace(/[٧7]/g, 'ح').replace(/[٥5]/g, 'خ')
    .replace(/[٢2]/g, 'ء').replace(/[٩9]/g, 'ص').replace(/[٦6]/g, 'ط')
    .replace(/[٨8]/g, 'ق').replace(/[٤4]/g, 'ش')
    .replace(/[@]/g, 'a').replace(/[$]/g, 's').replace(/[!|]/g, 'i')
    .replace(/0/g, 'o').replace(/1/g, 'i');
}

/** Collapse letters repeated for evasion: كسسسس → كس, fuuuck → fuck. */
function collapseRuns(t) {
  return t.replace(/(.)\1+/g, '$1');
}

/**
 * Re-join words that were spelled out to dodge a filter: «س ك س», «س.ك.س»,
 * «f u c k». Only runs of SINGLE letters separated by 1-2 non-letters are
 * joined, so ordinary prose is left alone.
 */
function joinSpelledOut(t) {
  // The run must start AND end on a word boundary. Without the start guard it
  // eats the previous word's last letter («كلام س ك س» → «مسك»); without the end
  // guard it eats the next word's first letter («س ك س نص» → «سكسن»).
  return t.replace(/(?<!\p{L})(?:\p{L}[^\p{L}\n]{1,2}){2,}\p{L}(?!\p{L})/gu,
    m => m.replace(/[^\p{L}]/gu, ''));
}

export function normalize(text) {
  const lower = String(text || '').toLowerCase();
  const unified = foldSubstitutions(unifyArabic(lower));
  return {
    plain: unified,
    // the form every wordlist is matched against
    hunt: collapseRuns(joinSpelledOut(unified)),
  };
}

/* ---------- lists ----------
 * Kept as plain arrays on purpose: the whole point is that a maintainer with no
 * JS background can open this file and add a word. Entries are matched against
 * the normalized+squeezed text, so write the simplest base form only.
 */

/** Explicit sexual content and slurs — rejected outright. */
const REJECT = [
  // Arabic — explicit sexual. Entries under four letters match whole words only,
  // so the suffixed forms that matter are listed in full alongside them.
  'سكس', 'سكسي', 'سكسيه', 'نيك', 'نيكها', 'بينيك', 'ينيك', 'زب', 'كس',
  'شرموط', 'عاهره', 'قحبه', 'متناك', 'خول', 'لبوه',
  'طيز', 'بزاز', 'زبر', 'منيك', 'شرموطه', 'داعر', 'مومس',
  // Arabic — slurs and degradation
  'ابنمتناكه', 'يلعندينك', 'يلعنابوك', 'كسمك', 'كسختك', 'كسامك', 'يخرب',
  // English — explicit
  'porn', 'xxx', 'fuck', 'cunt', 'dick', 'pussy', 'whore', 'slut', 'bitch',
  'nigger', 'faggot', 'rape',
];

/** Milder profanity, insults, and sensitive-but-legitimate topics — held for review. */
const REVIEW = [
  // Arabic — insults and mild profanity
  'حمار', 'غبي', 'كلب', 'حقير', 'وسخ', 'قذر', 'تافه', 'خرا', 'زفت', 'لعنه',
  'ياحيوان', 'بهيمه', 'اهبل', 'معفن',
  // Arabic — harm and crisis language (a real parent may be describing something
  // serious; a human should read it rather than a regex deciding)
  'انتحار', 'اقتل', 'حزام', 'شلوت', 'صفعه', 'خنقته', 'حرقته', 'اذيته',
  'تحرش', 'اغتصاب', 'ضرب', 'بيضرب', 'هيضرب', 'يضرب',
  // English
  'shit', 'damn', 'stupid', 'idiot', 'suicide', 'kill', 'abuse', 'molest',
];

/** Off-topic commercial spam signals. */
const SPAM = [
  'واتساب', 'whatsapp', 'telegram', 'تليجرام', 'اشترك الان', 'عرض خاص',
  'تخفيض', 'للبيع', 'تواصل معي على', 'اربح', 'كازينو', 'casino', 'crypto',
  'bitcoin', 'investment', 'loan', 'قرض', 'شغل من البيت',
];

/* ---------- structural checks ---------- */

const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|me|ru|xyz|link|shop|store|info|biz)\b)/i;
const PHONE_RE = /(\+?\d[\d\s\-()]{8,})/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;

const RX_CACHE = new Map();

/**
 * Word-START matching, not substring: «دم» must not fire inside «وندمت».
 * Arabic proclitics (و ف ب ك ل ال) are allowed in front, and any suffix is
 * allowed after, so «والسكس» and «سكسي» both match a «سكس» entry.
 */
function wordRegex(word) {
  if (RX_CACHE.has(word)) return RX_CACHE.get(word);
  const key = collapseRuns(foldSubstitutions(unifyArabic(word.toLowerCase())).replace(/[^\p{L}]/gu, ''));
  if (!key) { RX_CACHE.set(word, null); return null; }
  // Short entries are prefixes of ordinary words — «زب» sits inside «زبادي» and
  // «كس» inside «كسر». Anything under four letters must match a whole word;
  // longer entries keep suffix tolerance so «سكس» still catches «سكسية».
  const tail = key.length <= 3 ? '(?!\\p{L})' : '';
  const rx = new RegExp(`(?<!\\p{L})[وفبكل]{0,2}(?:ال)?${key}${tail}`, 'u');
  RX_CACHE.set(word, rx);
  return rx;
}

function hits(list, n) {
  const found = [];
  for (const w of list) {
    const rx = wordRegex(w);
    if (rx && rx.test(n.hunt)) found.push(w);
  }
  return found;
}

/**
 * @param {{title?:string, body?:string, teaches?:string, name?:string}} fields
 * @returns {{action:'ok'|'review'|'reject', reasons:string[], message:string}}
 */
export function moderate(fields) {
  const combined = [fields.title, fields.body, fields.teaches, fields.name]
    .filter(Boolean).join('\n');
  const n = normalize(combined);
  const reasons = [];

  const rejected = hits(REJECT, n);
  if (rejected.length) {
    return {
      action: 'reject',
      reasons: ['banned-words'],
      message: 'المشاركة فيها ألفاظ مش مناسبة لموقع عن الأطفال. عدّل الصياغة وجرّب تاني.',
    };
  }

  // A wall of links, or contact details, is spam or a privacy risk either way.
  if (URL_RE.test(combined)) reasons.push('link');
  if (PHONE_RE.test(combined)) reasons.push('phone');
  if (EMAIL_RE.test(combined)) reasons.push('email');

  const spam = hits(SPAM, n);
  if (spam.length) reasons.push('spam-words');

  const flagged = hits(REVIEW, n);
  if (flagged.length) reasons.push('watch-words');

  // Low-effort or shouty submissions
  const letters = (combined.match(/\p{L}/gu) || []).length;
  const uniqueRatio = new Set(n.hunt).size / Math.max(1, n.hunt.length);
  if (letters > 40 && uniqueRatio < 0.08) reasons.push('repetitive');
  const caps = (combined.match(/[A-Z]/g) || []).length;
  if (caps > 25 && caps / Math.max(1, letters) > 0.6) reasons.push('shouting');

  if (reasons.length) {
    return {
      action: 'review',
      reasons,
      message: 'مشاركتك اتسجلت وهتظهر بعد مراجعة سريعة — بنراجع اللي فيه لينكات أو ألفاظ حادة قبل النشر.',
    };
  }

  return { action: 'ok', reasons: [], message: 'اتنشرت — شكرًا 🌱' };
}
