const $=id=>document.getElementById(id);const today=()=>new Date().toLocaleDateString('en-CA');let state,confT=null;const DEFAULTS={interval:45,enabled:true,glasses:0,goal:8,lastDay:'',floating:true,quiet:false,quietFrom:22,quietTo:7,stopAtGoal:false,history:[],syncAt:0,syncMeta:{},bear:'bubu'};
// `history` is what makes a week strip and a streak possible: one record per finished day, appended on
// rollover (see `rollover()`), newest last and capped at HISTORY so storage cannot grow forever.
const HISTORY=30,num=v=>Number.isFinite(Number(v))?Number(v):0,serial=d=>d.toLocaleDateString('en-CA'),histMap=()=>Object.fromEntries((state.history||[]).filter(d=>d&&d.day).map(d=>[d.day,d]));const MOODS=['Bubu is feeling a little dry','Bubu is slowly waking up','Bubu is stretching in the sun','Bubu is taking small sips','Bubu is a little more himself','Bubu is calm and content','Bubu is quietly happy','Bubu is glowing softly','Bubu is warm and rested','Bubu is full of quiet joy'];
// Nothing paints before the first render: `main` starts hidden (see `main.ready` in style.css) so the
// placeholder tier/mood/count in popup.html are never shown. They used to flash for a frame, which read
// as the eyes suddenly resizing the moment the popup opened.
// Day rollover resets today *and* archives the day that just ended: `lastDay` alone can never build a
// history. The popup and the content script both roll over (either may be the first to see a new day)
// and each keys its record by `day`, so rolling over twice replaces rather than duplicates it.
async function rollover(){if(state.lastDay===today())return;const done={day:state.lastDay,glasses:num(state.glasses),goal:num(state.goal)||1},hist=[...(state.history||[]).filter(d=>d&&d.day&&d.day!==done.day),...(state.lastDay?[done]:[])].sort((a,b)=>a.day<b.day?-1:1).slice(-HISTORY);state.history=hist;state.glasses=0;state.lastDay=today();state.syncAt=Date.now();await chrome.storage.local.set({glasses:0,lastDay:state.lastDay,syncAt:state.syncAt,history:hist}).catch(()=>{});}
// `2 minutes` was dropped from the picker, so a device still storing it would show a blank select while the
// reminders kept firing on the old cadence. The first remaining choice takes over, stamped like any other edit so
// the account keeps the newer value rather than the newer arrival.
async function fitInterval(){const opts=[...$('interval').options].map(o=>Number(o.value));
  if(!opts.length||opts.includes(num(state.interval)))return;
  state.interval=opts[0];state.syncMeta={...(state.syncMeta||{}),interval:Date.now()};
  await chrome.storage.local.set({interval:state.interval,syncMeta:state.syncMeta}).catch(()=>{});}
