// Whole-bundle checks that no single batch could make.
//   node policy.mjs sham
//   node policy.mjs eg msa sham     compare bundles
//
// check.mjs guards a batch against its source. This guards the finished bundle
// against the project's own rules, and against Egyptian leaking into a dialect
// that is not Egyptian.
import fs from 'fs';

import path from 'path';
const SELF = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(SELF, '..', '..');
const DIR = path.join(REPO, 'docs/content') + '/';

/* words that mean the translation did not happen here */
const EGYPTIAN = [
  'دلوقتي', 'دلوقت', 'إزاي', 'ازاي', 'ليه\\b', 'عايز', 'عاوز', 'مفيش', 'برضه', 'كده', 'كدة',
  'لوحده', 'لوحدها', 'امبارح', 'النهاردة', 'النهارده', 'بكره', 'علشان', 'عشان',
  'بتاع', 'بتاعت', 'دي\\b', 'ده\\b', 'دول\\b', 'كوباية', 'أوضة', 'اوضة', 'الفراخ',
  'طعمية', 'عيش بلدي', 'زبادي', 'الزبادي', 'ودان', 'وداني', 'جزمة', 'الجزمة',
  'التلاجة', 'برطمان', 'سلوتيب', 'حدوتة', 'حواديت', 'يعيّط', 'بيعيط', 'العياط',
  'الزن\\b', 'زهق', 'اتخض', 'بص\\b', 'بصي', 'شبشب', 'كوبري', 'ترابيزة', 'مرجيحة',
];
const RULES = [
  ['أغنية/أناشيد/موسيقى/يوجا (§1.3)', /(?<!\p{L})(?:أغني[ةه]|أغاني|أنشودة|أناشيد|موسيق[ىي]|يوجا)(?!\p{L})/gu],
  ['مدح بدل وصف (§1.5)', /(?<!\p{L})(?:شاطر|شاطرة|برافو)(?!\p{L})/gu],
  ['تأنيث للطفل (§1.6)', /(?<!\p{L})(?:بنتك|ابنتك|طفلتك)(?!\p{L})/gu],
  ['تحديد مكان القارئ (§2)', /(?<!\p{L})(?:ال)?(?:إمارات|امارات|أبوظبي|دبي|شارقة|إسكندراني|درهم|جنيه|ريال|ليرة|شيكل|دينار|كمبوند|كورنيش|هامور)(?!\p{L})/gu],
  ['backtick أو ${', /`|\$\{/g],
];
const SOURCEISH = /href=|مكتبة|مكتبات|منصة|قناة|مؤسسة|هيئة|جامعة|مهرجان|دار |Twinkl|منهج|بالعربي|مستشفى|حكومة/;

for (const d of process.argv.slice(2)) {
  const raw = fs.readFileSync(DIR + d + '.json', 'utf8');
  const b = JSON.parse(raw);
  console.log(`\n════ ${d} ════`);
  for (const [name, rx] of RULES) {
    const hits = [];
    for (let m; (m = rx.exec(raw));) {
      const ctx = raw.slice(Math.max(0, m.index - 260), m.index + 70);
      if (name.includes('مكان') && SOURCEISH.test(ctx)) continue;   // citing a source is allowed
      hits.push([m[0], raw.slice(Math.max(0, m.index - 60), m.index + 55).replace(/\\[nu]\S*/g, ' ').replace(/\s+/g, ' ')]);
    }
    rx.lastIndex = 0;
    if (!hits.length) { console.log(`  ✓ ${name}`); continue; }
    console.log(`  ✗ ${name} — ${hits.length}`);
    for (const [w, c] of hits.slice(0, 6)) console.log(`      «${w}»  …${c}…`);
    if (hits.length > 6) console.log(`      … و${hits.length - 6} كمان`);
  }
  if (d !== 'eg') {
    const leak = EGYPTIAN.map(w => [w, (raw.match(new RegExp('(?<!\\p{L})' + w, 'gu')) || []).length]).filter(x => x[1]);
    const total = leak.reduce((a, x) => a + x[1], 0);
    console.log(total ? `  ✗ تسرّب مصري — ${total} في ${leak.length} كلمة` : '  ✓ ما في تسرّب مصري');
    leak.sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([w, n]) => console.log(`      ${String(n).padStart(4)} × ${w.replace('\\\\b', '')}`));
  }
}
