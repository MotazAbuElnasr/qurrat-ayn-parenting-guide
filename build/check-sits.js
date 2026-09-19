/* فاحص المواقف — القواعد اللي ليها عدّاد بس.
   اللي مالوش عدّاد (هل دي خطوة ولا فكرة؟ هل الفرع نهاية ولا حلقة؟) بيتقري
   بالعين — قاعدة ١٠.١١ في CLAUDE.md. الفاحص ده بيشاور، مش بيحكم.

   الاستعمال:  node build/check-sits.js            كل اللهجات
               node build/check-sits.js eg 1,4,5   كروت بعينها
*/
const fs = require("fs");

const EVN = /ممارسة شائعة|مش دليل|مفيش دراسة|مفيش دليل|توصية طبية|لا توجد دراسة|ما في دراسة/;

/* مصطلحات محدش بيقولها في البيت. العدّاد بيقول المتكرر معجم والنادر زلة
   (قاعدة ١٠.٥) — فاللي هنا نادر ومقصود. «حوض» و«قاموس» اتشالوا: الأولى
   حوض المطبخ والتانية معجم الموقع. */
const JARGON = [
  "الترقوة", "القشرة الجبهية", "التنظيم الذاتي", "الضاغط", "الانطفاء",
  "الاستدماج", "التنظيم الانفعالي", "الحجاب الحاجز", "المدخل الحسي",
];


/* نفس قطّاع القشرة بالحرف — أي تغيير في docs/index.html لازم ينزل هنا */
const cutAt = (t, min) => {
  t = String(t); const out = []; let cur = "", q = 0;
  const end = i => i + 1 === t.length || t[i + 1] === " ";
  for (let i = 0; i < t.length; i++) {
    const c = t[i]; cur += c;
    if (c === "«") q++;
    else if (c === "»") { q && q--;
      if (!q && /[.؟!]/.test(t[i-1]||"") && cur.trim().length >= min && end(i)) { out.push(cur.trim()); cur = ""; } }
    else if ((c === "." || c === "؟" || c === "!") && !q && cur.trim().length >= min && end(i)) { out.push(cur.trim()); cur = ""; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
const bullets = t => {
  const ss = cutAt(t, 1); let note = "";
  while (ss.length > 1 && ss[ss.length-1].length < 130 && EVN.test(ss[ss.length-1])) note = ss.pop();
  return cutAt(ss.join(" "), 90);
};
/* الـ«لو» جوه جملة الأب مش فرع — تتشال قبل الحكم (قاعدة ٤.١٨) */
const strip = c => c.replace(/«[^»]*»/g, "");

/* الحقول اللي الأب بيقراها فعلًا. الأدلة والمدارس ليهم لغتهم. */
const FACING = ["why", "fallback", "after", "mistake", "prevent"];

const load = d => JSON.parse(fs.readFileSync(`docs/content/${d}.json`, "utf8")).data.SITS;

function checkCard(s, i, dialect) {
  const out = [];
  const say = (s.now || []).filter(n => n.say && n.say.trim()).length;

  if (!s.now || !s.now.length) out.push("مفيش خطوات");
  if (say !== (s.now || []).length) out.push(`${(s.now||[]).length - say} خطوة من غير say`);
  if (!s.fallback) out.push("__NOFB__");

  /* الحاشية على strong/moderate بس — على practice هي تكرار للشارة */
  if (s.fallback && s.evi) {
    const has = EVN.test(s.fallback);
    /* القاعدة: الحاشية ممنوعة على practice. مش واجبة على غيره. */
    if (s.evi.c === "practice" && has) out.push("حاشية أدلة على كارت practice");
  }


  /* قاعدة ١٠(أ): كل فرع يبدأ نقطة — الفرع اللي بيبدأ في نص نقطة الأب مبيلاقهوش */
  if (s.fallback) {
    const mid = bullets(s.fallback).filter(c => /[.؟!]\s+(و?لو|و?إذا)\s/.test(strip(c))).length;
    if (mid) out.push(`${mid} فرع بيبدأ في نص نقطة — الأب مش هيلاقيه (قاعدة ١٠أ)`);
  }
  /* الفرع اللي بيقول «كرر تاني» حلقة مش فرع */
  if (s.fallback && /كرر الخطوات|ارجع من الأول|اعمل الخطوات تاني/.test(s.fallback))
    out.push("الفرع بيرجّع للخطوات — حلقة مش فرع");

  /* backtick / ${ بيكسروا الحقن في الـtemplate literal */
  const blob = JSON.stringify(s);
  if (/[`]|\$\{/.test(blob)) out.push("فيه backtick أو ${");

  /* تأنيث الطفل + همزة «أنت» في الحقول العامية */
  if (dialect !== "msa") {
    for (const k of FACING)
      if (typeof s[k] === "string" && /(?<!\p{L})أنت(?!\p{L})/u.test(s[k]))
        out.push(`«أنت» بهمزة في ${k}`);
  }

  /* مصطلح محدش بيقوله، في نص الأب بس */
  for (const k of [...FACING, "now"]) {
    const t = typeof s[k] === "string" ? s[k] : JSON.stringify(s[k] || "");
    for (const w of JARGON)
      if (t.includes(w)) out.push(`«${w}» في ${k}`);
  }

  /* d بيكرر say اللي تحته */
  (s.now || []).forEach((n, k) => {
    if (n.say && n.d && n.d.includes(n.say.replace(/[.؟!]$/, "")))
      out.push(`خطوة ${k + 1}: d بتكرر say بالحرف`);
  });

  return out;
}

const [dialectArg, idxArg] = process.argv.slice(2);
const dialects = dialectArg ? [dialectArg] : ["eg", "msa", "sham"];
const only = idxArg ? idxArg.split(",").map(Number) : null;

let total = 0;
for (const d of dialects) {
  const S = load(d);
  const rows = [];
  const noFb = [];
  S.forEach((s, i) => {
    if (only && !only.includes(i)) return;
    let errs = checkCard(s, i, d);
    if (errs.includes("__NOFB__")) { noFb.push(i); errs = errs.filter(e => e !== "__NOFB__"); }
    if (errs.length) rows.push(`  [${i}] ${s.t}\n      ${errs.join("\n      ")}`);
    total += errs.length;
  });
  console.log(`\n${d} — ${only ? only.length : S.length} كارت · ${rows.length} فيهم ملاحظات`);
  rows.forEach(r => console.log(r));
  if (noFb.length) { console.log(`  فجوة معروفة: ${noFb.length} كارت من غير fallback (قاعدة ٩)`); total += 1; }
}
console.log(`\n${total ? `${total} ملاحظة` : "✓ مفيش ملاحظات"} — والباقي بالقراية.`);
process.exit(0);
