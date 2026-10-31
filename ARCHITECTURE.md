# Bubu's Water Club — Codebase Reference

A Manifest V3 Chrome extension that tracks daily water intake and nudges the user with an animated
mascot bear, both in the toolbar popup and floating on every web page.

- **Name:** `Bubu's Water Club`. The bear is **Bubu**; **Dudu** is the voice cheering him on
  (`Dudu is cheering for you!`, `Amazing Bubu! Dudu is proud of you!`).
- **Version:** 2.0.0 · vanilla JS / HTML / CSS · **no build step, no dependencies, no tests.**

---

## 1. Loading and testing

1. `chrome://extensions` → **Developer mode** → **Load unpacked** → select this directory.
2. After editing, reload the extension. A content-script change additionally requires **reloading the
   target page** — open tabs keep the old bundle.

Verification is manual, in real Chrome. The popup only renders with a `chrome` API present, so a plain
static dump shows it unrendered, and the widget lives in a **closed** shadow root. There is no test
suite; the pure night-shift logic (day rollover, streaks, quiet-hour wrap, the sync merge) is what a
harness would cover first.

**An unpacked build cannot be loaded from the command line in current Chrome** — `--load-extension` is
ignored, flags included, so the browser's own component extensions are the only ones you will see in
`/json/list`. That makes a normal profile the only way to exercise `chrome.storage.sync` end to end.

---

## 2. File map

| File | Role |
| --- | --- |
| `manifest.json` | MV3 config: permissions, action popup, service worker, content script registration |
| `background.js` | Service worker — reminders (page bubble or OS notification), snooze alarm, toolbar dot and tooltip, cross-device sync |
| `popup.html` | Popup markup (340px wide) |
| `popup.js` | Popup logic — counting, week strip, streak, settings, confetti |
| `bear.css` | The mascot's rules: tiers, variants, keyframes (shared by both surfaces) |
| `bear.svg` | The mascot drawing (single source for both surfaces) |
| `preload.js` | `document_start` content script: publishes a lazy, memoised loader (`window.__bubuLoadAssets`) for `bear.css` + `bear.svg` |
| `lines.js` | The reminder copy and `bubuLine()`: loaded by `content.js` (as a content script) and by the worker (`importScripts`), so the bubble and the OS notification pick the same sentence from the same list |
| `style.css` | Popup chrome: layout, settings, week strip, confetti |
| `content.js` | Self-contained IIFE: draggable floating bear in a closed shadow root |
| `icon*.png` | Toolbar icons (128/48/32/16) — raster renders of the mascot, must stay at the root |

Artwork and styling are each edited once: **`bear.svg`** holds the drawing, **`bear.css`** the rules.
`popup.html` links the sheet and `popup.js` injects the markup in `init()`; `content.js` interpolates
both into its shadow root. Only the widget's chrome (`.wrap`, `.bubble`, `.count`, `.snz`) lives inside
`content.js` as a template string.

---

## 3. Permissions

- `alarms` — the repeating reminder timer and the one-shot snooze.
- `storage` — the shared state record, plus `storage.sync` for the cross-device mirror (same permission).
- `tabs` — reads `tab.url` to decide which tabs receive a reminder, and `windows.getLastFocused` to decide
  whether any of them is actually on screen.
- `notifications` — the OS fallback when no page can show a reminder. It is a *warning* permission, so an
  already-installed build has to accept the update before the fallback works.
- `web_accessible_resources` — `bear.css` + `bear.svg`, because a content script's own `fetch` runs under
  the **page's** origin; `content.js` falls back to the `DUDU_ASSETS` worker call when that returns empty.
- Content scripts match `http://*/*`, `https://*/*`, `file:///*` in two entries — `preload.js` at
  `document_start`; `lines.js` then `content.js` at `document_idle`. `file://` needs **Allow access to file URLs**;
  `chrome://` pages can never be matched and there is no new-tab override.

---

## 4. Data model

One flat `chrome.storage.local` record, shared by every context.

