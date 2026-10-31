// A classic service worker, so the shared reminder copy can be pulled in directly: the same list and the same
// picker the page bubble uses, which is what keeps the notification and the bubble on one sentence.
importScripts('lines.js');
const DEFAULTS={interval:45,enabled:true,glasses:0,goal:8,lastDay:'',floating:true,quiet:false,quietFrom:22,quietTo:7,stopAtGoal:false,syncAt:0,syncMeta:{},snoozeUntil:0};
// Quiet hours are checked when a reminder would fire, not when the alarm is scheduled, so the repeating
// timer keeps its cadence and simply goes quiet inside the window. A window that wraps midnight
// (22 → 7) is the normal case; identical hours mean no window at all rather than 24h of silence.
const inQuiet=(s,now=new Date())=>{if(!s.quiet)return false;const f=Number(s.quietFrom),t=Number(s.quietTo),h=now.getHours();if(!Number.isFinite(f)||!Number.isFinite(t)||f===t)return false;return f<t?h>=f&&h<t:h>=f||h<t;};
const SNOOZE=600; // seconds the bubble's "Snooze 10 min" postpones a single reminder — keep in step with the button label
// Ten minutes is well clear of Chrome's 30s alarm granularity, so `delayInMinutes` would work; the alarm uses an
// absolute `when` instead because that is also the stamp `snoozeUntil` carries, which is what the clock badge on
// the bear counts down — one number for the wait and the badge.
// ---- Cross-device sync -------------------------------------------------------------------------
// `chrome.storage.local` stays the single source of truth every context reads, so the popup, the widget
// and the reminder logic need no knowledge of sync: this worker mirrors the account-wide keys into
// `chrome.storage.sync` and applies incoming ones back into local. `pos`/`bubble`/`snoozeUntil` stay
// device-local (viewport-relative, or a snooze this device tapped); today's count travels as a register
// ordered by day and stamp — see `syncCount()`.
const SYNCED=['interval','enabled','goal','floating','quiet','quietFrom','quietTo','stopAtGoal','bear'];
const eq=(a,b)=>JSON.stringify(a===undefined?null:a)===JSON.stringify(b===undefined?null:b);
// A day is a count, so two devices that both tracked it merge to whichever saw more. The union is
// commutative and idempotent (max is associative), which is what lets the mirror settle after one
// exchange instead of oscillating between devices.
const mergeHist=(a,b)=>{const m=new Map();for(const d of [...(a||[]),...(b||[])]){if(!d||!d.day)continue;const p=m.get(d.day);if(!p||Number(d.glasses)>Number(p.glasses))m.set(d.day,d);}return [...m.values()].sort((x,y)=>x.day<y.day?-1:1).slice(-30);};
// Today's count crosses devices as a register ordered by (day, stamp) instead of by max: the later date
// wins, and two devices on the same date settle on the stamp of the last action. An *undo* is why — a max
// merge would resurrect the glass it removed. `syncAt` is written by whichever context acted (the popup's
// `save()`, the drink button, both rollovers), never by the mirror, so applying a remote count cannot
// restamp it and bounce back.
const stamp=s=>Number(s&&s.syncAt)||0;
const newerDay=(l,r)=>{const ld=l.lastDay||'',rd=r.lastDay||'';
  if(!rd)return 'local';if(!ld)return 'remote';
  if(rd>ld)return 'remote';if(ld>rd)return 'local';
  return stamp(r)>stamp(l)?'remote':'local';};
