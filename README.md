# Bubu's Water Club

A small Chrome extension (Manifest V3) that keeps an animated Bubu bear in the
corner of every page and nudges you to drink water, while tracking the glasses
you actually drink.

The bear is drawn from a single inline SVG, so its eyes follow your cursor, it
blinks, it bobs, and its mood — mouth, blush, sparkle, and the hat or accessory
it wears — is driven by how much of today's goal you have finished. Nothing is
sent anywhere; the reminder is a page bubble, and a local OS notification only
when no page is there to show it.

## What it does

- **Floating bear** on every http/https/file page, drag it anywhere; the spot is
  shared by all tabs. The **×** on it switches Floating Bubu off everywhere.
- **Reminders** at a chosen interval, with optional **quiet hours** (a window may
  wrap past midnight) and **stop after the goal is reached**.
- **Snooze** postpones a single reminder by 10 minutes, shown as a small clock
  badge on the bear while it is pending.
- **Reminders survive the bear being off.** With Floating Bubu disabled the
  reminder still appears as a lone bubble, and it is draggable there too.
- **Reminders reach you with no page open.** A minimised Chrome window, one
  behind another app, or one showing only `chrome://` tabs gets an OS
  notification with *I drank water!* and *Snooze 10 min* instead of a bubble nobody
  would see. The toolbar icon also carries a dot while a reminder is waiting.
- **Toolbar popup** with today's count and progress bar, a seven-day strip with
  a streak, undo, the daily goal stepper, and a settings view behind the gear.
- **Twelve bear variants** (bow, crown, bucket hat, headphones, hearts, scarf and
  more), each animating with progress. Effects tied to finishing the day fire at
  100%, not at 90%.
- **Cross-device sync** through `chrome.storage.sync`: settings by the time they
  were edited, today's count by the action stamp, and the day history by union.

## Install (unpacked)

1. Clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. **Load unpacked** and pick the repository root — the folder holding
   `manifest.json`.
4. Pin the toolbar button if you want the popup one click away.

To let the bear appear on local HTML files, also enable
**Allow access to file URLs** on the extension's details page.

After changing any file, press the reload button on `chrome://extensions`; a
reloaded extension does **not** re-inject into tabs that are already open, so
refresh those pages as well.

## Packaging

`git archive -o dist.zip HEAD` builds the store upload from the committed tree.
`.gitattributes` marks the documentation and the repository's own files as
`export-ignore`, so the archive is the extension alone — roughly 35 KB smaller
than a zip of the folder. Loading the archive unpacked works the same way, since
`manifest.json` sits at its root.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | Manifest V3 declaration: permissions, content scripts, popup |
| `background.js` | Service worker: alarms, quiet hours, snooze, OS-notification fallback, badge dot, sync mirror |
| `content.js` | The widget: closed shadow root, bubbles, drag, per-page state |
| `preload.js` | `document_start` helper that publishes the lazy asset loader |
| `lines.js` | The reminder sentences and `bubuLine()`, shared by the page bubble and the OS notification |
| `bear.css` | Rules and keyframes for the bear and its variants |
| `bear.svg` | One drawing, many looks — variants are extra groups switched by `data-bear` |
| `popup.html`, `popup.js`, `style.css` | Toolbar popup: tracker view, week strip, settings |
| `icon*.png` | Toolbar icons at 16/32/48/128 |
| `ARCHITECTURE.md` | How the contexts fit together, the data model and the sync rules |

`ARCHITECTURE.md` is the place to start if you want to change behaviour; it
documents the storage schema, the message bus, the tier system that drives the
animations, and the non-obvious constraints behind each piece.

## Privacy

Everything is stored in `chrome.storage.local` and stays on the machine. The
extension makes no network requests of its own: there is no telemetry and no
analytics. Only account-wide settings, today's count and the day history are
mirrored into `chrome.storage.sync`, which is Chrome's own sync supplied by the
browser — the data goes to the signed-in Chrome profile, not to a third party.

Permissions requested are `alarms` (the reminder timer), `storage` (state and
sync), `tabs` (finding a page that can show a reminder) and `notifications` (the
OS fallback when no page can).

## Licence

See [LICENSE](LICENSE).