```js
{
  interval: 45,   // minutes between reminders
  enabled:  true, // reminders on/off
  glasses:  0,    // glasses drunk today
  goal:     8,    // daily glass target, clamped 1–30
  lastDay:  '',   // "YYYY-MM-DD" the count belongs to
  floating: true, // show the bear on web pages
  quiet: false,   // pause reminders inside the quiet window
  quietFrom: 22,  // window start hour, 0-23
  quietTo: 7,     // window end hour, 0-23 (wraps midnight when < quietFrom)
  stopAtGoal: false, // stop reminding once the goal is reached
  history: [],    // finished days: [{day, glasses, goal}], oldest first, capped at 30
  pos: {right: 22, bottom: 24},          // bear position in px, shared by every tab
  bubble: {open: false, at: 0, line: 0}, // reminder bubble + write stamp + caption index
  syncAt: 0,      // epoch ms of the last action that changed the count; orders today across devices
  syncMeta: {},   // {key: epoch ms of the last edit} per account-wide setting; the newer edit wins
  snoozeUntil: 0, // epoch ms a snooze fires at; the bear's clock badge shows while this is in the future
  bear: 'bubu'    // mascot variant: one of BEARS — one extra <g> revealed per variant
}
```

**Defaults are duplicated in three files** — `DEFAULTS` (`background.js`), `get(DEFAULTS)`
(`popup.js`), `defaults` (`content.js`). Adding or renaming a key means editing all three. Each context
keeps only what it needs: `background.js` omits `history`/`pos` but both reads and writes `bubble` (the
badge dot, and closing the reminder after the notification's drink button); `content.js` omits
`interval`/`quiet`/`quietFrom`/`quietTo` but carries `stopAtGoal`, which `canShow()` needs.

### Day rollover

`toLocaleDateString('en-CA')` is used only because that locale formats as ISO `YYYY-MM-DD`, so dates
compare correctly as strings. Any context may notice a stale `lastDay`: the popup (`rollover()`) and
`content.js` both archive the finished day into `history` before resetting `glasses`, keyed by `day` so
rolling over twice replaces rather than duplicates. The array is sorted and capped at 30 in both places
— keep `HISTORY` (`popup.js`) and its `slice(-30)` in step.

### Cross-device sync

`chrome.storage.local` stays the single source of truth every context reads; `background.js` mirrors the
account-wide keys into `chrome.storage.sync` and applies incoming values back, so nothing else knows
sync exists.

- **Synced:** `interval`, `enabled`, `goal`, `floating`, `quiet`, `quietFrom`, `quietTo`, `stopAtGoal`,
  `bear` (the `SYNCED` list), plus `history`, today's count, and `syncMeta`.
- **Never synced:** `pos` and `bubble` (viewport-relative) and `snoozeUntil` (a snooze belongs to the
  device that tapped it).
- **Settings are ordered by edit time, not arrival.** Each edit stamps `syncMeta[key]` — `save()` in the
  popup, the × on the widget — `mergeMeta()` unions those maps by max, so the stamps converge
  monotonically, and `newerSetting()` picks the later edit even when its value reached the account
  second. Equal or missing stamps fall back to the calling direction (`push`/`pull`), i.e. the old
  last-arrival rule.
- **Today's count is a register, not a max.** `glasses` / `lastDay` / `syncAt` travel together: the later
  date wins, and same-day values settle on `syncAt`, the stamp of the last action (drink, undo,
  rollover). A max merge would resurrect a glass the user just undid. `syncAt` is written by whichever
  context acted, never by the mirror, so applying a remote count cannot restamp it.
- **Adopting a newer day archives the one it leaves**, exactly as `rollover()` does.
- **A day ahead of this device's clock is ignored**, not adopted: two timezones would otherwise roll each
  other over in a loop.
- **History merges by day**, larger count winning. Max is associative, so the union is commutative and
  the mirror settles instead of oscillating.
- **Startup pulls before seeding**, so a fresh install in a signed-in browser adopts the account's
  settings instead of writing `DEFAULTS` over them.
- **Best effort:** sync needs Chrome sign-in; otherwise values simply stay local. Writes can fail on
  quota (8KB per item, ~100KB total — the 30-day history is ~1.5KB) and are warned about and dropped.

---

## 5. Contexts and messages

```
popup.js ──writes──┐
                   ├──> chrome.storage.local ──onChanged──> background.js, content.js (re-sync)
background.js ─────┘
background.js <──────> chrome.storage.sync   (mirror of SYNCED + history + count; pulled on startup)
background.js ──{type:'DUDU_REMIND', at}──> content.js   (fire-and-forget broadcast, one `at` per round)
content.js ────{type:'DUDU_SNOOZE'}──> background.js (arms the one-shot `snooze` alarm)
content.js ────{type:'DUDU_ASSETS'}──> background.js (re-reads bear.css + bear.svg when the page-origin fetch is empty)
```

- **Storage is the source of truth.** The popup renders from its in-memory `state` after
  `Object.assign`, and every context re-reads on `storage.onChanged`.
- **A page if one can show it, the OS otherwise.** The worker messages every matching tab and swallows
  the rejections, then asks `visiblePage()` whether anyone can see a bubble: the last-focused window must
  be focused and not minimised, and its active tab must match `^(https?|file):`. If not, it raises a
  `chrome.notifications` notification. "A tab exists" is not the test — a bubble written into a background
  tab is invisible, so the test is "a tab a person is looking at".
- **The notification is the same reminder in OS clothing.** Same heading, same `SNOOZE` length, and two
  buttons that reuse the bubble's own paths (`drinkFromNote()`, `armSnooze()`). It has no bear, no caption
  and no animation: what the page adds is exactly what is lost there.
- **The widget mounts on demand.** A tab where Floating Bubu is off pays one storage read (which still
  rolls the day over) and two listeners and builds nothing — no shadow root, no asset fetch, no
  animation tree. Enabling the bear, or a reminder arriving, mounts it then, which is how a reminder
  still reaches a page that never drew one. A reminder *already* on screen (`bubble.open` in storage)
  mounts it too, so a page opened after the broadcast does not miss the reminder that is up everywhere
  else — that page receives no `DUDU_REMIND` of its own.

---

## 6. Runtime flow

### Popup (`popup.js`)

- `init()` loads state, rolls the day over, builds the hour pickers, renders. `main` starts
  `visibility:hidden` and `render()` adds `main.ready` last, so the placeholder values are never painted.
  `init()` falls back to `DEFAULTS` if `storage.get` rejects and the rollover write is `.catch`-ed, so
  the popup can never stay blank.
- Every control saves on change; there is no Save button. `drink` = `+1`, `undo` = `-1` clamped at 0 and
  disabled at zero. `save()` stamps `syncAt` on a glass change and `syncMeta[k]` on any settings change.
- **Switches, not checkboxes** — `#enabled`, `#floating`, `#quiet`, `#stopAtGoal` are restyled native
  `<input class="switch">`, so labels, keyboard activation and `change` listeners keep working.
- **Goal is a −/+ stepper**, clamped 1–30 with the buttons disabled at the bounds. `hold()` repeats every
  90ms after 420ms, repainting through `paint()` and persisting **once on release** — saving per tick
  would fire `storage.onChanged` in every open tab.
- `status()` writes `#next` from `chrome.alarms.get('water')`: `Next reminder in ~N min`, an empty line
  when nothing will fire (reminders off, or done with `stopAtGoal`), or `Quiet hours until HH:00`.
- **`fitInterval()` runs at init**, before the first render: a stored `interval` the picker no longer offers
  (2 minutes was removed) would otherwise leave the select blank while the old cadence kept firing. It moves
  the value onto the first remaining choice and stamps `syncMeta.interval`, so it settles across devices like
  any user edit.
- **Mood caption:** `data-tier` on `#bear` is `Math.min(9, floor(pct/10))` and the same index fills
  `#mood` from `MOODS`, so words and drawing cannot disagree.
- **Bear variants** are stepped with ‹ › (`#bearL`/`#bearR`), stored as `bear`, and drawn identically by
  the floater.
- **Week strip** (`#week` + `#streak`) shows the last seven days from `history` plus today, live in
  `state`. A missing record is a gap, not a zero. Bar height is relative to **the week's peak** (largest
  count or goal in the seven days), so a 12/8 day is taller than one that merely hit its goal. Each day
  is a real `<button>`; there is **no `title`** anywhere on the strip, so the detail lives in
  `aria-label` and in the streak line when a bar is clicked. Clicking the same bar or anywhere outside
  clears the selection; no timer runs.