// Taking a newer day from another device is a rollover: the day being left behind is archived, exactly as
// rollover() does on its own, so a device that was shut for two days gains them instead of losing them.
async function adoptDay(r){
  const local=await chrome.storage.local.get(null);
  if(eq(local.glasses,r.glasses)&&eq(local.lastDay,r.lastDay)&&stamp(local)===stamp(r))return;
  const patch={glasses:Number(r.glasses)||0,lastDay:r.lastDay||'',syncAt:stamp(r)};
  if(local.lastDay&&r.lastDay&&local.lastDay<r.lastDay&&Number(local.glasses)>0){
    const hist=mergeHist(local.history,[{day:local.lastDay,glasses:Number(local.glasses)||0,goal:Number(local.goal)||1}]);
    if(!eq(hist,local.history))patch.history=hist;
  }
  await chrome.storage.local.set(patch).catch(()=>{});
}
// Whichever side is newer is written to the other, so a drink on the desktop and an undo on the laptop both
// land. A day ahead of this device's own clock is not adopted — two timezones would otherwise roll each
// other over in a loop; each keeps its own date and they reconcile when the dates meet.
async function syncCount(local,remote){
  if(newerDay(local,remote)==='remote')return remote.lastDay>today()?undefined:adoptDay(remote);
  if(!local.lastDay)return;
  if(eq(local.glasses,remote.glasses)&&eq(local.lastDay,remote.lastDay)&&stamp(local)<=stamp(remote))return;
  return chrome.storage.sync.set({glasses:local.glasses,lastDay:local.lastDay,syncAt:stamp(local)}).catch(()=>{});
}
// Per-setting edit stamps. A setting is ordered by *when the user changed it*, not by when the change
// reached the account, so two machines that both flip a switch end up on the one touched last. The map
// merges by max, which is monotonic and therefore cannot oscillate.
const metaOf=(s,k)=>Number((s&&s.syncMeta&&s.syncMeta[k])||0);
const mergeMeta=(a,b)=>{const m={...(a||{})};for(const k in (b||{}))if(Number(b[k])>Number(m[k]||0))m[k]=b[k];return m;};
// `null` means there is no ordering information — the caller's direction breaks the tie, which keeps the
// old last-arrival rule for values written before stamps existed.
const newerSetting=(l,r,k)=>{const a=metaOf(l,k),b=metaOf(r,k);return a===b?null:(a>b?'local':'remote');};
// One reconcile pass, used by both triggers: `dir` only decides ties. Settings, their stamps, the count and
// history all settle in the same read, so a device never needs a second round trip to catch up.
async function syncNow(dir){
  const [local,remote]=await Promise.all([chrome.storage.local.get(null),chrome.storage.sync.get(null).catch(()=>null)]);
  if(!remote)return;
  const up={},down={};
  for(const k of SYNCED){
    const hasL=k in local,hasR=k in remote;
    if(!hasL&&!hasR)continue;
    if(hasL&&hasR&&eq(local[k],remote[k]))continue;
    const win=hasL&&hasR?(newerSetting(local,remote,k)||dir):(hasL?'local':'remote');
    if(win==='local')up[k]=local[k];else down[k]=remote[k];
  }
  const meta=mergeMeta(local.syncMeta,remote.syncMeta);
  if(!eq(meta,remote.syncMeta))up.syncMeta=meta;
  if(!eq(meta,local.syncMeta))down.syncMeta=meta;
  const hist=mergeHist(remote.history,local.history);
  if(!eq(hist,remote.history))up.history=hist;
  if(!eq(hist,local.history))down.history=hist;
  if(Object.keys(up).length)await chrome.storage.sync.set(up).catch(e=>console.warn('[Bubu] sync write failed',e));
  if(Object.keys(down).length)await chrome.storage.local.set(down).catch(()=>{});
  await syncCount(local,remote);
}
// `set` only fires `onChanged` where a value actually changed, so a device's own echo is a no-op and
// neither pass can loop on itself.
async function pushSync(){return syncNow('push');}
async function pullSync(){return syncNow('pull');}
const today=()=>new Date().toLocaleDateString('en-CA');
// The toolbar carries no number: the icon stays exactly the bear, so nothing covers the art at 16px. It does
// carry a single dot while a reminder is waiting, which is the only surface that exists on `chrome://` pages
// and the new-tab page. The count lives in the hover tooltip, rebuilt from storage each time so it cannot
// show yesterday's glasses after a rollover that happened while no popup was open.
async function badge(){const s=await chrome.storage.local.get(DEFAULTS);const n=s.lastDay===today()?Number(s.glasses)||0:0,g=Math.max(1,Number(s.goal)||8);
  // `noted` is a reminder the OS carried: no page is drawing it, but it is just as unanswered — and on a
  // `chrome://` page the dot is the only thing left to see, which is exactly when it matters.
  const pending=!!(s.bubble&&(s.bubble.open||s.bubble.noted))&&!!s.enabled&&!(s.stopAtGoal&&n>=g);
  try{await chrome.action.setBadgeText({text:pending?'•':''});}catch{}
  try{await chrome.action.setBadgeBackgroundColor({color:'#a85737'});}catch{}
  const title=pending?`Water time! — ${n} of ${g} glasses today`:`Bubu's Water Club — ${n} of ${g} glasses today`;
  try{await chrome.action.setTitle({title});}catch{}}
