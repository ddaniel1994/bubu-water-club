(() => {
  // A version stamp, not a bare flag: `injectOpenTabs()` re-runs this file into the tabs that were open at
  // install or update time, so a page that already holds an OLDER build has to upgrade rather than be skipped.
  // Bump `V` whenever this file changes shape — a tab keeps the copy it booted with otherwise.
  const V = 3;
  if (window.__duduWaterVersion === V) return;
  window.__duduWaterTeardown?.();
  // The build before this one has no teardown, but its host is still in the page: the id is the one handle a
  // closed shadow root cannot hide. Removing it is enough — the retired copy's listeners only ever touch
  // detached nodes afterwards, and its DOM handlers go with the node.
  if (document.documentElement) document.getElementById('dudu-water-companion')?.remove();
  window.__duduWaterVersion = V;
  window.__duduWaterLoaded = true;
  const defaults = {enabled:true, floating:true, glasses:0, goal:8, lastDay:'', stopAtGoal:false, history:[], pos:{right:22,bottom:24}, bubble:{open:false,at:0}, syncAt:0, syncMeta:{}, snoozeUntil:0, bear:'bubu'};
  let state = {...defaults};
  let host, root, wrap, bubble, count, bearEl, bearBox = null, timer2, timer3, timer4, hidden = false, lastLine = -1, dragging = false, wasDone = false, known = false, onRemind = null, dead = false;
  const day = () => new Date().toLocaleDateString('en-CA');
  const safe = n => Number.isFinite(Number(n)) ? Number(n) : 0;
  // The other half of the version stamp above: a build can be replaced while its page lives on, so this stops
  // its timers, takes its host out of the page and sets `dead`, which every listener and `ensure()` checks.
  // The retired copy then writes no state and cannot mount a second bear next to the new one.
  window.__duduWaterTeardown = () => {dead = true; [timer2, timer3, timer4, timer5].forEach(clearTimeout); if (host) host.remove(); host = null;};
  // The stylesheet and drawing are fetched on demand, never at page load: two extension-resource
  // requests are the expensive half of the widget, and a page that never draws it should not pay for
  // them. preload.js publishes the memoised loader in this same isolated world; the fallback covers a
  // stale bundle that shipped without it.
  const assets = window.__bubuAssets || (window.__bubuAssets = {css: '', svg: ''});
  const loadAssets = window.__bubuLoadAssets || (() => {
    const get = p => fetch(chrome.runtime.getURL(p)).then(r => r.ok ? r.text() : '').catch(() => '');
    return Promise.all([get('bear.css'), get('bear.svg')]).then(([css, svg]) => {
      assets.css = css; assets.svg = svg;
      if (!assets.svg) console.warn('[Bubu] bear.svg could not be loaded — the floating bear will have no artwork.');
      return assets;
    });
  });
  // One position for every tab: it lives in storage and is re-applied on each refresh, so a drag in one
  // tab moves Bubu in all of them. Clamped because a spot saved in a big window can be off-screen later.
  // parseFloat + || would turn a legitimate `0px` back into the default, so gap it with an explicit check.
  const px = (v, d) => Number.isFinite(parseFloat(v)) ? parseFloat(v) : d;
  // A pending snooze is shared state — background writes `snoozeUntil` — so every tab can show the clock
  // badge without owning a timer. One timeout clears it at expiry, re-armed by each refresh, so a new
  // snooze or a cancelled one never leaves a stale badge behind.
  let timer5;
  const snoozeBadge = () => {const left = (state.snoozeUntil || 0) - Date.now(); wrap.classList.toggle('snoozing', left > 0); clearTimeout(timer5); if (left > 0) timer5 = setTimeout(refresh, left + 60);};
  const fit = p => {bearBox = null; if (dragging || !host) return; const r = p && Number.isFinite(p.right) ? p.right : 22, b = p && Number.isFinite(p.bottom) ? p.bottom : 24, w = host.offsetWidth || 152, h = host.offsetHeight || 152;host.style.right=Math.max(0,Math.min(innerWidth-w,r))+'px';host.style.bottom=Math.max(0,Math.min(innerHeight-h,b))+'px';};
  // One caption per reminder, picked at random and never the same twice in a row. The heading above it
  // stays fixed so the reminder is still recognisable at a glance.
  // The sentences and the function that picks one live in `lines.js`, which the worker loads as well: the OS
  // notification has to read the same line as the bubble for the same reminder, so there is one list and one
  // picker rather than two copies that can drift.
  const LINES = globalThis.BUBU_LINES || [];
  async function refresh() {
    state = await chrome.storage.local.get(defaults);
    if (dead) return;
    if (state.floating) hidden = false;   // re-enabled in the popup → come back without a reload
    bearBox = null; fit(state.pos);
    // Rollover archives the day that just ended so the popup's week strip and streak have data even
    // when the popup is never opened — this script is the one context that runs on every page load.
    // Records are keyed by `day`, so rolling over in two contexts replaces rather than duplicates.
    if (state.lastDay !== day()) {
      const done = {day: state.lastDay, glasses: safe(state.glasses), goal: safe(state.goal) || 1};
      const hist = [...(state.history || []).filter(d => d && d.day && d.day !== done.day), ...(state.lastDay ? [done] : [])]
        .sort((a, b) => a.day < b.day ? -1 : 1).slice(-30);
      state.glasses = 0; state.lastDay = day(); state.syncAt = Date.now();
      await chrome.storage.local.set({glasses:0, lastDay:state.lastDay, syncAt:state.syncAt, history:hist});
    }
    const done = state.glasses >= state.goal;
    if (host) {
      host.style.display = (state.floating && !hidden) || bubble.classList.contains('show') ? 'block' : 'none';
      // With Floating Bubu off the reminder still lands, drawn as the bubble alone: the bear and its count
      // chip are hidden, and the bubble itself becomes the drag handle so the reminder can still be moved.
      wrap.classList.toggle('lone', !state.floating);
      count.textContent = `${state.glasses}/${state.goal} glasses${done ? ' ✓' : ''}`;
      const tier = Math.min(9, Math.floor(Math.min(100, 100 * state.glasses / state.goal) / 10));
      bearEl.dataset.tier = tier;
      // `done` keys off the day actually being complete, not tier 9 (which starts at 90%). The headband's
      // sheen, the sparkle twinkle and the .bear.done[data-tier] variables all read it.
      bearEl.classList.toggle('done', done);
      bearEl.dataset.bear = ['bubu','angry','bow','buckethat','coffee','coolers','crown','headband','headphones','hearts','scarf','specs'].includes(state.bear) ? state.bear : 'bubu';
      wrap.classList.toggle('done', done);
      snoozeBadge();
      // Reaching the goal with `stopAtGoal` on retires the bubble too, not just future reminders: a
      // reminder that was already on screen must not sit there once the day is done.
      if (done && state.stopAtGoal && bubble.classList.contains('show')) { bubble.classList.remove('show'); if (!state.floating) host.style.display = 'none'; }
      // Cheer only on the crossing, not on every refresh or page load.
      if (known && done && !wasDone) { wrap.classList.add('cheer'); clearTimeout(timer2); timer2 = setTimeout(() => wrap.classList.remove('cheer'), 1500);      }
    }
    wasDone = done; known = true;
  }
  function mount() {
    if (host || dead || !document.documentElement) return;
    host = document.createElement('div'); host.id='dudu-water-companion';
    host.style.cssText='position:fixed;right:22px;bottom:24px;z-index:2147483647;display:none;touch-action:none;';
    root=host.attachShadow({mode:'closed'});
    // The wrap carries a static gradient-ellipse shadow instead of a drop-shadow filter: a filter over the
    // continuously animated SVG is re-blurred every frame, so the ellipse is cheaper and reads the same.
    root.innerHTML=`<style>${assets.css}
      
      .wrap{position:relative;width:152px;font-family:system-ui,sans-serif;color:#3b3330;user-select:none;isolation:isolate}
      .wrap::after{content:'';position:absolute;left:17px;right:17px;bottom:19px;height:12px;border-radius:50%;background:radial-gradient(ellipse at center,#55351d33,#55351d00 72%);pointer-events:none;z-index:-1}
      .wrap.lone{width:240px}.wrap.lone::after{display:none}.wrap.lone .bear,.wrap.lone .count{display:none}.wrap.lone .bubble{position:static;width:100%;margin:0;cursor:grab;touch-action:none}.wrap.lone .bubble:active{cursor:grabbing}
      .bear{position:relative;width:117.5px;height:auto;margin:0 auto;cursor:grab;animation:bob 3s ease-in-out infinite;transform:rotate(var(--tilt,0deg))}
      .bear:active{cursor:grabbing}
      
      
            .blink{animation:blinkLoop 16s ease-in-out .9s infinite}
      .drink .bear{animation:gulp .8s ease-in-out}
      .bubble{position:absolute;right:134px;bottom:66px;width:240px;background:#fff9f0;border:2px solid #d9ac8a;border-radius:17px;padding:12px;box-shadow:0 5px 15px #53311a22;text-align:center;display:none;touch-action:auto}
      .bubble.show{display:block;animation:pop .25s ease-out}.bubble.out{animation:fadeOut .18s ease-out forwards}.bubble strong{display:block;font-size:16px;line-height:1.3}.bubble small{display:block;font-size:13px;line-height:1.35;margin:6px 0;color:#946b51}
      button{border:0;cursor:pointer;font:600 11px system-ui;border-radius:10px;padding:6px 10px}.row{display:flex;gap:6px;margin-top:2px;flex-wrap:wrap}.row button{padding:6px 8px;white-space:nowrap}.drink-btn{background:#7cb9e6;color:#173f5c;flex:1 1 auto;min-width:0}.dismiss{background:transparent;color:#806653;flex:0 0 auto;display:inline-flex;align-items:center;gap:4px}.dismiss .ico{width:12px;height:12px;flex:0 0 auto}.hide{position:absolute;right:-9px;top:-13px;background:#fff6ed;color:#87634c;border:1px solid #e7c6ae;border-radius:50%;width:23px;height:23px;padding:0;line-height:21px;font-size:15px;touch-action:auto}
      .count{font-size:10px;text-align:center;background:#fff8ed;border:1px solid #e6c6a9;border-radius:12px;padding:3px;margin:0 auto;width:118px;touch-action:auto}
      .spark{position:absolute;font-size:14px;color:#e0a33e;opacity:var(--spark,0);line-height:1;pointer-events:none;transition:opacity .3s}.spark.s2{right:-4px;top:18px;font-size:10px}
      .zzz{position:absolute;right:2px;top:0;font-size:13px;color:#a37a6d;opacity:var(--zzz,0);line-height:1;pointer-events:none;transition:opacity .3s}
      .snz{position:absolute;left:-2px;bottom:4%;width:18px;height:18px;display:none;background:#fff9f0;border:1.5px solid #d9ac8a;border-radius:50%;padding:2px;box-shadow:0 1px 3px #53311a22;color:#a37a6d}.snz svg{display:block;width:100%;height:100%}.snoozing .snz{display:block;animation:ticks 2s ease-in-out infinite}@keyframes ticks{50%{transform:scale(1.08)}}
      
      .done .count{background:#e9f1e5;border-color:#a9c9a3;color:#3f6b3a;font-weight:700}
      .cheer .bear{animation:cheer .45s ease-in-out 3}
      @keyframes bob{50%{transform:rotate(var(--tilt,0deg)) translateY(-6px)}}@keyframes gulp{0%,100%{transform:rotate(var(--tilt,0deg)) translateY(0) scale(1)}30%{transform:rotate(var(--tilt,0deg)) translateY(2px) scale(.985)}65%{transform:rotate(var(--tilt,0deg)) translateY(-1px) scale(1)}}@keyframes pop{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}@keyframes cheer{25%{transform:translateY(-9px) rotate(-7deg)}75%{transform:translateY(-4px) rotate(7deg)}}@keyframes fadeOut{to{opacity:0;transform:scale(.96)}}
      @media(prefers-reduced-motion:reduce){.bear,.blink,.cheer .bear,.bubble.show,.bubble.out,.spark,.snoozing .snz,.straw,.sip,.sheen,.band,.tail{animation:none!important}.bear[data-bear="hearts"] .hearts,.bear[data-bear="hearts"] .hearts path{animation:none!important}.bear.done .spark,.bear[data-bear="crown"] .crown,.bear[data-bear="bow"] .bow,.bear[data-bear="buckethat"] .buckethat{animation:none!important}.eye,.mouth,.coffee,.sheen{transition:none!important}}
    </style><div class="wrap"><div class="bubble" role="status" aria-live="polite"><strong>Water time!</strong><small>Bubu, thanni kudichiya?</small><div class="row"><button class="drink-btn">I drank water!</button><button class="dismiss"><svg class="ico" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8.6" r="5.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 5.6V8.6L10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.4 2.7L2.3 3.8M12.6 2.7L13.7 3.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>Snooze 10 min</button></div></div><div class="bear" aria-hidden="true"><span class="zzz" aria-hidden="true"></span><span class="snz" aria-hidden="true"><svg viewBox="0 0 16 16"><circle cx="8" cy="8.6" r="5.6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 5.4V8.6L10.1 10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="spark s1" aria-hidden="true">✦</span><span class="spark s2" aria-hidden="true">✦</span>${assets.svg}</div><button class="hide">×</button><div class="count"></div></div>`;
    document.documentElement.appendChild(host);
    wrap=root.querySelector('.wrap');bubble=root.querySelector('.bubble');count=root.querySelector('.count');
    const lineEl=root.querySelector('.bubble small');
    // One caption per reminder, derived from the reminder's shared stamp rather than rolled per tab: every open
    // tab feeds the same number into `bubuLine()` (lines.js), so the bubbles read identically with no extra
    // storage round-trip, and the worker calls the same function with the same stamp and previous line to
    // caption the OS notification. The previous line — read from storage, so tabs agree on it — is skipped so
    // none repeats back to back, and the re-roll inside the remaining n-1 keeps the choice flat.
    const say=stamp=>{const n=LINES.length;if(!n||!globalThis.bubuLine)return;
      const i=bubuLine(stamp,Number.isInteger(state.bubble&&state.bubble.line)?state.bubble.line:lastLine,n);
      lastLine=i;lineEl.textContent=LINES[i];};
    // The bubble is shared like the bear's position: opening or closing the reminder in one tab does the
    // same in every tab, so it can never be up in one and missing in another. `at` is the write stamp —
    // a tab ignores the change it wrote itself.
    let bubbleAt = 0;
    // A finished day silences the reminder everywhere: with `stopAtGoal` on there is nothing left to say.
    const goalSettled=()=>!!state.stopAtGoal&&safe(state.glasses)>=safe(state.goal);
    // `floating` is deliberately absent: a reminder may raise the bubble on its own when the bear is off —
    // otherwise "Gentle reminders on, Floating Bubu off" would fire alarms nobody can see. `hidden` (the ×)
    // still silences everything.
    const canShow=()=>!goalSettled()&&state.enabled&&!hidden;
    // `at` is the reminder's own stamp when there is one, so every tab writes byte-identical bubble state
    // and each tab's own echo is ignored; closing has no stamp and takes the local clock. `state` is kept
    // in step here and in the listener below: the next caption skips `state.bubble.line`, so a tab that
    // refreshed at a different moment must never hold a stale previous line.
    const saveBubble=(open,stamp)=>{bubbleAt=Number(stamp)||Date.now();state.bubble={open,at:bubbleAt,line:lastLine};chrome.storage.local.set({bubble:state.bubble});};
    // The reminder never auto-dismisses: it stays until the user drinks, taps Snooze, or closes the bear.
    // The close is written to storage at once, so every other tab drops the bubble immediately; `soft`
    // only holds this tab's DOM for the 180ms the fadeOut needs. Re-showing clears both the class and
    // the pending timer, so a reminder arriving mid-fade is not swallowed by a stale timeout.
    const unout=()=>{clearTimeout(timer4);bubble.classList.remove('out');};
    const hide=soft=>{if(soft&&bubble.classList.contains('show')){unout();bubble.classList.add('out');clearTimeout(timer4);timer4=setTimeout(()=>{bubble.classList.remove('show','out');if(!state.floating)host.style.display='none';},180);}
      else{bubble.classList.remove('show');if(!state.floating)host.style.display='none';}
      saveBubble(false);};
    const applyBubble=b=>{if(!b||!b.open||!b.at||b.at===bubbleAt||dragging||!canShow())return;bubbleAt=b.at;if(Number.isInteger(b.line)&&LINES[b.line]){lastLine=b.line;lineEl.textContent=LINES[lastLine];}unout();if(!state.floating)host.style.display='block';bubble.classList.add('show');place();};
    chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local'||!changes.bubble||dead)return;const b=changes.bubble.newValue||{};state.bubble=b;if(b.at===bubbleAt)return;
      if(b.open)applyBubble(b);else{bubbleAt=b.at||0;bubble.classList.remove('show');if(!state.floating)host.style.display='none';}});
    const bear=root.querySelector('.bear');bearEl=bear;
    // Eyes track the cursor anywhere on the page (same mapping as the popup) and hold that look until
    // the pointer leaves, so a blink never pulls them back to centre. The bear's box is cached and a burst
    // of moves is coalesced into one animation frame: a getBoundingClientRect per pointermove forces layout
    // ~60x/s on every page the floater sits on, for a target that only moves on drag, resize or `pos`.
    let aim=null, raf=0;
    const look=(x,y)=>{bear.style.setProperty('--look',Math.max(-14,Math.min(14,x/40)).toFixed(2)+'px');bear.style.setProperty('--lookY',Math.max(-6,Math.min(6,y/70)).toFixed(2)+'px');};
    const aimAt=()=>{raf=0;if(!aim)return;const x=aim.x,y=aim.y;aim=null;if(!bearBox)bearBox=bear.getBoundingClientRect();look(x-(bearBox.left+bearBox.width/2),y-(bearBox.top+bearBox.height/2));};
    addEventListener('pointermove',e=>{aim={x:e.clientX,y:e.clientY};if(!raf)raf=requestAnimationFrame(aimAt);},{passive:true});
    document.documentElement.addEventListener('pointerleave',()=>{aim=null;if(raf)cancelAnimationFrame(raf);raf=0;look(0,0);});
    // Lone mode lays the bubble out in normal flow (no bear to sit beside), so there is nothing to clamp.
    const place=()=>{bubble.style.left='';bubble.style.right='';bubble.style.width='';if(wrap.classList.contains('lone'))return;const m=8,i=wrap.getBoundingClientRect().left;if(!bubble.offsetWidth)return;let w=bubble.offsetWidth;if(innerWidth-2*m<w){w=Math.max(80,innerWidth-2*m);bubble.style.width=w+'px';}const ideal=i+bubble.offsetLeft,left=Math.min(innerWidth-m-w,Math.max(m,ideal));if(left!==ideal){bubble.style.left=(left-i)+'px';bubble.style.right='auto';}};
    // A shrunk window would otherwise leave the bear — and any open bubble — outside the viewport until
    // the next storage change, so re-fit from the inline position and re-place the bubble on resize.
    addEventListener('resize',()=>{bearBox=null;fit({right:px(host.style.right,22),bottom:px(host.style.bottom,24)});if(bubble.classList.contains('show'))place();});
    const show=stamp=>{if(!canShow())return;say(stamp);unout();host.style.display='block';bubble.classList.add('show');place();wrap.classList.remove('drink');saveBubble(true,stamp)};
    root.querySelector('.drink-btn').onclick=async()=>{await refresh();await chrome.storage.local.set({glasses:safe(state.glasses)+1,lastDay:day(),syncAt:Date.now()});wrap.classList.remove('drink');void wrap.offsetWidth;wrap.classList.add('drink');clearTimeout(timer3);timer3=setTimeout(()=>wrap.classList.remove('drink'),820);hide();};
    // Snooze dismisses and re-arms: a content script has no chrome.alarms, so the service
    // worker arms a one-shot `snooze` alarm that re-broadcasts DUDU_REMIND after 10 minutes.
    root.querySelector('.dismiss').onclick=()=>{hide(true);chrome.runtime.sendMessage({type:'DUDU_SNOOZE'}).catch(()=>{});};
    // × is the global off switch for the bear: it hides instantly, then turns the Floating Bubu
    // setting off so he stays gone on every page (and the popup's toggle follows).
    // The × edits a synced setting, so it records its own edit stamp: the account keeps whichever machine
    // flipped Floating Bubu last, even if that change reaches sync by a slower route.
    root.querySelector('.hide').onclick=()=>{hidden=true;hide();host.style.display='none';const meta={...(state.syncMeta||{}),floating:Date.now()};state.syncMeta=meta;chrome.storage.local.set({floating:false,syncMeta:meta});};
    // One drag implementation, two grips: the bear while it is on screen, and the bubble itself in lone mode,
    // where the bear that used to be the handle is hidden. Buttons never start a drag, so a tap on Drink or
    // Snooze cannot be swallowed; the clamp measures the host, so the 240px lone bubble stops at the viewport
    // edge instead of at the bear's box. `loneOnly` keeps the bubble inert as a grip when the bear is there.
    let start=null,moved=false;
    const savePos=()=>chrome.storage.local.set({pos:{right:px(host.style.right,22),bottom:px(host.style.bottom,24)}});
    const grip=(el,skip,loneOnly)=>{
      el.addEventListener('pointerdown',e=>{
        if(loneOnly&&!wrap.classList.contains('lone'))return;
        if(skip&&e.target.closest(skip))return;
        start={x:e.clientX,y:e.clientY,right:px(host.style.right,22),bottom:px(host.style.bottom,24)};dragging=true;moved=false;
        try{el.setPointerCapture(e.pointerId)}catch{}});
      el.addEventListener('pointermove',e=>{
        if(!start)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;if(Math.abs(dx)+Math.abs(dy)>6)moved=true;
        if(!moved)return;
        bearBox=null;
        const w=(host.offsetWidth||152)-6,h=(host.offsetHeight||152)-6;
        host.style.right=Math.max(0,Math.min(Math.max(0,innerWidth-w),start.right-dx))+'px';
        host.style.bottom=Math.max(0,Math.min(Math.max(0,innerHeight-h),start.bottom-dy))+'px';
        if(bubble.classList.contains('show')&&!wrap.classList.contains('lone'))place();});
      const end=()=>{if(!start)return;start=null;dragging=false;if(moved)savePos();};
      el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
    };
    grip(bear);grip(bubble,'button',true);
    // A reminder is handled by the page-level listener, which mounts the widget first if this tab never
    // drew one; this is the show step it calls once the markup exists. `refresh()` has already run, so a
    // message cannot outrun a settings change or a stale day.
    onRemind=stamp=>{if(state.enabled&&!hidden&&!goalSettled())show(stamp);};
    refresh().then(()=>applyBubble(state.bubble));
  }
  // Mounting is on demand. With Floating Bubu off, a page pays for one storage read (which still rolls the
  // day over) and two listeners — no shadow root, no asset fetch, no animation tree. Enabling the bear
  // again, or a reminder arriving, draws it then.
  const ensure = () => dead ? Promise.resolve() : host ? refresh() : loadAssets().then(() => { mount(); return refresh(); });
  // A reminder that is still on screen belongs on every page, including one opened after the broadcast went
  // out: that page never receives a DUDU_REMIND, so the pending record is what asks for the host. A done
  // day with `stopAtGoal`, or reminders switched off, asks for nothing. `mount()` re-reads and shows it.
  const reminderOpen = () => !!state.bubble && !!state.bubble.open && state.enabled && !(state.stopAtGoal && safe(state.glasses) >= safe(state.goal));
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (dead) return;
    // Asked before a reminder is routed, because only the page knows whether it is really being looked at: a
    // Chrome window left behind another application still has this tab active, and the worker cannot tell from
    // `windows` alone. Answered synchronously, so the channel is not held open.
    if (message?.type === 'DUDU_PROBE') { reply(document.visibilityState === 'visible' && document.hasFocus()); return; }
    if (message?.type !== 'DUDU_REMIND') return;
    ensure().then(() => onRemind && onRemind(message.at)).catch(() => {});
  });
  chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local'||dead)return;
    if(!Object.keys(changes).some(k=>['floating','glasses','goal','enabled','lastDay','pos','snoozeUntil','bear','bubble'].includes(k)))return;
    refresh().then(()=>{if(!host&&(state.floating||reminderOpen()))ensure();});});
  refresh().then(()=>{if(state.floating||reminderOpen())ensure();});
})();