- `streakDay()` counts consecutive goal-meeting days ending today, or ending yesterday while today is
  still in progress, so a good run is not reported broken at 9am.
- **Settings have their own view.** `⚙` (`#settingsBtn`, top-right) relabels to `Done` and toggles
  `body.show-settings`; rows are grouped by a `glabel` — **Reminders** (Gentle reminders; Quiet hours;
  *Remind me every* sharing one `.inline` row; *Stop reminders after goal reached*; the next-reminder
  line), **Companion** (Floating Bubu), **Daily goal** (the stepper). `Escape` closes the view, which is
  a body class and never stored, so a save from the card does not bounce the user back.
- **Quiet hours** is one row: label · two 24-hour selects · switch, with the pickers hugging the switch
  and disabled while it is off. Nothing is rescheduled — the worker declines to send inside the window,
  so the cadence resumes by itself. The row is a `<div>`, never a `<label>` around the switch.
- With Gentle reminders off, `main.reminders-off` hides every reminder row; `status()` clears its line
  rather than writing a "paused" notice.
- **Reaching the goal** starts a confetti emitter (4 pieces every 220ms, five shapes, `#confetti` a
  140px absolutely positioned strip so the popup height does not change) and adds `done` to `body`:
  a ✓ on the count, green text, and the bar switching to `#5f8f4f`. Start and stop are idempotent and
  both bail under `prefers-reduced-motion`.