async function init(){const svg=await fetch('bear.svg').then(r=>r.text()).catch(()=>'');if(svg)$('bear').insertAdjacentHTML('beforeend',svg);state=await chrome.storage.local.get(DEFAULTS).catch(()=>({...DEFAULTS}));await rollover();await fitInterval();fillHours();render();}
// The live numbers — count, bar, goal, stepper buttons and message. Split out of render() so a held
// stepper can repaint on every tick without re-querying the alarm or restarting the confetti.
function paint(){const pct=Math.min(100,100*state.glasses/Math.max(1,state.goal)),done=state.glasses>=state.goal;$('count').textContent=`${state.glasses} / ${state.goal}${done?' ✓':''}`;$('progress').style.width=`${pct}%`;$('goal').textContent=state.goal;$('goalDown').disabled=state.goal<=1;$('goalUp').disabled=state.goal>=30;$('message').textContent=done?'Amazing Bubu! Dudu is proud of you!':'Dudu is cheering for you!';$('undo').disabled=state.glasses<=0;document.body.classList.toggle('done',done);return done;}
function render(){const done=paint();const tier=Math.min(9,Math.floor(Math.min(100,100*state.glasses/Math.max(1,state.goal))/10));$('bear').dataset.tier=tier;$('bear').classList.toggle('done',done);const variant=BEARS.includes(state.bear)?state.bear:'bubu';$('bear').dataset.bear=variant;$('bearName').textContent=BEAR_NAMES[variant];$('mood').textContent=MOODS[tier];$('interval').value=state.interval;$('enabled').checked=state.enabled;$('floating').checked=state.floating;$('stopAtGoal').checked=state.stopAtGoal;$('quiet').checked=state.quiet;$('quietFrom').value=state.quietFrom;$('quietTo').value=state.quietTo;$('quietFrom').disabled=$('quietTo').disabled=!state.quiet;paintWeek();if(done)startConfetti();else stopConfetti();status();document.querySelector('main').classList.toggle('reminders-off',!state.enabled);document.querySelector('main').classList.add('ready');}
// The one animation that ignores `prefers-reduced-motion` on purpose: it is a celebration the user asked for by
// finishing the day, it runs for seconds rather than constantly, and a goal met with nothing on screen reads as
// a broken popup. Everything ambient (blink, bob, sparks) still stops for that setting — see style.css.
function startConfetti(){if(confT)return;const box=$('confetti');if(!box)return;const colors=['#d9534f','#e0a33e','#5f8f4f','#4b8fbc','#b77c55'],SHAPES=['','circle','ribbon','tri','diamond'];const spawn=()=>{for(let i=0;i<4;i++){const p=document.createElement('i');p.style.left=(Math.random()*100).toFixed(2)+'%';p.style.background=colors[(Math.random()*colors.length)|0];p.style.animationDuration=(1.1+Math.random()*.7).toFixed(2)+'s';p.className=SHAPES[(Math.random()*SHAPES.length)|0];p.addEventListener('animationend',()=>p.remove());box.appendChild(p);}while(box.children.length>60)box.firstElementChild.remove();};spawn();confT=setInterval(spawn,220);}
function stopConfetti(){if(!confT)return;clearInterval(confT);confT=null;}
// Quiet hours: the popup only mirrors background.js's check so the countdown can explain itself.
function quietNow(){if(!state.quiet)return false;const f=num(state.quietFrom),t=num(state.quietTo),h=new Date().getHours();if(f===t)return false;return f<t?h>=f&&h<t:h>=f||h<t;}
function fillHours(){['quietFrom','quietTo'].forEach(id=>{const s=$(id);s.replaceChildren(...Array.from({length:24},(_,h)=>{const o=document.createElement('option');o.value=h;o.textContent=String(h).padStart(2,'0')+':00';return o;}));});}
// The strip shows seven days: the six archived ones plus today, which is still live in `state`. A
// missing record is a gap (the extension was not open that day), drawn as an empty slot, not a zero.
// Tapping a bar is the only per-day detail surface in the popup, so it swaps the streak line for that
// day's numbers until the user clicks elsewhere. `picked` is a day key, not an element: the bars are
// rebuilt on every render, so state cannot live on the node.
let picked=null;
const dayLabel=k=>new Date(k+'T00:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});
const dayRec=k=>k===today()?{glasses:num(state.glasses),goal:num(state.goal)||1}:histMap()[k];
function paintWeek(){const box=$('week');if(!box)return;const m=histMap(),now=new Date(),tKey=today(),bars=[],week=[];for(let i=6;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()-i),k=serial(d),rec=k===tKey?{glasses:num(state.glasses),goal:num(state.goal)||1}:m[k],hit=!!rec&&num(rec.glasses)>=num(rec.goal),bar=document.createElement('button');bar.type='button';bar.className=hit?'hit':rec&&num(rec.glasses)>0?'part':'';if(k===tKey)bar.dataset.today='1';if(k===picked)bar.classList.add('selected');bar.setAttribute('aria-label',`${dayLabel(k)}: ${rec?`${num(rec.glasses)} of ${num(rec.goal)} glasses`:'no record'}`);// stopPropagation matters: repainting replaces these nodes, so by the time the click reached `document`
// the target would be detached and `closest('#week')` would fail, clearing the selection it just set.
bar.addEventListener('click',e=>{e.stopPropagation();picked=k===picked?null:k;paintWeek();});const dow=document.createElement('span');dow.className='dow';dow.textContent='SMTWTFS'[new Date(k+'T00:00:00').getDay()];dow.setAttribute('aria-hidden','true');bar.appendChild(dow);bars.push(bar);week.push({k,rec,hit});}// Bar height is relative to the week, not to each day's own goal — otherwise every 8/8 day looks
// identical. The ruler is the week's peak (largest glass count or any goal in the seven days), so a
// 12/8 day stands taller than one that merely hit its goal, while a uniform week still fills the strip.
box.replaceChildren(...bars);const peak=Math.max(1,...week.filter(x=>x.rec).map(x=>num(x.rec.glasses)),...week.filter(x=>x.rec).map(x=>num(x.rec.goal)));bars.forEach((b,i)=>{const rec=week[i].rec;b.style.height=(rec?Math.max(10,Math.min(100,100*num(rec.glasses)/peak)):10)+'%';});
  const n=streakDay(m,now,tKey),pr=picked?dayRec(picked):null;
  $('streak').textContent=picked?`${dayLabel(picked)} · ${pr?`${num(pr.glasses)}/${num(pr.goal)} glasses${num(pr.glasses)>=num(pr.goal)?' ✓':''}`:'no record'}`:n>1?`${n}-day streak ♥`:n===1?(num(state.glasses)>=num(state.goal)?'Streak started today':'1-day streak ♥'):'No streak yet — finish a glass to start one.';}
