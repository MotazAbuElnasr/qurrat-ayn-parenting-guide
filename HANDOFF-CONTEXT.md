# HANDOFF — Arabic Parenting & Activities Guide (ages 3→5, neutral child)

Context document for the next agent picking up this project.
Written in English for precision; all user-facing content is Arabic (Egyptian dialect).
**Major restructure completed 2026-08-14** — this file replaces the previous handoff entirely.

---

## 1. Who the user is

- Egyptian father, based in **Sharjah/Dubai, UAE**. Works in tech (Tech Lead).
- Child ~3 years old. The guide is now written **gender-neutral** («طفلك» + masculine generic) by his explicit choice (option 1: keep 3-5 scope, neutralize gender). Factual boy/girl comparison content in the ref tab is intentionally kept.
- He writes in **Egyptian Arabic**, fast, with typos. Respond in the same dialect.

### How he works — critical
- **He rejects superficial content.** His words: «مش عايز اي حاجة سطحية او كلام مرسل مش واضح». Every step/activity must answer: أعمل إيه بالظبط، إمتى، أقول إيه — with a real household scenario. This is the #1 quality bar.
- **He rejects rigid templates.** He caught the forced 4-steps-per-value pattern («تحس انها حاجة ستاتك») — steps are now 3-6 per value, whatever is natural.
- **He checks counts and stale copy.** All counts in UI copy must be dynamic (`${VALUES.length}` etc.). He noticed a hard-coded "56 نشاط" and an old "49 قيمة".
- **He wants specific named items with links**, verified. A wrong URL is worse than none.
- He approves large directions first, then expects autonomous execution with agents/workflows in parallel. He explicitly asked for parallel agents on both research AND coding.
- **No music, no songs, no yoga anywhere in activities.** The old موسيقى activity category was deleted on his instruction. Video picks exclude song/clip content.

---

## 2. Current deliverable

**`دليل-التربية-الشامل-v2.html`** (same folder) — single self-contained HTML, ~560 KB, RTL, tabbed SPA, no build step. Google Fonts (Aref Ruqaa + IBM Plex Sans Arabic) + outbound links only.

Also in folder: `decisions.md` (architecture decisions log — keep updating it), this handoff.
Backups of every risky splice are in the session scratchpad (`backup-*.html`).

---

## 3. Architecture (post-restructure)

### The value is the atomic unit. Time is gone.
- **No months, no weeks.** The old 24-month curriculum and 12-week day-by-day tabs were deleted.
- `VALUES` (72 objects) is the core dataset. Each value:
  `{name, cat, age:[min,max], how, steps:[{t,d,say}×3..6], mastery, mistakes:[{m,fix}×2-3], adapt:[{kid,how}×2-3], acts:[{t,d}×2], say, deen:[title,how], skill, lvl:1-4, ord, tag, src:[[kind,name,url]]}`
- `lvl` = level in the مسار (1 الأساس، 2 البناء، 3 التوسع، 4 العمق) — dependency-based suggested order covering ALL values; `ord` = position within level. No value is "خارج المنهج".
- `mastery` = علامة الإتقان (observable behavior that signals moving on).
- `tag` links values to stories (`ST` tag vocabulary, 23 tags).
- `age` is [min,max] — max deliberately extends past 5 (دين/تعامل→12, عقل→10, جسد→9, ذات→8). Prep for a future age-selector feature (his request: every content item carries an age property).

### Other data arrays
| Const | Count | Notes |
|---|---|---|
| `VALUES` | 72 | see above; 49 originals deepened + 23 new from frameworks research |
| `ST` | 169 | 3asafeer stories [title,id,slug,tag]; harvest to extend was in flight at handoff time |
| `VID` | 81 | [channel,kind,type,title,url,vals[],note] — playlists(61)+videos(20), ALL live-verified 2026-08-14 |
| `ACT` | 80 | [cat,title,desc,dur,prep,how,age[min,max]] — how = full run instructions; 20 gross-motor added; موسيقى category deleted |
| `ACAT` | 7 | activity categories (no موسيقى); THEMES Wednesday = حركة |
| `SITS` | 20 | situations, degendered, linkedValues → goVal |
| `SCHOOLS` | 9 | pedagogy schools |
| `YTC` | 16 | channels (added حكايات يسمو @YasmoTales — verified). «حواديت» never found; user may send link |
| `RES` | 47 | resources incl. 16 Twinkl entries labeled honestly (اشتراك / مجاني بحساب) |
| `BAR`,`DAY`,`BOX` | | day rhythm + lunchbox, unchanged |