- **The toolbar carries no number** — a dot while a reminder is pending, plus the hover tooltip rebuilt
  from storage: `Bubu's Water Club — 5 of 8 glasses today`.
- **Popup sizing:** bear box 176.25px, tracker ~463px tall, settings ~532px — inside Chrome's 600px cap.

### Background (`background.js`)

- Schedules a repeating `'water'` alarm (`delayInMinutes` + `periodInMinutes` = `interval`) on
  `onInstalled` (which also seeds storage when empty), `onStartup`, and `storage.onChanged` for
  `interval` / `enabled` / `stopAtGoal`.
- On `water` or `snooze`: `remind()` refreshes the badge, re-reads state and bails if `enabled` is off,
  `inQuiet(state)` is true, or `stopAtGoal && glasses >= goal`. Otherwise it broadcasts `DUDU_REMIND` to
  every tab matching `^(https?|file):`, carrying one `at` stamp for the whole round, and then falls back to
  `notify()` when `visiblePage()` says no page can show it.
- **The notification has no page to roll the day over**, so `drinkFromNote()` archives the day it leaves the
  way `popup.js` and `content.js` do, stamps `syncAt` like any other glass, and writes `bubble.open:false`
  so a reminder left up in another tab cannot outlive the answer. `clearNote()` also runs on any `glasses`
  change, so drinking from the popup or the bubble takes the OS copy down with it.
- **The badge shows a dot, not a number,** while `bubble.open` is set and the day is not settled: on
  `chrome://` pages and the new-tab page it is the only signal there is. It clears through the same path as
  the bubble, because every dismissal writes `bubble.open:false`.
- **Quiet hours are a fire-time check**, not a scheduling one, so a 3am alarm costs nothing and the
  cadence is untouched. The same guard covers the snooze alarm.
- **Snooze:** a content script has no `chrome.alarms`, so the bubble's *Snooze 10 min* sends
  `DUDU_SNOOZE` and the worker arms a one-shot `snooze` alarm `SNOOZE` (600 s) out using `when` — an
  absolute stamp, and deliberately the same number `snoozeUntil` carries. It writes the same stamp to
  `snoozeUntil`; the alarm clears it *before* `remind()` runs, and `schedule()` zeroes it when reminders
  are disabled, so the badge cannot outlive its snooze. Re-creating the alarm replaces the pending one.
  `armSnooze()` is the single path for both buttons, and it closes the reminder as well as arming it: when a
  bubble is up it writes `bubble.open:false`, so snoozing from the OS notification also drops the bubble
  waiting in a background tab, and in lone mode the host is hidden with it. The bubble's own *Snooze* passes
  `closeBubble:false` instead — it has already written `open:false` before sending, and a second write would
  cut short the 180ms fade happening in the tab the user tapped.
- **Cross-device mirror.** `syncNow(dir)` runs on a local change to a synced key, on
  `storage.sync.onChanged`, and after install/start. It reads both stores and writes only what differs:
  settings by `syncMeta`, the count by `syncCount()`, history by union, `syncMeta` by max.
  `pushSync()`/`pullSync()` are the two entry points; `dir` only breaks ties.

### Content script (`content.js`)

