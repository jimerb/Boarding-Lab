(() => {
'use strict';
const E = window.BOARDING_ENGINE;
const $ = id => document.getElementById(id);
const kinds = ['s','b','r'];
const names = {s:'Steffen',b:'Back to front',r:'Random'};
const colors = {s:'#91efcf',b:'#f2b259',r:'#c499f6'};
const definitions = [
 {key:'rows',label:'Plane rows',min:10,max:40,step:2,value:20,unit:'',help:'Each row has six seats, three on each side of a single aisle. Choose 10–40 rows. All three planes use the same size.'},
 {key:'occupancy',label:'Seats occupied',min:5,max:100,step:5,value:100,unit:'%',help:'The percentage of seats assigned to passengers. The occupied seats are identical for all three methods. Counts are rounded to whole passengers.'},
 {key:'capacity',label:'Bin capacity',min:2,max:6,step:1,value:3,unit:' slots',help:'Bag slots per side for each pair of rows. A 20-row plane at 3 slots has 60 spaces in total. Each bag uses one slot.'},
 {key:'bags',label:'Carrying bags',min:0,max:100,step:1,value:50,unit:'%',help:'Passengers carrying one overhead bag. The maximum adjusts to the available bin space. Other passengers carry no overhead bag.'},
 {key:'avg',label:'Stowing time',min:5,max:30,step:1,value:12,unit:' sec',help:'The central stowing time before individual variation. The same passenger keeps the same stowing time across all three boarding methods.'},
 {key:'variation',label:'Time variation',min:0,max:100,step:5,value:60,unit:'%',help:'Individual stowing times vary uniformly around the chosen time. At 60%, they range from about 40% to 160% of it, rounded to seconds, with a 2-second minimum.'},
 {key:'delay',label:'Passing delay',min:5,max:30,step:1,value:15,unit:' sec',help:'Time for two passengers traveling in opposite directions to pass each other. Waiting behind someone stowing a bag does not count as a pass.'},
 {key:'speed',label:'Playback speed',min:1,max:10,step:1,value:5,unit:'×',help:'Simulated seconds per real second. This changes only animation speed; boarding times and the 20-scenario results stay the same.'}
];
let cfg = Object.fromEntries(definitions.map(d=>[d.key,d.value]));
let seed=20261008, sims=[], manifest, elapsed=0, playing=false, acc=0, last=0, batchWorker=null, batchSerial=0, busy=false, state='ready';
const fmt=n=>`${Math.floor(n/60)}:${String(Math.round(n)%60).padStart(2,'0')}`;
const controls=$('controls');
controls.innerHTML=definitions.map(d=>`<div class="control ${d.key==='speed'?'control-divider':''}" id="control-${d.key}"><div class="control-top"><div class="control-label"><label for="ctl-${d.key}">${d.label}</label><button class="help-trigger" aria-label="About ${d.label.toLowerCase()}" aria-describedby="help-${d.key}" type="button">?</button></div><output class="value" id="val-${d.key}" for="ctl-${d.key}"></output></div><input type="range" id="ctl-${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${d.value}" aria-describedby="help-${d.key}"><div class="tooltip" role="tooltip" id="help-${d.key}">${d.help}</div></div>`).join('');
$('planes').innerHTML=kinds.map((k,i)=>`<article class="plane-card" data-kind="${k}" aria-labelledby="title-${k}"><div class="plane-top"><div class="plane-title-row"><h3 id="title-${k}">${names[k]}</h3><span class="method-index">0${i+1}</span></div><p class="method-desc">${{s:'Spaced rows · windows first',b:'Last row first · row by row',r:'Shuffled passenger order'}[k]}</p><div class="time-row"><output class="boarding-time" id="${k}-time" aria-label="${names[k]} boarding time">0:00</output><span class="flight-state" id="${k}-state">READY</span></div><output class="boarding-count" id="${k}-count"></output><div class="progress-track"><span id="${k}-progress"></span></div></div><div class="cabin"><canvas id="canvas-${k}" role="img" aria-label="${names[k]} aircraft seating and aisle animation"></canvas></div><div class="cabin-bottom"><span>FRONT / ENTRY</span><span>6 SEATS / ROW</span></div><div class="metrics"><div class="metric"><strong id="${k}-passes">0</strong><span>Aisle passes</span></div><div class="metric"><strong id="${k}-distance">0.0</strong><span>Bag distance<br>in rows</span></div><div class="metric"><strong id="${k}-assists">0</strong><span>Crew assists</span></div></div></article>`).join('');
const canvases=Object.fromEntries(kinds.map(k=>[k,$('canvas-'+k)]));
function updateControls(){
 const count=Math.round(cfg.rows*6*cfg.occupancy/100),spaces=2*Math.ceil(cfg.rows/2)*cfg.capacity;
 const max=count?Math.min(100,Math.floor(100*spaces/count)):0;
 $('ctl-bags').max=max;cfg.bags=Math.min(max,cfg.bags);$('ctl-bags').value=cfg.bags;
 for(const d of definitions){$('val-'+d.key).textContent=cfg[d.key]+d.unit;$('ctl-'+d.key).setAttribute('aria-valuetext',cfg[d.key]+(d.key==='capacity'?' slots per side per two rows':d.unit));}
 const bags=Math.round(count*cfg.bags/100),pct=Math.round(bags/spaces*100);
 $('capacity-percent').textContent=pct+'% used';$('capacity-fill').style.width=pct+'%';
 $('capacity-info').textContent=`${count} passengers · ${bags} bags · ${spaces} spaces`;
 $('capacity-note').textContent=`Baggage limit for this flight: ${max}% of passengers.`;
 document.querySelectorAll('.cabin').forEach(el=>el.style.height=(cfg.rows>28?Math.max(440,cfg.rows*14)+'px':''));
}
function cancelBatch(clear=true){batchSerial++;batchWorker?.terminate();batchWorker=null;busy=false;$('trials').disabled=false;$('trials').textContent='Compare 20 scenarios';$('batch-progress').hidden=true;if(clear){$('batch-results').innerHTML=emptyBatch;$('batch-status').textContent='';}}
const emptyBatch=$('batch-results').innerHTML;
function init(){
 manifest=E.manifest(cfg,seed);manifest.assignedKeys=new Set(manifest.occupied.map(p=>p.key));sims=kinds.map(k=>E.makeSim(cfg,manifest,k));
 elapsed=0;playing=false;acc=0;state='ready';$('play').textContent='Start all';$('play').disabled=false;$('seed-label').textContent='SCENARIO '+seed;$('result').textContent='Start all three flights to compare their boarding times.';render();
}
function changeSettings(){const next=Object.fromEntries(definitions.map(d=>[d.key,Number($('ctl-'+d.key).value)]));const reset=definitions.some(d=>d.key!=='speed'&&next[d.key]!==cfg[d.key]);cfg=next;updateControls();if(reset){cancelBatch();init();}}
definitions.forEach(d=>{
 $('ctl-'+d.key).addEventListener('input',changeSettings);
 const c=$('control-'+d.key),help=c.querySelector('button');
 help.addEventListener('click',()=>{c.classList.remove('tip-dismissed');c.classList.toggle('tip-open');});
 help.addEventListener('pointerenter',()=>c.classList.remove('tip-dismissed'));
 help.addEventListener('focus',()=>c.classList.remove('tip-dismissed'));
 c.addEventListener('keydown',e=>{if(e.key==='Escape'){c.classList.remove('tip-open');c.classList.add('tip-dismissed');}});
 c.addEventListener('pointerleave',()=>c.classList.remove('tip-open','tip-dismissed'));
 c.addEventListener('focusout',e=>{if(!c.contains(e.relatedTarget))c.classList.remove('tip-open','tip-dismissed');});
});
document.addEventListener('pointerdown',e=>{
 if(!e.target.closest('.help-trigger,.tooltip'))document.querySelectorAll('.control.tip-open').forEach(c=>c.classList.remove('tip-open'));
});
document.querySelectorAll('input[type=range]').forEach(input=>input.addEventListener('focus',()=>{
 document.querySelectorAll('.control.tip-open').forEach(c=>c.classList.remove('tip-open'));
 input.closest('.control').classList.add('tip-dismissed');
}));
function drawCabin(sim){
 const canvas=canvases[sim.kind],ctx=canvas.getContext('2d'),w=canvas.clientWidth,h=canvas.clientHeight,dpr=Math.min(devicePixelRatio||1,3);
 if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 const cx=w/2,sg=Math.min(17,(w-55)/9.5),top=38,bottom=h-28,dy=(bottom-top)/cfg.rows,seatW=sg*.78,seatH=Math.min(10,dy*.64);
 const xs={A:-3.5,B:-2.5,C:-1.5,D:1.5,E:2.5,F:3.5};
 ctx.fillStyle='#25343f';ctx.beginPath();ctx.roundRect(cx-sg*.55,top-8,sg*1.1,bottom-top+18,6);ctx.fill();
 ctx.font='10px ui-monospace,Consolas,monospace';ctx.textAlign='center';ctx.fillStyle='#9daeba';for(const seat of 'ABCDEF')ctx.fillText(seat,cx+xs[seat]*sg,18);
 const seated=new Set(sim.people.filter(p=>p.status==='done').map(p=>p.key));
 for(let row=1;row<=cfg.rows;row++){
  const y=bottom-(row-.5)*dy;
  if(row===1||row===cfg.rows||row%5===0){ctx.fillStyle='#849aa9';ctx.font='10px ui-monospace,Consolas,monospace';ctx.textAlign='right';ctx.fillText(String(row),cx-4.35*sg,y+3);}
  for(const seat of 'ABCDEF'){
   const key=row+seat,x=cx+xs[seat]*sg;ctx.fillStyle=seated.has(key)?'#64d9ad':manifest.assignedKeys.has(key)?'#758a99':'#293641';
   ctx.beginPath();ctx.roundRect(x-seatW/2,y-seatH/2,seatW,seatH,2);ctx.fill();
  }
 }
 for(const bin of sim.bins){const y=bottom-(bin.section*2+1)*dy,bx=cx+(bin.side==='L'?-2.5:2.5)*sg,gap=sg*.45;
  for(let j=0;j<cfg.capacity;j++){ctx.beginPath();ctx.arc(bx+(j-(cfg.capacity-1)/2)*gap,y,Math.max(1.5,Math.min(2.15,sg*.16)),0,Math.PI*2);ctx.fillStyle=j<bin.used?'#ffffff':'#63717d';ctx.fill();}
 }
 for(const p of sim.people){if(p.pos<0||p.status==='done')continue;const y=bottom-(p.pos/3-.5)*dy;
  ctx.beginPath();ctx.arc(cx,y,Math.max(2.2,Math.min(4.4,dy*.3)),0,Math.PI*2);ctx.fillStyle=p.status==='stow'||p.status==='assist'?'#f2b259':p.status==='pass'?'#c499f6':p.status==='sit'?'#64d9ad':'#68b4fa';ctx.fill();
 }
 ctx.fillStyle='#9fb4c0';ctx.font='9px ui-monospace,Consolas,monospace';ctx.textAlign='center';ctx.fillText('ENTRY',cx,h-6);
}
function render(){
 for(const s of sims){const done=s.people.filter(p=>p.status==='done').length,stored=s.people.filter(p=>p.stowed).length;
  $(s.kind+'-time').textContent=fmt(s.finish??s.elapsed);$(s.kind+'-state').textContent=s.finish!==null?'BOARDED':state==='ready'?'READY':playing?'BOARDING':'PAUSED';
  $(s.kind+'-count').textContent=`${done} / ${s.people.length} seated`;
  $(s.kind+'-progress').style.width=(done/s.people.length*100)+'%';$(s.kind+'-passes').textContent=s.passes;
  $(s.kind+'-distance').textContent=stored?(s.distTotal/stored).toFixed(1):'0.0';$(s.kind+'-assists').textContent=s.assists;
  drawCabin(s);
 }
 $('clock').textContent=fmt(elapsed);$('run-status').textContent=state==='complete'?'All passengers seated':state==='error'?'Simulation stopped':playing?'Three flights · one shared clock':state==='ready'?'Ready to board':'Paused · resume when ready';
}
function finishMessage(){const min=Math.min(...sims.map(s=>s.finish)),winners=sims.filter(s=>s.finish===min);return winners.length===1?`${names[winners[0].kind]} finishes first in ${fmt(min)}. All three planes have boarded.`:`Tie: ${winners.map(s=>names[s.kind]).join(' and ')} finish in ${fmt(min)}. All three planes have boarded.`;}
function togglePlay(){if(state==='complete')init();if(state==='error')return;playing=!playing;state=playing?'playing':'paused';$('play').textContent=playing?'Pause all':'Resume all';$('result').textContent=playing?'Watch for several passengers stowing at once. All flights share the same clock.':'All three flights are paused. Resume to continue this comparison.';render();}
$('play').onclick=togglePlay;
$('reset').onclick=()=>{cancelBatch();init();};
$('reroll').onclick=()=>{cancelBatch();seed+=7919;init();};
function step(){elapsed++;for(const s of sims)E.tick(s,cfg);
 if(sims.every(s=>s.finish!==null)){playing=false;state='complete';$('play').textContent='Replay';$('result').textContent=finishMessage();}
 else if(elapsed>=20000){playing=false;state='error';$('play').disabled=true;$('result').textContent='This arrangement did not finish within the simulation limit. Try New passengers or different conditions. No winner is reported.';}
}
function frame(t){if(last&&playing){acc+=Math.min((t-last)/1000,.15)*cfg.speed;let n=0;while(acc>=1&&playing&&n++<30){step();acc--;}render();}last=t;requestAnimationFrame(frame);}
$('trials').onclick=()=>startBatch();
function startBatch(){
 cancelBatch();const token=batchSerial;busy=true;$('trials').disabled=true;$('trials').textContent='Comparing…';$('batch-progress').hidden=false;$('batch-progress').value=0;$('batch-status').textContent='Comparing 20 passenger arrangements…';
 try{batchWorker=new Worker('comparison-worker.js');
 batchWorker.onmessage=({data})=>{if(token!==batchSerial)return;if(data.type==='progress'){$('batch-progress').value=data.completed;$('batch-status').textContent=`Compared ${data.completed} of 20 arrangements…`;}
 else if(data.type==='done'){showBatch(data);batchWorker?.terminate();batchWorker=null;busy=false;$('trials').disabled=false;$('trials').textContent='Compare again';$('batch-progress').hidden=true;}
 else if(data.type==='error')batchError(data.message);};
 batchWorker.onerror=()=>batchError('The comparison could not run. Please reload the site and try again.');
 batchWorker.postMessage({cfg:{...cfg},seed});
 }catch{batchError('The comparison could not start. Open this site through its published address or a local web server.');}
}
function batchError(message){cancelBatch(false);$('batch-status').textContent=message;$('batch-results').innerHTML='';}
function showBatch(data){
 const complete=data.complete,max=Math.max(...kinds.map(k=>data.results[k].sec/Math.max(complete,1)));
 if(!complete){$('batch-status').textContent='No arrangements finished in the time limit. Try different conditions.';$('batch-results').innerHTML='';return;}
 $('batch-status').textContent=`${complete} of 20 arrangements completed${data.failed?' · '+data.failed+' excluded after reaching the time limit':''}.`;
 $('batch-results').innerHTML=`<div class="table-wrap" tabindex="0" role="region" aria-label="20-scenario results, scroll horizontally on small screens"><table><caption class="sr-only">Average results across ${complete} completed arrangements</caption><thead><tr><th scope="col">Boarding method</th><th scope="col">Average time</th><th scope="col">Wins</th><th scope="col">Aisle passes</th><th scope="col">Bag distance</th><th scope="col">Crew assists</th></tr></thead><tbody>${kinds.map(k=>{const a=data.results[k];return `<tr style="--method:${colors[k]}"><td>${names[k]}</td><td class="time-cell">${fmt(Math.round(a.sec/complete))}<span class="time-bar" style="--bar:${a.sec/complete/max*100}%"></span></td><td>${a.wins} / ${complete}</td><td>${(a.passes/complete).toFixed(1)}</td><td>${(a.dist/complete).toFixed(1)} rows</td><td>${(a.assists/complete).toFixed(1)}</td></tr>`;}).join('')}</tbody></table></div><p class="batch-note">${data.ties} tied arrangement${data.ties===1?'':'s'}. Wins count outright fastest finishes; ties do not count as wins. Other columns are averages. Each arrangement uses identical travelers across methods. Repeating with the same settings and scenario gives the same results.</p>`;
}
const dialog=$('info-dialog');$('info-open').onclick=()=>{dialog.showModal();document.body.style.overflow='hidden';};$('info-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{document.body.style.overflow='';$('info-open').focus();});dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
new ResizeObserver(()=>sims.forEach(drawCabin)).observe($('planes'));
document.querySelectorAll('output').forEach(el=>el.setAttribute('aria-live','off'));
updateControls();init();requestAnimationFrame(frame);
// Feature-detected WebMCP shares the visible simulator controls and state.
if(document.modelContext?.registerTool){const lifecycle=new AbortController();const register=tool=>{try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
 register({name:'read_boarding_comparison',description:'Read the current flight conditions, playback state, and the three simulated results.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(input){if(!input||typeof input!=='object'||Object.keys(input).length)throw new Error('Expected an empty object.');return {conditions:{...cfg},scenario:seed,state,elapsed,comparisonRunning:busy,methods:sims.map(s=>({method:names[s.kind],seated:s.people.filter(p=>p.status==='done').length,passengers:s.people.length,finishSeconds:s.finish,passes:s.passes,crewAssists:s.assists}))};}});
 register({name:'control_boarding_playback',description:'Start, pause, or reset the three visible flights. Reset also clears the scenario comparison.',inputSchema:{type:'object',properties:{action:{type:'string',enum:['start','pause','reset']}},required:['action'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||Object.keys(input).some(k=>k!=='action')||!['start','pause','reset'].includes(input.action))throw new Error('Choose start, pause, or reset.');if(input.action==='reset')$('reset').click();else if(input.action==='start'&&!playing)togglePlay();else if(input.action==='pause'&&playing)togglePlay();return {state,elapsed};}});
 window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
})();
