'use strict';
const fs=require('fs');
const app=fs.readFileSync('js/app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const haptics=fs.readFileSync('js/haptics.js','utf8');
let pass=0,fail=0,lines=[];
const ok=(name,cond,detail='')=>{if(cond){pass++;lines.push(`PASS — ${name}${detail?` / ${detail}`:''}`)}else{fail++;lines.push(`FAIL — ${name}${detail?` / ${detail}`:''}`)}};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const R={
  normalChunkSqrt:1.9,normalChunkMin:8,normalChunkMax:60,normalCycle:.50,zeroGap:.095,
  normalMilestoneSmall:10,normalMilestoneLarge:100,normalMilestoneThreshold:100,normalMilestonePauseSmall:.14,normalMilestonePauseLarge:.22,
  sjpOnStart:.72,sjpOnEnd:.64,sjpZeroStart:.032,sjpZeroEnd:.008,sjpBlockPauseStart:.60,sjpBlockPauseEnd:.22,sjpFinalOn:.70,sjpFinalZero:.004
};
function msize(total){return total<R.normalMilestoneThreshold?10:100}
function normal(total,jitter=1){
  const ms=msize(total), pause=ms===10?.14:.22;
  let remaining=total,delivered=0,next=ms,time=.20,pulses=0,breaks=[];
  const base=clamp(Math.round(Math.sqrt(total)*1.9),8,60);
  while(remaining>0){
    const nominal=Math.max(1,Math.round(base*jitter));
    const chunk=Math.min(remaining,Math.max(1,next-delivered),nominal);
    remaining-=chunk;delivered+=chunk;pulses++;time+=.405;
    if(remaining<=0)break;
    if(delivered>=next){breaks.push(delivered);time+=pause;next=Math.min(total,next+ms)}else time+=.095;
  }
  return {total,ms,pulses,breaks,time,delivered,remaining};
}
function blockSize(total){return total<=1000?100:total<=3000?250:total<=6000?400:600}
function sjpPause(p){return .60-(.60-.22)*Math.pow(clamp(p,0,1),.75)}
function sjpZero(p,finale){return finale?.004:.032-(.032-.008)*Math.pow(clamp(p,0,1),.85)}
function sjpOn(p,finale){return finale?.70:.72-(.72-.64)*Math.pow(clamp(p,0,1),.80)}
function sjp(bet){
  const total=bet*100,bs=blockSize(total),bc=Math.ceil(total/bs);
  let remaining=total,delivered=0,bi=1,bd=0,bt=Math.min(bs,total),time=.20,pulses=0;
  while(remaining>0){
    const before=1-remaining/total;
    const lo=Math.max(12,Math.round(bet*.35));
    const hi=Math.min(150,Math.max(55,Math.round(bet*1.15)));
    const eased=before*before*(3-2*before);
    const raw=Math.max(1,Math.round((lo+(hi-lo)*eased)/5)*5);
    const chunk=Math.min(remaining,Math.max(1,bt-bd),raw);
    remaining-=chunk;delivered+=chunk;bd+=chunk;pulses++;
    const prog=delivered/total, finale=bi===bc;
    time+=sjpOn(prog,finale);
    if(remaining<=0)break;
    if(bd>=bt){time+=sjpPause(prog);bi++;bd=0;bt=Math.min(bs,remaining)}else time+=sjpZero(prog,finale);
  }
  return {bet,total,bs,bc,pulses,time,delivered,remaining};
}

ok('Game title renamed to 541 VOLCAAANO!!!',html.includes('541 VOLCAAANO!!!')&&!html.includes('<h1>HAPTIC KAZAAAN'));
ok('Visible output label is E-STIM DEVICE',html.includes('<h2>E-STIM DEVICE</h2>')&&html.includes('E-STIM DEVICE: SIM'));
ok('Runtime status label uses E-STIM DEVICE',app.includes("'E-STIM DEVICE: '")&&haptics.includes('E-STIM DEVICE CONNECTED'));
ok('Normal payout has 10/100 medal milestone model',/normalMilestoneSmall:10,normalMilestoneLarge:100,normalMilestoneThreshold:100/.test(app));
ok('Normal payout cannot jump across milestone',/const toBoundary=p\.milestoneSize\?Math\.max\(1,p\.milestoneNext-p\.delivered\):remain/.test(app));
ok('Normal amount gap is explicit zero-output phase',/phase='amountGap'/.test(app)&&/normalMilestonePause\(p\.milestoneSize\)/.test(app));
ok('No phantom normal payout is added',/return Math\.min\(remain,toBoundary,nominal\)/.test(app));
ok('SJP ON duration extended',/sjpOnStart:\.72,sjpOnEnd:\.64/.test(app)&&/sjpFinalOn:\.70/.test(app));
ok('SJP block breaks retained',/sjpBlockPauseStart:\.60,sjpBlockPauseEnd:\.22/.test(app));
ok('SJP near-continuous within-block ZERO retained',/sjpZeroStart:\.032,sjpZeroEnd:\.008/.test(app)&&/sjpFinalZero:\.004/.test(app));

for(const total of [30,60,90]){
  const r=normal(total,1);
  const expected=[];for(let x=10;x<total;x+=10)expected.push(x);
  ok(`Normal ${total} payout breaks every 10`,JSON.stringify(r.breaks)===JSON.stringify(expected),r.breaks.join(','));
  ok(`Normal ${total} conserves exact payout`,r.delivered===total&&r.remaining===0,`${r.delivered}/${total}`);
}
for(const total of [120,360,1188]){
  const r=normal(total,1);
  const expected=[];for(let x=100;x<total;x+=100)expected.push(x);
  ok(`Normal ${total} payout breaks every 100`,JSON.stringify(r.breaks)===JSON.stringify(expected),r.breaks.join(','));
  ok(`Normal ${total} conserves exact payout`,r.delivered===total&&r.remaining===0,`${r.delivered}/${total}`);
}
for(const bet of [5,10,30,50,99]){
  const s=sjp(bet),n=normal(s.total,1);
  ok(`BET ${bet} SJP conserves exact payout`,s.delivered===s.total&&s.remaining===0,`${s.delivered}/${s.total}`);
  ok(`BET ${bet} SJP duration exceeds same-amount normal baseline`,s.time>n.time,`SJP ${s.time.toFixed(1)}s > normal ${n.time.toFixed(1)}s`);
}
const s99=sjp(99);
ok('BET99 SJP remains block-countable',s99.bc===17,`${s99.bs}枚 × ${s99.bc} blocks`);
ok('BET99 SJP is intentionally long-form',s99.time>120,`${s99.pulses} chunks / ${s99.time.toFixed(1)}s`);

console.log(lines.join('\n'));
console.log(`\nV0.11 PAYOUT RESULT: ${fail?'FAIL':'PASS'} — ${pass} passed / ${fail} failed`);
process.exitCode=fail?1:0;