- Guarded by `window.__duduWaterLoaded`; `mount()` creates a fixed-position host
  (`right:22px; bottom:24px; z-index:2147483647; touch-action:none`), attaches a **closed** shadow root
  and writes markup + CSS via `innerHTML`. `ensure()` runs the lazy `window.__bubuLoadAssets` first, so
  the two asset requests happen only when the widget is about to be drawn.
- **The bubble is shared across tabs, like `pos`.** `storage.bubble = {open, at, line}`: every show
  writes `open:true`, every dismissal (*Snooze 10 min*, *I drank water!*, ×) goes through `hide()` and
  writes `open:false`. A show reuses the reminder's broadcast `at` rather than its own clock, so all
  tabs write the same record — same stamp, same caption — and none has to adopt a foreign one. Each tab
  still ignores its own echo by comparing `at`; a dismissal has no stamp and takes the local clock. It
  **never auto-dismisses**.
- **`canShow()` is the one gate for every bubble path:** `!goalSettled() && enabled && !hidden`, where
  `goalSettled()` is `stopAtGoal && glasses >= goal`. `floating` is deliberately absent — with the bear
  off, a reminder raises the bubble on its own (`.wrap.lone`) instead of firing into nothing. Message
  handlers re-check it *after* `refresh()`, so a message cannot outrun a settings change.
- **Lone mode.** With Floating Bubu off the host is still rendered for a reminder: `.wrap.lone` widens
  the wrap to 240px, hides `.bear` and `.count`, and lays the bubble out in normal flow. The bubble
  itself becomes the drag handle there, since the bear is not on screen to be one. Host visibility is
  `(floating && !hidden) || bubble showing`.
- **Snooze fades out.** `hide(soft)` writes `open:false` immediately (every other tab drops at once) but
  keeps this tab's DOM for the 180ms `fadeOut`; `unout()` clears `.out` and its timer at the start of
  `show()`, so a reminder landing mid-fade is not swallowed. Drink and × stay instant.
- **Drinking** writes `glasses + 1`, `lastDay`, and a fresh `syncAt`, then plays `gulp` on `.drink .bear`
  (0.8s, one shot). `cheer` fires only on the *crossing* into a done day.
- **× is the global off switch:** it sets the local `hidden` flag for instant feedback, then writes
  `floating:false` plus a `syncMeta.floating` stamp, so the bear leaves every page and the popup's
  toggle follows.
- **Drag** is one `grip(el, skip, loneOnly)` bound twice: to `.bear`, and — in lone mode only — to
  `.bubble`. Pointer events with `setPointerCapture`, clamped to the viewport, writing the inline
  `right`/`bottom` live and persisting `storage.pos` **once on pointer-up**. A move over 6px counts as a
  drag; a click alone does nothing, and a press that starts on a `button` never becomes a drag, so Drink
  and Snooze stay tappable. The clamp measures the host, so the 240px lone bubble stops at the viewport
  edge instead of at the bear's box. `fit()` re-clamps on `resize` and on every `refresh()`.
- **`place()`** runs on every show: it reads `offsetLeft`/`offsetWidth` and nudges the bubble so both
  edges stay ≥8px inside the viewport. Measuring via `offset*` matters because the `pop` keyframe starts
  at `scale(.9)`.
- **Copy:** the caption comes from `BUBU_LINES` in `lines.js` (ten short warm lines) through `bubuLine()`,
  which hashes the reminder's broadcast stamp and skips the previous line read from `storage.bubble.line`.
  Every open bubble therefore shows the same caption without a storage round-trip, and no line repeats back
  to back. The worker calls the same function with the same stamp and the same previous line *before* it
  broadcasts — the broadcast is what overwrites `bubble.line` — so the OS notification carries the identical
  sentence. `lines.js` is loaded twice from one file: as a content script riding with `content.js`, and via
  `importScripts()` in the worker. The `Water time!` heading is fixed. The snooze button carries an inline SVG
  clock (`.ico`, `stroke:currentColor`), not an emoji. `SNOOZE` (background) is 600 s — ten minutes — to match
  its label, and the notification button derives its label from the same constant.
- **Clock badge while snoozed:** `snoozeBadge()` toggles `.snoozing` from `snoozeUntil > Date.now()`; one
  timeout re-runs `refresh()` at expiry, cleared on every refresh so a cancelled snooze never strands it.
