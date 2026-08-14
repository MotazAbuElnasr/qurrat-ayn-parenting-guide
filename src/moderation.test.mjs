/**
 * Moderation checks — run with: node src/moderation.test.mjs
 *
 * The point of these cases is the two halves of "firm":
 *  1. evasion tricks (spacing, dots, tatweel, diacritics, repeats, digit-swaps)
 *     must NOT get past the filter, and
 *  2. a parent honestly writing «زعقت له وندمت» must NOT be blocked.
 * Add a case here whenever you add a word to a list.
 */
import assert from 'node:assert';
import { moderate } from './moderation.js';

const post = body => moderate({
  title: 'عنوان تجريبي كافي',
  body: body + ' نص طويل كفاية عشان يعدي شرط الطول الأدنى للمشاركة',
  teaches: 'حاجة مفيدة',
  name: 'أب',
});

const cases = [
  // legitimate parenting talk must pass untouched
  ['طفلي رفض ياخد الدوا ولقيت إن الاختيار بين حاجتين بينهي المعركة', 'ok'],
  ['زعقت له امبارح وندمت، رجعت بعد ما هديت واعتذرت وقلت له إني غلطت', 'ok'],
  ['بنتي بتكسر اللعب وأنا بحاول أفهم السبب', 'ok'],
  // the same banned word, spelled every way people dodge filters
  ['كلام س ك س', 'reject'],
  ['كلام س.ك.س', 'reject'],
  ['كلام سـكـس', 'reject'],
  ['كلام سككككس', 'reject'],
  ['كلام سِكْس', 'reject'],
  ['كلام ســ ـكـ ـس', 'reject'],
  ['watch p0rn here', 'reject'],
  ['f u c k this', 'reject'],
  ['fuuuuck', 'reject'],
  // sensitive but legitimate → a human reads it, never an auto-reject
  ['ابني بيضرب أخوه وأنا خايف الموضوع يكبر', 'review'],
  ['تواصل معي على واتساب للعرض الخاص', 'review'],
  ['شوف الموقع ده www.example.com', 'review'],
  ['رقمي 0501234567', 'review'],
];

let failed = 0;
for (const [body, want] of cases) {
  const got = post(body).action;
  if (got !== want) { failed++; console.error(`✗ want ${want}, got ${got}: ${body.slice(0, 40)}`); }
}
assert.equal(failed, 0, `${failed} moderation case(s) failed`);
console.log(`✓ ${cases.length} moderation cases pass`);
