/* فاحص المرجع — القواعد اللي ليها عدّاد بس.
   الحكم على المحتوى بالقراية (قاعدة ١٠.١١ في CLAUDE.md). ده بيشاور.

   node build/check-ref.js            التلات لهجات
   node build/check-ref.js eg         لهجة واحدة
*/
const fs = require("fs");

const strip = h => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const words = t => strip(t).split(/\s+/).filter(Boolean).length;

/* منهجية مكانها بلوك الأدلة مش نص البند */
const METHOD = [
  [/دراسة على \d|على \d+ (طفل|بنت|أب|أم|عيلة|رضيع)/g, "حجم عينة"],
  [/مراجعة منهجية|تحليل تجميعي|دراسة تتبعية|دراسة طولية|تجربة عشوائية|عرض مؤتمر/g, "نوع دراسة"],
  [/بدرجة ثقة|اتنقل (هنا )?بحذر|مش وصفة مقاسة|مغطتش|مش محسومة|صعب تفصل/g, "تحفظ منهجي"],
];

/* حاجات CLAUDE.md بتمنعها صراحة.
   لازم حدود صريحة — \b مبيشتغلش مع العربي (قاعدة ٤.٨)، و«درهم» من غيرها
   بتتمسك جوه «مصدرهم». */
const BANNED = [
  [/(?<!\p{L})(بنتك|طفلتك|ابنتك)(?!\p{L})/gu, "تأنيث الطفل"],
  /* الهمزة صح في الفصحى — القاعدة على الحقول العامية بس */
  [/(?<!\p{L})أنت(?!\p{L})/gu, "«أنت» بهمزة", "eg,sham"],
  [/(?<!\p{L})(درهم|درهمًا|جنيه|ريال|دولار)(?!\p{L})/gu, "عملة"],
  [/(?<!\p{L})(الإسعاف|النجدة|الشرطة)\s?\d{3}|اتصل بـ?\d{3}/gu, "رقم طوارئ"],
  [/(?<!\p{L})(يوجا|اليوجا)(?!\p{L})/gu, "يوجا"],
];

function sections(ref) {
  const idx = [...ref.matchAll(/<h2[^>]*>/g)].map(m => m.index);
  const out = [ref.slice(0, idx[0])];
  idx.forEach((s, i) => out.push(ref.slice(s, idx[i + 1] ?? ref.length)));
  return out;
}

function check(dialect) {
  const ref = require("./format.js").unpack(fs.readFileSync(`docs/content/${dialect}.json`, "utf8")).prose.ref;
  const parts = sections(ref);
  const notes = [];
  let liTotal = 0, over = 0, over100 = 0;

  parts.forEach((sec, i) => {
    const title = strip((sec.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [, "(مقدمة)"])[1]).slice(0, 40);
    /* المنهجية والمنع بيتقاسوا على النص خارج details */
    const body = sec.replace(/<details[\s\S]*?<\/details>/g, "");
    const lis = [...body.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]);
    liTotal += lis.length;

    const longs = lis.filter(t => words(t) > 60);
    over += longs.length;
    over100 += lis.filter(t => words(t) > 100).length;
    if (longs.length) notes.push(`  [${i}] ${title} — ${longs.length} بند فوق ٦٠ كلمة` +
      (lis.some(t => words(t) > 100) ? ` (${lis.filter(t => words(t) > 100).length} فوق ١٠٠)` : ""));

    const txt = strip(body);
    for (const [re, label] of METHOD) {
      const n = (txt.match(re) || []).length;
      if (n) notes.push(`  [${i}] ${title} — ${label} ×${n} في نص البند`);
    }
    for (const [re, label, only] of BANNED) {
      if (only && !only.split(",").includes(dialect)) continue;
      const n = (strip(sec).match(re) || []).length;
      if (n) notes.push(`  [${i}] ${title} — ⚠ ${label} ×${n}`);
    }
  });

  /* سلامة الشكل */
  const t = {};
  for (const m of ref.matchAll(/<(\/?)(\w+)[^>]*?(\/?)>/g)) {
    if (["br", "hr", "img", "input"].includes(m[2]) || m[3]) continue;
    t[m[2]] = (t[m[2]] || 0) + (m[1] ? -1 : 1);
  }
  const unbalanced = Object.entries(t).filter(([, v]) => v !== 0);
  if (unbalanced.length) notes.push(`  ⚠ تاجات مش متقفلة: ${unbalanced.map(([k, v]) => k + ":" + v).join(" ")}`);
  if (/[`]|\$\{/.test(ref)) notes.push("  ⚠ فيه backtick أو ${");

  console.log(`\n${dialect} — ${parts.length - 1} قسم · ${liTotal} بند · ${over} فوق ٦٠ كلمة · ${over100} فوق ١٠٠`);
  notes.forEach(n => console.log(n));
  return notes.length;
}

const only = process.argv[2];
let total = 0;
for (const d of (only ? [only] : ["eg", "msa", "sham"])) total += check(d);
console.log(`\n${total ? total + " ملاحظة" : "✓ مفيش ملاحظات"} — والباقي بالقراية.`);