- **Eyes follow the pointer** on both surfaces: offset from the bear's centre, `/40` clamped to **±14**
  and `/70` clamped to **±6** (SVG user units, written with a `px` suffix), consumed by
  `translate(var(--look),var(--lookY))` with a 0.18s transition. The look holds until `pointerleave` —
  no settle timer, so a blink never recentres the eyes.
- Self-syncs on `storage.onChanged` for `floating`, `glasses`, `goal`, `enabled`, `lastDay`, `pos`,
  `snoozeUntil`, `bear`, plus `bubble` through its own listener. A key that is persisted but missing
  from that list silently never reaches the widget.

---

## 7. Conventions

- **Dense, single-line-per-function style** with short identifiers and chained ternaries. DOM lookups
  use `$ = id => document.getElementById(id)` in the popup; numbers from storage pass through `safe()`.
- **One mascot: Yier (一二), the white panda.** Palette: white face `#ffffff`, heavy `#231815` outline and
  ears, `#ffb8b8` blush, `#ff6e78` tongue, `#c0392b` bow and gems, `#e0a33e` crown gold, `#7cb9e6` drink
  button and hat dome, `#4b8fbc` hat brim and headphone band, `#5f8f4f` pine scarf with `#f7e8dc` trim.
  Don't add a second palette or a second mascot.
- **One drawing, one rule set.** `bear.svg` holds the single `<svg class="yier" viewBox="0 12 400 316">`
  and `bear.css` the rules that drive it. The popup `.bear` is 176.25px wide and the floater's 117.5px,
  both `height:auto`. Widget geometry that follows the bear: `.wrap` 152px, `.count` chip 118px,
  `.bubble` at `right:134px; bottom:66px`, drag clamp `host - 6`. The wrap's shadow is a static gradient ellipse
  (`.wrap::after`), not a `drop-shadow` filter — a filter over the continuously animated subtree would
  re-blur on every frame.
- **Variants are a `data-bear` attribute, never a second SVG.** `specs` (thin ring lenses + bridge and
  temples), `bow` (red ribbon on the crown), `buckethat` (blue dome over a wide brim that covers the
  whole head), `coffee` (cup appears at 30%, straw into the mouth, sip loop quickens with progress),
  `coolers` (opaque shades, painted **after** the eye groups), `crown` (gold five-point crown with
  gems), `headband` (red band with a gold sheen that appears only on a complete day), `headphones` (band
  over the crown to two ear cups), `hearts` (seven hearts whose opacity is progress), `scarf` (pine wrap
  with cream tails that lead the breeze), `angry` (thick brows that clear by ~60%). The ids live in
  `BEARS`/`BEAR_NAMES` (`popup.js`) and in the `data-bear` whitelist (`content.js`) — all three must
  list every variant. `BEARS` keeps plain Bubu first and the rest **alphabetical by label**.
- **Tiers are data, not duplicated CSS.** Ten tiers, one per 10% of the goal, each setting only
  `--open`, `--blush`, `--tilt`, `--spark`, `--zzz`, `--mouth` (and `--angry`), which the base rules
  consume. Cadence variables ride the same machinery: `--wind` (a multiplier that shortens the sway
  loops as the goal fills, `.958` at tier 0 → `.3` at tier 9), `--fill` (scarf opacity), `--hearts`
  (hearts opacity, `.06` → `.9`), `--hwind` (hearts-local copy of `--wind` so the ring peaks only at
  100%), `--sip-dur`/`--sip-play` (coffee). **The `1`/final values are reserved for `.bear.done`**
  (glasses ≥ goal), never for tier 9 — that is what keeps a 90% day from looking finished. The `z`
  glyph count scales through `.zzz::before` because `--zzz` only fades the element.
- **`--open` is the eyelid, unitless `1` / `.06`.** `scaleY(.06px)` is invalid and silently dropped, so
  keep both tier tables unitless. Three nested elements per eye, one job each: `.eye` owns the pointer
  `translate`, `.blink` the keyframes, `.lid` `scaleY(var(--open))`. Blink is a ~120ms flick
  (12/42/72% of a 16s cycle) and hangs off `main.ready .blink` in the popup so it cannot start before the
  tier is written; tiers 0–2 switch it off.
