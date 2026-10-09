/* Simulation engine recovered from the latest steffen_boarding_comparison.html.
   The passenger, baggage, ordering, and timing rules are retained. */
(function(global){
 const GAP=3, WALK=1, MAXSECONDS=20000;
 const pair=r=>Math.floor((r-1)/2);
 function rng(seed){let x=seed>>>0;return ()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x/4294967296;};}
 function shuffle(a,r){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
 function manifest(cfg,seed){const r=rng(seed);const all=[];for(let row=1;row<=cfg.rows;row++)for(const seat of 'ABCDEF')all.push({row,seat,key:row+seat,side:'ABC'.includes(seat)?'L':'R'});
 const occupied=shuffle(all,r).slice(0,Math.round(all.length*cfg.occupancy/100));const slots=2*Math.ceil(cfg.rows/2)*cfg.capacity;
 const bags=new Set(shuffle(occupied,r).slice(0,Math.min(slots,Math.round(occupied.length*cfg.bags/100))).map(p=>p.key));
 const durations={};for(const p of all)durations[p.key]=Math.max(2,Math.round(cfg.avg*(1+(r()*2-1)*cfg.variation/100)));
 return {all,occupied,bags,durations,randomOrder:shuffle(occupied,r)};
 }
 function makeSim(cfg,manifest,kind){const has=new Set(manifest.occupied.map(p=>p.key));let order=[];
 if(kind==='s'){for(const seat of 'FAEBDC')for(const parity of [0,1])for(let row=cfg.rows;row>=1;row--)if(row%2===parity&&has.has(row+seat))order.push(manifest.all.find(p=>p.key===row+seat));}
 if(kind==='b'){for(let row=cfg.rows;row>=1;row--)for(const seat of 'ABCDEF')if(has.has(row+seat))order.push(manifest.all.find(p=>p.key===row+seat));}
 if(kind==='r')order=manifest.randomOrder;
 return {kind,idx:0,elapsed:0,finish:null,passes:0,displaced:0,distTotal:0,assists:0,blockedSeconds:0,people:order.map((p,id)=>({...p,id,bag:manifest.bags.has(p.key),stowTime:manifest.durations[p.key],pos:-1,status:'queued',target:p.row*3,bin:null,stowed:false,left:0,partner:-1,previous:null,bagRow:null})),bins:Array.from({length:Math.ceil(cfg.rows/2)*2},(_,i)=>({section:Math.floor(i/2),side:i%2?'R':'L',used:0}))};
 }
 function binStop(b,p,cfg){return Math.max(1,Math.min(cfg.rows,Math.max(2*b.section+1,Math.min(2*b.section+2,p.row))))*3;}
 function selectBin(sim,p,cfg){const current=p.pos/3,seat=p.row;
 // Most travelers only look about four rows ahead, and avoid bins more than four rows from their seat.
 const c=sim.bins.filter(b=>{if(b.used>=cfg.capacity)return false;const at=binStop(b,p,cfg)/3;return Math.abs(at-seat)<=4&&at<=seat+1&&at<=current+4.01&&at>=current-2.01;});
 c.sort((a,b)=>{
  const score=x=>{const at=binStop(x,p,cfg)/3;const own=x.section===pair(seat);return (own?0:15)+Math.abs(at-seat)*6+(x.side===p.side?0:3)+(at<current-.01?14:0)+(at>seat?4:0)+at*.001;};
  return score(a)-score(b);
 });
 return c[0]||null;
 }
 function claim(sim,p,b,cfg){if(!b||b.used>=cfg.capacity)return false;b.used++;
 p.bin=b;p.bagRow=binStop(b,p,cfg)/3;p.stowed=true;
 const distance=Math.abs(p.row-p.bagRow);sim.distTotal+=distance;
 if(b.section!==pair(p.row)||b.side!==p.side)sim.displaced++;
 return true;
 }
 function seatedBlockers(sim,p){const bs=p.seat==='A'?['B','C']:p.seat==='B'?['C']:p.seat==='F'?['E','D']:p.seat==='E'?['D']:[];return bs.filter(seat=>sim.people.some(q=>q.row===p.row&&q.seat===seat&&q.status==='done')).length;}
 function activate(sim,p,cfg){if(['queued','done','pass','stow','assist','sit'].includes(p.status))return;
 if(!p.bag||p.stowed){p.status='seatwalk';p.target=p.row*3;}
 else{
  // Reassess every second, no speculative reservations of overhead spaces.
  const b=selectBin(sim,p,cfg);
  if(b){p.status='bagwalk';p.target=binStop(b,p,cfg);p.bin=b;}
  else{p.status='bagwalk';p.target=p.row*3;p.bin=null;}
 }
 if(Math.abs(p.pos-p.target)>1)return;
 if(p.bag&&!p.stowed){
  if(p.bin&&claim(sim,p,p.bin,cfg)){p.status='stow';p.left=p.stowTime;return;}
  if(p.pos===p.row*3){p.status='assist';p.left=cfg.avg+20;p.bin=null;sim.assists++;return;}
  p.bin=null;return;
 }
 p.status='sit';p.left=4+seatedBlockers(sim,p)*7;
 }
 function completeAssist(sim,p,cfg){const local=selectBin(sim,p,cfg);let b=local;
 if(!b){const free=sim.bins.filter(x=>x.used<cfg.capacity);free.sort((x,y)=>{
 const sc=z=>Math.abs(binStop(z,p,cfg)/3-p.row)*10+(z.side===p.side?0:3)+(z.section>pair(p.row)?1:0);
 return sc(x)-sc(y);});b=free[0];}
 if(!b){p.left=3;return;}claim(sim,p,b,cfg);p.status='seatwalk';p.target=p.row*3;
 }
 function tick(sim,cfg){if(sim.finish!==null)return;
 sim.elapsed++;
 // Progress bag stowing, seating, assistance, and ongoing two-way passes.
 for(const p of sim.people){
  if(p.status==='pass'&&p.partner>=0&&p.id<p.partner){const q=sim.people[p.partner];if(q.status==='pass'&&q.partner===p.id){p.left--;q.left--;if(p.left<=0){const tmp=p.pos;p.pos=q.pos;q.pos=tmp;p.status=p.previous;q.status=q.previous;p.partner=-1;q.partner=-1;}}}
  else if(['stow','sit','assist'].includes(p.status)){
   p.left--;
   if(p.left<=0){if(p.status==='sit'){p.status='done';p.pos=-1;}else if(p.status==='stow'){p.status='seatwalk';p.target=p.row*3;}else completeAssist(sim,p,cfg);}
  }
 }
 // Exact-number entry, with realistic personal spacing of one row in the aisle.
 if(sim.idx<sim.people.length&&!sim.people.some(p=>p.pos>=0&&p.pos<GAP)){
  const p=sim.people[sim.idx++];p.pos=0;p.status=p.bag?'bagwalk':'seatwalk';
 }
 for(const p of sim.people)if(p.pos>=0)activate(sim,p,cfg);
 // Conflict requires actual opposing traffic. Stationary stowers simply block walking.
 const present=sim.people.filter(p=>p.pos>=0).sort((a,b)=>a.pos-b.pos);
 for(let i=0;i<present.length-1;i++){
  const a=present[i],b=present[i+1];
  if(b.pos-a.pos>GAP)continue;
  if(!['seatwalk','bagwalk'].includes(a.status)||!['seatwalk','bagwalk'].includes(b.status))continue;
  if(a.target>a.pos&&b.target<b.pos){
   a.previous=a.status;b.previous=b.status;a.status='pass';b.status='pass';a.partner=b.id;b.partner=a.id;a.left=cfg.delay;b.left=cfg.delay;sim.passes++;i++;
  }
 }
 const moving=sim.people.filter(p=>p.pos>=0&&['seatwalk','bagwalk'].includes(p.status));
 const forward=moving.filter(p=>p.target>p.pos).sort((a,b)=>b.pos-a.pos);
 const backward=moving.filter(p=>p.target<p.pos).sort((a,b)=>a.pos-b.pos);
 for(const p of [...forward,...backward]){
  if(!['seatwalk','bagwalk'].includes(p.status))continue;
  const dir=Math.sign(p.target-p.pos);
  if(!dir)continue;
  const destination=p.pos+dir*WALK;
  const blocked=sim.people.some(q=>q!==p&&q.pos>=0&&q.status!=='done'&&Math.abs(q.pos-destination)<GAP-1e-6);
  if(blocked){sim.blockedSeconds++;continue;}
  p.pos=destination;activate(sim,p,cfg);
 }
 if(sim.people.every(p=>p.status==='done'))sim.finish=sim.elapsed;
 }
 function run(cfg,seed=20261007){const m=manifest(cfg,seed);const sims=['s','b','r'].map(k=>makeSim(cfg,m,k));let i=0;while(sims.some(s=>s.finish===null)&&i++<MAXSECONDS){for(const s of sims)tick(s,cfg);}return {sims,steps:i,complete:sims.every(s=>s.finish!==null),m};}
 global.BOARDING_ENGINE={manifest,makeSim,tick,run};
})(typeof module!=='undefined'?module.exports:window);
