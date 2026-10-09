'use strict';
// Reuse precisely the same passenger engine as the animated flight.
self.window=self;
importScripts('engine.js');
self.onmessage=({data})=>{
 try{
  const {cfg,seed}=data,results=Object.fromEntries(['s','b','r'].map(k=>[k,{sec:0,passes:0,dist:0,assists:0,wins:0}]));
  let complete=0,failed=0,ties=0;
  for(let j=0;j<20;j++){
   const res=BOARDING_ENGINE.run(cfg,seed+j*104729);
   if(!res.complete){failed++;}else{
    complete++;const best=Math.min(...res.sims.map(s=>s.finish)),winners=res.sims.filter(s=>s.finish===best);
    if(winners.length===1)results[winners[0].kind].wins++;else ties++;
    for(const s of res.sims){const a=results[s.kind],n=s.people.filter(p=>p.bag).length;a.sec+=s.finish;a.passes+=s.passes;a.dist+=n?s.distTotal/n:0;a.assists+=s.assists;}
   }
   self.postMessage({type:'progress',completed:j+1});
  }
  self.postMessage({type:'done',results,complete,failed,ties});
 }catch{self.postMessage({type:'error',message:'This comparison could not finish. Try different conditions or reload the site.'});}
};