async function schedule(){const s=await chrome.storage.local.get(DEFAULTS);await chrome.alarms.clear('water');if(!s.enabled){await chrome.alarms.clear('snooze');if(s.snoozeUntil)await chrome.storage.local.set({snoozeUntil:0});}if(s.enabled)chrome.alarms.create('water',{delayInMinutes:s.interval,periodInMinutes:s.interval});}
// A reminder goes to one surface, so the choice has to be made before anything is sent: a broadcast opens the
// bubble in every tab, and that is exactly what must not happen when the OS is going to draw the toast
// instead. "A tab exists" is the wrong test — a bubble in a background tab or in a window behind another app
// is as unseen as no tab at all — so the test is "a tab a person is looking at".
async function visiblePage(){
  try{
    const w=await chrome.windows.getLastFocused({populate:true});
    if(!w||w.focused===false||w.state==='minimized')return false;
    const t=(w.tabs||[]).find(x=>x.active);
    if(!t||!/^(https?|file):/.test(t.url||''))return false;
    // The window flags are only a proxy: they say Chrome exists with this tab active, not that anyone is
    // looking at it. The user may be working in another application with Chrome behind it, and then the
    // bubble is drawn where nobody can see it. So the page is asked itself — `hasFocus()` is false in exactly
    // that case. A tab that cannot answer has no content script to draw a bubble in (a page kept from before
    // the extension was reloaded, or a `file://` tab without file-URL access), so it counts as unseen too,
    // which is what turns a silently lost reminder into a notification.
    return (await chrome.tabs.sendMessage(t.id,{type:'DUDU_PROBE'}).catch(()=>null))===true;
  }catch{return false}
}
const NOTE='bubu-water';
// `clear` rejects when there is nothing to clear on some platforms, so the promise is swallowed too.
const clearNote=()=>{try{const p=chrome.notifications.clear(NOTE);if(p&&p.catch)p.catch(()=>{});}catch{}};
// The dot also stands for a reminder the OS carried (`bubble.noted`), and a glass drunk anywhere — the popup, a
// page bubble, the toast itself — answers it. Clearing it in one place keeps every route out of a reminder
// honest, including the popup's, which never touches `bubble` at all.
const clearNoted=()=>{chrome.storage.local.get({bubble:{}}).then(({bubble:b})=>{
  if(b&&b.noted)return chrome.storage.local.set({bubble:{...b,open:false,noted:false,at:Date.now()}});
}).catch(()=>{});};
// The same heading, the same caption and the same SNOOZE length as the bubble it stands in for, so the reminder
// reads the same whichever surface delivers it. `line` is the sentence the pages would have drawn for this very
// round — see `remind()`. The OS draws it, so the bear's mood does not carry over, and `requireInteraction`
// keeps it on screen until it is answered, which is what the bubble does.
async function notify(line){
  const s=await chrome.storage.local.get(DEFAULTS);
  const n=s.lastDay===today()?Number(s.glasses)||0:0,g=Math.max(1,Number(s.goal)||8);
  try{
    await chrome.notifications.create(NOTE,{type:'basic',iconUrl:'icon.png',title:'Water time!',
      message:`${line?line+' — ':''}${n} of ${g} glasses today`,
      priority:2,requireInteraction:true,buttons:[{title:'I drank water!'},{title:`Snooze ${SNOOZE/60} min`}]});
  }catch(e){console.warn('[Bubu] notification failed',e)}
}
// A glass drunk from the notification has no page to run the rollover, so it happens here: the day being left
// behind is archived exactly as `popup.js` and `content.js` archive it, and `bubble` is closed so a reminder
// left on screen in some other tab cannot outlive the answer.
async function drinkFromNote(){
  const s=await chrome.storage.local.get(DEFAULTS),d=today(),fresh=s.lastDay===d;
  const patch={glasses:(fresh?Number(s.glasses)||0:0)+1,lastDay:d,syncAt:Date.now(),bubble:{...(s.bubble||{}),open:false,noted:false,at:Date.now()}};
  if(s.lastDay&&!fresh)patch.history=mergeHist(s.history,[{day:s.lastDay,glasses:Number(s.glasses)||0,goal:Number(s.goal)||1}]);
  await chrome.storage.local.set(patch).catch(()=>{});
}
// Snoozing closes the reminder on every surface, not only the one that was tapped. From the OS notification
// there is no page to hide, but the same round may have drawn a bubble in a background tab — the broadcast
// reaches every tab — and leaving that up for the whole snooze would contradict it. The bubble's own button
// runs the other way round: it hides first and then sends `DUDU_SNOOZE`, which arrives here as
// `closeBubble:false` because there is nothing left for this side to close.
async function armSnooze(closeBubble=true){
  const at=Date.now()+SNOOZE*1000;
  chrome.alarms.create('snooze',{when:at});
  const patch={snoozeUntil:at};
  // `false` only when the caller is the bubble, which hid itself before sending: closing it again would land a
  // second `bubble` write with a newer stamp, and the tab that is mid-fade would drop the reminder instantly
  // instead of finishing its 180ms fade.
  if(closeBubble){
    const s=await chrome.storage.local.get({bubble:{open:false,at:0}}).catch(()=>({}));
    const b=s&&s.bubble;
    // `noted` counts as open here: a reminder the OS carried has no bubble to close, but the dot it raised is
    // the same unanswered reminder, and a snooze answers it.
    if(b&&(b.open||b.noted))patch.bubble={...b,open:false,noted:false,at:Date.now()};
  }
  await chrome.storage.local.set(patch).catch(()=>{});
}
// Two surfaces, one decision, and only one of them is used. The bubble is preferred because it is the bear; the
// OS notification covers what a page cannot — no `http` tab at all, only `chrome://` or the new-tab page, or a
// Chrome window that is minimised or behind another app.
// One broadcast for both alarm kinds: the repeating `water` timer and a one-shot `snooze`, so a
// snoozed reminder appears exactly like a normal one. `at` is stamped once per broadcast and travels to
// every tab: the widget derives its caption from it, so all the open reminders read the same line.
async function remind(){
  await badge();
  const s=await chrome.storage.local.get(DEFAULTS);
  if(!s.enabled||inQuiet(s)||(s.stopAtGoal&&Number(s.glasses)>=Number(s.goal)))return;
  const at=Date.now();
  // Chosen here, from the state the pages are about to read: same stamp, same previous line, same index, so the
  // notification carries the sentence the bubble would have shown. It has to be picked *before* the broadcast,
  // because the broadcast is what overwrites `bubble.line` with the new one.
  const lines=globalThis.BUBU_LINES||[],pick=globalThis.bubuLine;
  const prev=Number.isInteger(s.bubble&&s.bubble.line)?s.bubble.line:-1;
  const idx=pick&&lines.length?pick(at,prev,lines.length):-1;
  const line=idx>=0?lines[idx]||'':'';
  // One surface, never both. The broadcast opens the bubble in every tab (`bubble.open`), so when no page is in
  // sight it is skipped entirely and the alarm is spent on the notification: a toast the user answers with its
  // own buttons must not also leave a bubble waiting behind it, asking the same question again when they come
  // back to a page.
  if(!(await visiblePage())){
    // The OS owns this round, so no page may raise a bubble for it — and `open:false` also retires a bubble from
    // an earlier round the user never answered, which would otherwise be waiting on the next page they open.
    // `noted` keeps the toolbar dot honest without pretending a page is showing it, and `line` is recorded so
    // the next round skips the sentence this one just used: with nothing written, `prev` never moved and two
    // notifications in a row could repeat the same caption.
    // This write has to land *before* `notify()`: the listener clears the OS copy on any `open:false`, and once
    // the toast exists that race would delete the notification it just raised.
    await chrome.storage.local.set({bubble:{open:false,at,line:idx,noted:true}}).catch(()=>{});
    await notify(line);
    return;
  }
  const tabs=await chrome.tabs.query({});
  await Promise.all(tabs.filter(t=>/^(https?|file):/.test(t.url||'')).map(t=>chrome.tabs.sendMessage(t.id,{type:'DUDU_REMIND',at}).catch(()=>{})));
}
// Chrome injects the declarative content scripts only into documents loaded after the install, so every tab
// that was already open when the extension arrived would sit there with no bear until it was reloaded. This
// reaches them: the same three files, in the same order, into the same isolated world, where content.js's
// `window.__duduWaterLoaded` guard turns the second copy into a no-op — an install over a page that already
// has the widget is harmless. A tab that closes mid-loop, or a `file://` page without file-URL access, refuses
// the call; that is "this page gets no bear", never a reason to stop reaching the others.
async function injectOpenTabs(){
  if(!chrome.scripting)return;
  const tabs=await chrome.tabs.query({}).catch(()=>[]);
  for(const t of tabs){
    if(!/^(https?|file):/.test(t.url||''))continue;
    for(const f of ['preload.js','lines.js','content.js']){
      try{await chrome.scripting.executeScript({target:{tabId:t.id},files:[f]});}catch{break;}
    }
  }
}
// Pull before seeding, so a fresh install in a signed-in browser adopts the account's settings instead
// of writing the defaults over them. `schedule()` runs after the pull for the same reason: the interval
// may have just changed. The open tabs are reached last, once the state they will read is in place.
chrome.runtime.onInstalled.addListener(async()=>{await pullSync();const s=await chrome.storage.local.get(null);if(!Object.keys(s).length)await chrome.storage.local.set(DEFAULTS);await schedule();await badge();await pushSync();await injectOpenTabs();});
chrome.runtime.onStartup.addListener(async()=>{await pullSync();await schedule();await badge();await pushSync();});
chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(changes.interval||changes.enabled||changes.stopAtGoal)schedule();
  if(changes.glasses||changes.goal||changes.lastDay||changes.enabled||changes.bubble)badge();
  // Answered somewhere else — a glass logged in the popup, or the bubble dismissed on a page — so the OS copy
  // must not linger. A reminder *opening* clears nothing (opening is not an answer), and neither does a round
  // handing itself to the OS (`noted`, written just before its toast is created).
  if(changes.bubble&&changes.bubble.newValue&&changes.bubble.newValue.noted)return;
  if(changes.glasses)clearNoted();
  if(changes.glasses||(changes.bubble&&changes.bubble.newValue&&changes.bubble.newValue.open===false))clearNote();});