// A picked day stays highlighted until the user clicks somewhere outside the strip, or the same bar
// again. No timer: the red outline must not vanish while they are reading the day it reveals.
document.addEventListener('click',e=>{if(picked&&!(e.target&&e.target.closest&&e.target.closest('#week'))){picked=null;paintWeek();}});
// Another device can change both the strip's `history` and today's count while this is open. `history`
// repaints the strip alone (re-rendering the card would reset the select and the switches under the
// cursor); a count change goes through `render()`, because the tier, mood, bar and message all follow it.
chrome.storage.onChanged.addListener((c,a)=>{if(a!=='local'||!state)return;
  if(c.history){state.history=c.history.newValue||[];paintWeek();}
  if(c.glasses||c.lastDay){state.glasses=num(c.glasses?c.glasses.newValue:state.glasses);state.lastDay=c.lastDay?(c.lastDay.newValue||''):state.lastDay;state.syncAt=num(c.syncAt?c.syncAt.newValue:state.syncAt);render();}});
// A streak is the run of days that met the goal, ending today — or ending yesterday while today is
// still in progress, so a good run is not reported as broken at 9am.
function streakDay(m,now,tKey){let n=0;for(let i=0;i<HISTORY;i++){const k=serial(new Date(now.getFullYear(),now.getMonth(),now.getDate()-i)),rec=k===tKey?{glasses:num(state.glasses),goal:num(state.goal)||1}:m[k],met=!!rec&&num(rec.glasses)>=num(rec.goal);if(!met){if(i===0)continue;break;}n++;}return n;}
async function status(){if(!state.enabled||(state.stopAtGoal&&num(state.glasses)>=num(state.goal))){$('next').textContent='';return;}if(quietNow()){$('next').textContent=`Quiet hours until ${String(num(state.quietTo)).padStart(2,'0')}:00`;return;}const a=await chrome.alarms.get('water');$('next').textContent=a?`Next reminder in ~${Math.max(1,Math.round((a.scheduledTime-Date.now())/60000))} min`:'Reminders start shortly';}
async function save(patch){Object.assign(state,patch);if('glasses'in patch)state.syncAt=patch.syncAt=Date.now();
  // Every edited setting carries its own stamp, so the account keeps the most recently *edited* value rather
  // than the last one to arrive. Everything else in a patch from this popup is account-wide; `glasses` is
  // ordered by `syncAt` and the stamp map itself merges by max.
  const meta={...(state.syncMeta||{})};for(const k in patch)if(k!=='glasses'&&k!=='syncAt'&&k!=='syncMeta')meta[k]=Date.now();
  state.syncMeta=patch.syncMeta=meta;
  await chrome.storage.local.set(patch);render();if('interval'in patch||'enabled'in patch)setTimeout(status,150);}
