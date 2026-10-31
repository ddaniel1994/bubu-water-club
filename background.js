const DEFAULTS={interval:45,enabled:true,glasses:0,goal:8,lastDay:'',floating:true,quiet:false,quietFrom:22,quietTo:7,stopAtGoal:false,syncAt:0,syncMeta:{},snoozeUntil:0};
// Quiet hours are checked when a reminder would fire, not when the alarm is scheduled, so the repeating
// timer keeps its cadence and simply goes quiet inside the window. A window that wraps midnight
// (22 → 7) is the normal case; identical hours mean no window at all rather than 24h of silence.
const inQuiet=(s,now=new Date())=>{if(!s.quiet)return false;const f=Number(s.quietFrom),t=Number(s.quietTo),h=now.getHours();if(!Number.isFinite(f)||!Number.isFinite(t)||f===t)return false;return f<t?h>=f&&h<t:h>=f||h<t;};
const SNOOZE=30; // seconds the bubble's "Snooze 30s" postpones a single reminder — keep in step with the button label
// 30s is the floor of Chrome's alarm granularity, so the snooze is armed with `when` (an absolute stamp)
// instead of `delayInMinutes`: the delay the button promises is the delay that actually runs.
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
// The toolbar carries no number: the icon stays exactly the bear, so nothing covers the art at 16px.
// The only count in the toolbar is the hover tooltip, rebuilt from storage each time so it cannot show
// yesterday's glasses after a rollover that happened while no popup was open. `setBadgeText('')` is kept
// so a badge left behind by an older build is cleared once.
async function badge(){const s=await chrome.storage.local.get(DEFAULTS);const n=s.lastDay===today()?Number(s.glasses)||0:0,g=Math.max(1,Number(s.goal)||8);
  try{await chrome.action.setBadgeText({text:''});}catch{}
  const title=`Bubu's Water Club — ${n} of ${g} glasses today`;try{await chrome.action.setTitle({title});}catch{}}
async function schedule(){const s=await chrome.storage.local.get(DEFAULTS);await chrome.alarms.clear('water');if(!s.enabled){await chrome.alarms.clear('snooze');if(s.snoozeUntil)await chrome.storage.local.set({snoozeUntil:0});}if(s.enabled)chrome.alarms.create('water',{delayInMinutes:s.interval,periodInMinutes:s.interval});}
// One broadcast for both alarm kinds: the repeating `water` timer and a one-shot `snooze`, so a
// snoozed reminder appears exactly like a normal one. `at` is stamped once per broadcast and travels to
// every tab: the widget derives its caption from it, so all the open reminders read the same line.
async function remind(){await badge();const s=await chrome.storage.local.get(DEFAULTS);if(!s.enabled||inQuiet(s)||(s.stopAtGoal&&Number(s.glasses)>=Number(s.goal)))return;const at=Date.now();const tabs=await chrome.tabs.query({});await Promise.all(tabs.filter(t=>/^(https?|file):/.test(t.url||'')).map(t=>chrome.tabs.sendMessage(t.id,{type:'DUDU_REMIND',at}).catch(()=>{})));}
// Pull before seeding, so a fresh install in a signed-in browser adopts the account's settings instead
// of writing the defaults over them. `schedule()` runs after the pull for the same reason: the interval
// may have just changed.
chrome.runtime.onInstalled.addListener(async()=>{await pullSync();const s=await chrome.storage.local.get(null);if(!Object.keys(s).length)await chrome.storage.local.set(DEFAULTS);await schedule();await badge();await pushSync();});
chrome.runtime.onStartup.addListener(async()=>{await pullSync();await schedule();await badge();await pushSync();});
chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(changes.interval||changes.enabled||changes.stopAtGoal)schedule();if(changes.glasses||changes.goal||changes.lastDay)badge();});
// The mirror's own trigger: a local change to a synced key goes up, an incoming sync value comes down.
// Writes from `pullSync` land back here, where `pushSync` finds nothing left to send and stops.
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='sync')pullSync();else if(area==='local'&&(changes.history||changes.glasses||changes.lastDay||SYNCED.some(k=>changes[k])))pushSync();});
// Firing the snooze clears the badge flag before the reminder goes out, so the clock on the bear is never
// still counting down a snooze that has already been delivered (or suppressed by quiet hours / a done day).
chrome.alarms.onAlarm.addListener(a=>{if(a.name!=='water'&&a.name!=='snooze')return;if(a.name==='snooze')chrome.storage.local.set({snoozeUntil:0});remind();});
// A content script has no chrome.alarms, so the bubble's snooze button asks us to arm it. Creating
// the same alarm name again replaces the pending one, so repeated taps cannot stack up reminders.
chrome.runtime.onMessage.addListener((m,_s,reply)=>{
  if(m&&m.type==='DUDU_SNOOZE'){const at=Date.now()+SNOOZE*1000;chrome.alarms.create('snooze',{when:at});chrome.storage.local.set({snoozeUntil:at});reply({ok:true});return false;}
  // A content script's own fetch of a packaged file is made under the PAGE's origin, so a strict page can
  // hand back an empty body — which mounted a headless bear. The worker is an extension context, so it
  // reads the same pair and answers instead.
  if(m&&m.type==='DUDU_ASSETS'){const get=p=>fetch(chrome.runtime.getURL(p)).then(r=>r.ok?r.text():'').catch(()=>'');
    Promise.all([get('bear.css'),get('bear.svg')]).then(([css,svg])=>reply({css,svg})).catch(()=>reply({css:'',svg:''}));return true;}
  return false;});