- **One layout read per frame, not per move.** Both surfaces cache the bear's box and fold a burst of
  pointer moves into one `requestAnimationFrame`; the widget drops the cache on drag, resize and refresh.
- **Don't hoist `cheer`/`drink` animations to `.bear` or `.lid`** — they replace `.bear`'s animation list
  and would drop or replay the blink. The widget's `bob`/`gulp`/`cheer` keyframes must each repeat
  `transform:rotate(var(--tilt,0deg))`, because a transform in a keyframe replaces the base transform.
- **Accessibility and colour:** tab order, labels, `aria-live` and `role` attributes are deliberate. The
  strip is interactive so it is not `aria-hidden`; the bear is decorative and is. Text meets WCAG AA on
  its real background (`#a85737` button with white text, `#8a6552` secondary) — don't lighten toward
  `#d99778`/`#b18472`. **Light mode is pinned** with `:root{color-scheme:light}` and a matching meta tag.

---

## 8. Gotchas

1. **Chrome's own pages cannot host Bubu.** `chrome://`, `devtools://`, the Web Store and other
   extensions' pages are closed to content scripts. Don't add `chrome_url_overrides` — overriding the
   new tab replaces Chrome's own for every install. `file://` works only with file-URL access enabled.
2. **`enabled` ≠ `floating`.** `enabled` off stops reminders but leaves the bear; `floating` off hides
   the bear while reminders still arrive as a lone bubble.
3. **× turns Floating Bubu off globally** — it is a shortcut for the popup's toggle, not a per-tab hide.
4. **Reloading the extension does not re-inject into open tabs**, so hide/drag/drink appear broken there
   until the page is reloaded.
5. **Defaults are triplicated** across the three files, and `BEARS`/`BEAR_NAMES`/the `data-bear`
   whitelist must agree. `SYNCED` lives only in `background.js`.
6. **Sync is best-effort.** `chrome.storage.sync` needs Chrome sign-in; otherwise values stay on that
   profile. Quota failures are warned about and dropped rather than blocking a save.
7. **Every sync stamp is `Date.now()` from whichever device acted**, so a badly skewed clock can make an
   older edit look newer; the higher stamp always wins. Stamps only grow, so a clock that jumps backwards
   cannot unpick a resolved value, and two quick taps on different devices collapse to the later one
   rather than summing.
8. **The toolbar icons must stay at the project root** and are raster renders of the mascot — re-render
   and downscale to 128/48/32/16 when the artwork changes.
9. **The bubble's CSS position is a starting point** — `place()` re-clamps it on every show, so there is
   no constant to keep in step with the offset in `content.js`.

---

## 9. Common tasks

| Task | Where |
| --- | --- |
| Add a reminder interval | `<select id="interval">` in `popup.html`; the value is parsed as a Number |
| Change the default cadence | `DEFAULTS` (`background.js`), `get(DEFAULTS)` (`popup.js`), `defaults` (`content.js`) |
| Restyle the popup | `style.css` |
| Restyle the bear itself | `bear.css` — one file for both surfaces |
| Restyle the widget chrome (bubble, count chip, snooze badge) | the `<style>` template string in `content.js` |
| Add a persisted setting | all three defaults blocks and a control + `save()` call in `popup.js` |
| Sync a setting across devices | add its key to `SYNCED` in `background.js`; defaults change as above |
| Change the snooze length | `SNOOZE` in `background.js` (seconds, armed via `when`) and the button label in `content.js` |
| Change the toolbar tooltip | `badge()` in `background.js` |
| Change the goal-stopping rule | `stopAtGoal` in the defaults, the early return in `remind()`, and `goalSettled()` in `content.js` |
| Change quiet hours | the two selects in `popup.html` (`fillHours()` builds them) and `inQuiet()` in `background.js` |
| Change how much history is kept | `HISTORY` in `popup.js` and the `slice(-30)` in `content.js` — keep both in step |
| Change the reminder wording | `LINES` in `content.js`; keep each line short enough for one line at 240px |
| Change the popup mood lines | `MOODS` in `popup.js` — ten entries, one per tier |
| Add a bear variant | a `<g class="…">` in `bear.svg`, a `.bear[data-bear="…"]` rule in `bear.css`, and the id in `BEARS`/`BEAR_NAMES` plus the `data-bear` whitelist |
| Change the mascot artwork | edit `bear.svg`, then re-render the four icon PNGs |