$('drink').addEventListener('click',()=>save({glasses:state.glasses+1}));$('undo').addEventListener('click',()=>save({glasses:Math.max(0,state.glasses-1)}));$('interval').addEventListener('change',e=>save({interval:Number(e.target.value)}));$('enabled').addEventListener('change',e=>save({enabled:e.target.checked}));$('floating').addEventListener('change',e=>save({floating:e.target.checked}));$('stopAtGoal').addEventListener('change',e=>save({stopAtGoal:e.target.checked}));$('quiet').addEventListener('change',e=>save({quiet:e.target.checked}));$('quietFrom').addEventListener('change',e=>save({quietFrom:Number(e.target.value)}));$('quietTo').addEventListener('change',e=>save({quietTo:Number(e.target.value)}));
// Settings live in their own view instead of under the hydration card, so each view holds one screen of
// controls. The tracker is always the default (the view is a body class, not storage: a popup should
// open on today's progress). The gear relabels itself Done and Escape closes the view.
const showSettings=open=>{document.body.classList.toggle('show-settings',open);const b=$('settingsBtn');b.textContent=open?'Done':'⚙';b.setAttribute('aria-label',open?'Close settings':'Open settings');b.setAttribute('aria-expanded',String(open));};
$('settingsBtn').addEventListener('click',()=>showSettings(!document.body.classList.contains('show-settings')));
document.addEventListener('keydown',e=>{if(e.key==='Escape')showSettings(false);});function hold(id,step){const el=$(id);let t1,t2,dirty=false;const flush=()=>{if(dirty){dirty=false;save({goal:state.goal});}};const stop=()=>{clearTimeout(t1);clearInterval(t2);t1=t2=0;flush();};const bump=()=>{const n=Math.min(30,Math.max(1,state.goal+step));if(n===state.goal)return stop();state.goal=n;dirty=true;paint();};el.addEventListener('pointerdown',e=>{if(e.button)return;clearTimeout(t1);clearInterval(t2);bump();t1=setTimeout(()=>{t2=setInterval(bump,90);},420);if(el.setPointerCapture)el.setPointerCapture(e.pointerId);});['pointerup','pointercancel','pointerleave','lostpointercapture'].forEach(t=>el.addEventListener(t,stop));el.addEventListener('click',e=>{if(!e.detail){bump();flush();}});}
hold('goalDown',-1);hold('goalUp',1);
// One drawing, many looks: every variant is an extra `<g>` switched on by `data-bear` in bear.svg, not
// a separate file, so there is nothing to keep in step. The choice lives in storage like every other
// setting, which is what lets the floater draw the same bear the popup shows.
const BEARS=['bubu','angry','bow','buckethat','coffee','coolers','crown','headband','headphones','hearts','scarf','specs'],BEAR_NAMES={bubu:'Bubu',angry:'Bubu · angry',bow:'Bubu · bow',buckethat:'Bubu · bucket hat',coffee:'Bubu · coffee',coolers:'Bubu · coolers',crown:'Bubu · crown',headband:'Bubu · headband',headphones:'Bubu · headphones',hearts:'Bubu · hearts',scarf:'Bubu · scarf',specs:'Bubu · specs'},cycleBear=step=>{const i=(BEARS.indexOf(state.bear)+step+BEARS.length)%BEARS.length;save({bear:BEARS[i]});};
$('bearL').addEventListener('click',()=>cycleBear(-1));$('bearR').addEventListener('click',()=>cycleBear(1));
// Eyes track the pointer: offset from the bear's centre, /40 horizontally (clamped to +-14 SVG units)
// and /70 vertically (clamped to +-6 — deliberately smaller, a nudge rather than a slide). The look is
// held until the pointer leaves: no timer, so a blink never recentres the eyes.
(function follow(){const b=$('bear');const clamp=(v,m)=>Math.max(-m,Math.min(m,v)).toFixed(2)+'px';const look=(x,y)=>{b.style.setProperty('--look',clamp(x/40,14));b.style.setProperty('--lookY',clamp(y/70,6));};
  // Same mapping as the floater, and the same cost rule: measure the bear once and reuse it, with only
  // the last position of a burst applied per frame. The popup window does not resize, so the box is
  // measured a single time for the life of the view.
  let box=null,aim=null,raf=0;const aimAt=()=>{raf=0;if(!aim)return;const x=aim.x,y=aim.y;aim=null;if(!box){if(!b.querySelector('.yier'))return;box=b.getBoundingClientRect();}look(x-(box.left+box.width/2),y-(box.top+box.height/2));};
  document.addEventListener('pointermove',e=>{aim={x:e.clientX,y:e.clientY};if(!raf)raf=requestAnimationFrame(aimAt);},{passive:true});
  document.documentElement.addEventListener('pointerleave',()=>{aim=null;if(raf)cancelAnimationFrame(raf);raf=0;look(0,0);});})();
init();