### Tabs (TABS const)
`home · ref (المرجع التربوي، 18 sections) · plan (المسار — levels) · values (بنك القيم، grouped under level h2s) · stories · vids (الفيديوهات) · day · acts · food (incl. التغذية 1-5 sections) · res`

### Navigation standard (his explicit requirement)
- Any tab with ≥3 `h2.sec` gets an auto-built sticky `.toc` chip row (generic code near end of script).
- IntersectionObserver marks the current section chip `aria-current` (answers «أنا واقف فين»).
- `.rel` chips at section ends = related sections/values/tabs («مرتبط بده») via `secGo(tab,match)` / `goVal(name)` / `go(id)`.
- Back-to-top button `#totop`; `hashchange` listener for deep links.
- Values bank cards are grouped under 4 level `h2.sec.lvlhead` headers so the same TOC pattern applies; filters hide empty level headers.

---

## 4. Editorial rules — do not silently break

1. **No superficiality** (see §1). Steps carry a scenario + a ready-to-say جملة. Activities carry full how-to.
2. **No music/songs/yoga** in activities or video picks.
3. **Videos tab is a deliberate exception** to the old channels-only rule: playlists preferred, every link verified with a visible date stamp + link-rot warning. If links are edited/added, re-verify and update the stamp.
4. **Honesty labels stay visible**: story tagging is title-based classification; channels content not fully watched; Twinkl paywall model spelled out; verification dates shown.
5. **Religion**: love/modeling/repetition, never fear-based; التقليد قبل التكليف; hadith/ayah anchors named accurately or phrased as meaning without attribution.
6. **No corporal punishment** (Wadeema law cited). Gender differences framed as adult-treatment differences.
7. **Counts in copy always dynamic.**
8. **Egyptian Arabic**, parent = انت, child = طفلك (masculine generic).

---

## 5. How to edit safely

1. **Patch, don't regenerate.** File is large. All structural edits were done via Node splice scripts in the scratchpad (pattern: locate `const X=` → bracket-count to end → replace; validate after).
2. **Validate after every edit**:
   ```bash
   node -e "const s=require('fs').readFileSync('FILE','utf8');
   const js=s.split('<script>')[1].split('</scr'+'ipt>')[0];
   new Function(js.replace(/\bdocument\b|\bwindow\b|\blocation\b/g,'({})'));
   console.log('OK')"
   ```
3. **Never build `<tr>` through a div** — use the `<template>`-based `el()`.
4. JSON-serialized data literals must not contain backticks (validated in merge scripts).
5. Render check: serve folder (`python3 -m http.server`) and open in browser; check console + counts.
6. Multiple agents must NOT edit the HTML concurrently — agents produce data/fragments, orchestrator splices.

---

## 6. Research provenance (all agent-verified, dates recorded)

- **Frameworks** (values audit): UAE Moral Education curriculum (rakaa.sch.ae PDF + GEMS MSC policy + almanahj), Islamic adab lists (علوان، الألوكة), CASEL/Head Start preschool SEL. Links live in ref section 18.
- **Ref sections 8-17**: AAP/healthychildren, NHS, CDC milestones (2022), WHO, Ellyn Satter Institute, Zero to Three, Winston's Wish/Sesame grief, bilingualism research (ASHA/De Houwer/Hoff). Sources collapsed under each section (`details.srcs`).
- **التغذية**: WHO sugar limits, AAP juice/drinks, NHS portions, Egyptian iron-deficiency guidelines.
- **Videos**: 61 playlists curl-verified (og:title match), 20 videos oEmbed-verified, 2026-08-14. Two malformed Yasmo playlist URLs were dropped deliberately.
- **Twinkl**: 14 sections + 2 free items verified 2026-08-14 via reader proxy (site serves hCaptcha to bots). Paywall model documented in res tab warn.

## 7. Open items at handoff time

- **Stories: DONE.** `ST` = 247 asafeer rows; `STX` = 201 external rows [platform,title,url,tag] (بالعربي نتعلم 60، مدرسة 68، أبوظبي 40، راويتي 33). Stories tab has platform + tag filters; value cards pull ST(4)+STX(3) by tag. **كتاكيب dropped** — turned out subscription-only (RES relabeled اشتراك). Platform access models spelled out in the tab's warn box, verified 2026-08-14.
- **حواديت channel** — unresolved; ask user for link.
- **Age-selector UI** — data is ready (age on values + activities); UI not built. When built, revisit per-value age maxes (currently category-rule estimates — see decisions.md §3).
- **Print/PDF export** — only CSS print rules exist.
- deen field for some original in-plan values is terse (e.g. الأمانة: «ودائع قريش وقت الهجرة») — could be deepened to match the new bar if user asks.