// The mirror's own trigger: a local change to a synced key goes up, an incoming sync value comes down.
// Writes from `pullSync` land back here, where `pushSync` finds nothing left to send and stops.
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='sync')pullSync();else if(area==='local'&&(changes.history||changes.glasses||changes.lastDay||SYNCED.some(k=>changes[k])))pushSync();});
// Firing the snooze clears the badge flag before the reminder goes out, so the clock on the bear is never
// still counting down a snooze that has already been delivered (or suppressed by quiet hours / a done day).
chrome.alarms.onAlarm.addListener(a=>{if(a.name!=='water'&&a.name!=='snooze')return;if(a.name==='snooze')chrome.storage.local.set({snoozeUntil:0});remind();});
// The notification's two buttons are the bubble's two buttons, reached without a page open.
chrome.notifications.onButtonClicked.addListener((id,i)=>{if(id!==NOTE)return;clearNote();if(i===0)drinkFromNote();else armSnooze();});
// A click on the body has no answer to record, so it only brings the browser forward.
chrome.notifications.onClicked.addListener(id=>{if(id!==NOTE)return;clearNote();
  chrome.windows.getLastFocused().then(w=>{if(w&&w.id!=null)return chrome.windows.update(w.id,{focused:true});}).catch(()=>{});});
// A content script has no chrome.alarms, so the bubble's snooze button asks us to arm it. Creating
// the same alarm name again replaces the pending one, so repeated taps cannot stack up reminders.
chrome.runtime.onMessage.addListener((m,_s,reply)=>{
  if(m&&m.type==='DUDU_SNOOZE'){armSnooze(false);reply({ok:true});return false;}
  // A content script's own fetch of a packaged file is made under the PAGE's origin, so a strict page can
  // hand back an empty body — which mounted a headless bear. The worker is an extension context, so it
  // reads the same pair and answers instead.
  if(m&&m.type==='DUDU_ASSETS'){const get=p=>fetch(chrome.runtime.getURL(p)).then(r=>r.ok?r.text():'').catch(()=>'');
    Promise.all([get('bear.css'),get('bear.svg')]).then(([css,svg])=>reply({css,svg})).catch(()=>reply({css:'',svg:''}));return true;}
  return false;});
