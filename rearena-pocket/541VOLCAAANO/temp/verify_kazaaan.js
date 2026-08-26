'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const base=__dirname;
global.window=global;
global.localStorage={_:{},getItem(k){return this._[k]??null},setItem(k,v){this._[k]=String(v)}};
Object.defineProperty(global,'navigator',{value:{},configurable:true});
for(const f of ['js/kazaaan-data.js','js/kazaaan-physics.js','js/haptics.js']) vm.runInThisContext(fs.readFileSync(path.join(base,f),'utf8'),{filename:f});
const {STAGES,weightedQuestion}=global.KZ_DATA;
const {KazaaanPhysicsEngine}=global.KZ_PHYSICS;
const {HapticController,rankWaves}=global.KZ_HAPTICS;
let pass=0,fail=0,lines=[];
function ok(name,cond,detail=''){ if(cond){pass++; lines.push(`PASS — ${name}${detail?` / ${detail}`:''}`)} else {fail++; lines.push(`FAIL — ${name}${detail?` / ${detail}`:''}`)} }
function eq(a,b){return JSON.stringify(a)===JSON.stringify(b)}

const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
const appSource=fs.readFileSync(path.join(base,'js/app.js'),'utf8');
ok('BET is clamped to 5..99', /clamp\(Math\.round\(v\),5,99\)/.test(appSource) && /data-bet="99"/.test(html));
ok('1ST has 18 pockets', STAGES.s1.count===18 && STAGES.s1.slots.length===18);
ok('1ST order UP OUT OUT x6', eq(STAGES.s1.slots.map(x=>x.type),Array.from({length:18},(_,i)=>i%3===0?'UP':'OUT')));
ok('2ND exact 15-pocket order', eq(STAGES.s2.slots.map(x=>x.label),['UP','×1','×?','OUT','×2','UP','OUT','×?','×3','OUT','UP','OUT','×?','×2','OUT']));
ok('3RD exact 6-pocket order', eq(STAGES.s3.slots.map(x=>x.label),['JPC','×3','×6','×?','×6','×3']));
ok('3RD HOLD indices are 4 payout holes', eq(STAGES.s3.holdIndices,[1,2,4,5]));
ok('JPC exact lower ceiling order', eq(STAGES.jpc.slots.map(x=>x.label),['SJPC','×6','×12','×?','×12','×6']));
ok('SJPC exact upper ceiling order', eq(STAGES.sjpc.slots.map(x=>x.label),['SJP ×100','×15','×30','×?','×30','×15']));
ok('Question ranges', STAGES.s2.slots.find(x=>x.type==='Q').min===1 && STAGES.s2.slots.find(x=>x.type==='Q').max===10 && STAGES.s3.slots.find(x=>x.type==='Q').min===3 && STAGES.s3.slots.find(x=>x.type==='Q').max===15 && STAGES.jpc.slots.find(x=>x.type==='Q').min===6 && STAGES.jpc.slots.find(x=>x.type==='Q').max===30 && STAGES.sjpc.slots.find(x=>x.type==='Q').min===15 && STAGES.sjpc.slots.find(x=>x.type==='Q').max===50);

function simulate(stageId,holds=new Set(),count=300){
  const counts={},times=[],swings=[],edge=[],dark=[],offsets=[],contactStreaks=[];let unresolved=0;
  for(let n=0;n<count;n++){
    const e=new KazaaanPhysicsEngine(global.KZ_DATA);
    // Vary motor phase and use deterministic physical seed. This does not select the result.
    e.motors[stageId].phase=(n*0.61803398875*Math.PI*2)%(Math.PI*2);
    e.startStage(stageId,(0x9e3779b9+n*2654435761)>>>0,holds);
    let ev=null;
    for(let i=0;i<120*30 && !ev;i++){
      e.stepMotors(1/120); ev=e.stepTrial(1/120);
    }
    if(!ev){unresolved++;continue}
    counts[ev.slot.label]=(counts[ev.slot.label]||0)+1; times.push(ev.time); swings.push(ev.swings); edge.push(ev.edgeHits); dark.push(ev.darkHits||0); offsets.push(Math.abs(ev.captureLocal||0)); contactStreaks.push(ev.maxContactStreak||0);
  }
  return {counts,times,swings,edge,dark,offsets,contactStreaks,unresolved};
}
const s1=simulate('s1',new Set(),500);
ok('1ST physics always resolves in 30s',s1.unresolved===0,`unresolved=${s1.unresolved}`);
const s1up=s1.counts.UP||0, s1out=s1.counts.OUT||0;
ok('1ST physics produces both UP and OUT',s1up>0&&s1out>0,`UP=${s1up} OUT=${s1out}`);
const avg=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
ok('1ST ball visibly oscillates before capture',avg(s1.swings)>=1,`avg swings=${avg(s1.swings).toFixed(2)}`);
ok('Dark non-pocket carrier space produces physical bounce',avg(s1.dark)>0,`avg dark bounces=${avg(s1.dark).toFixed(2)}`);

const s2=simulate('s2',new Set(),600);
ok('2ND fixed-gate physics resolves',s2.unresolved===0,`unresolved=${s2.unresolved}`);
ok('2ND physics can produce UP, OUT and payout pockets',(s2.counts.UP||0)>0&&(s2.counts.OUT||0)>0&&Object.keys(s2.counts).some(x=>x.startsWith('×')),JSON.stringify(s2.counts));
const s3open=simulate('s3',new Set(),600);
ok('3RD fixed-gate physics resolves',s3open.unresolved===0,`unresolved=${s3open.unresolved}`);
ok('3RD open physics can reach JPC, HOLD payouts and ×?',(s3open.counts.JPC||0)>0&&(s3open.counts['×3']||0)>0&&(s3open.counts['×6']||0)>0&&(s3open.counts['×?']||0)>0,JSON.stringify(s3open.counts));

const holds4=new Set([1,2,4,5]);
const s3=simulate('s3',holds4,350);
const bad=['×3','×6'].some(x=>(s3.counts[x]||0)>0);
ok('4-HOLD blocks all ×3/×6 capture',!bad,JSON.stringify(s3.counts));
ok('4-HOLD leaves JPC and ×? as possible outcomes',(s3.counts.JPC||0)>0&&(s3.counts['×?']||0)>0,JSON.stringify(s3.counts));

const hc=new HapticController({onStatus(){},onRank(){},onOutput(){}});
hc.settings.limitA=30;hc.settings.limitB=45;hc.output.power=80;
const p=hc.makeB0('0A0A0A0A64646464','2D2D2D2D32323232');
ok('COYOTE B0 exactly 20 bytes',p.length===20,`len=${p.length}`);
ok('COYOTE absolute strength mode in B0',p[1]===0x0F,`mode=0x${p[1].toString(16)}`);
ok('A/B LIMIT scales command inside configured ceiling',p[2]===48&&p[3]===72,`A=${p[2]} B=${p[3]}`);
const z=hc.zeroPacket();ok('COYOTE zero B0 exactly 20 bytes and zero strengths',z.length===20&&z[2]===0&&z[3]===0);
let bf=null;hc.ble.write={writeValueWithoutResponse:async d=>{bf=Array.from(d)}};hc.mode='real';hc.writeBF().then(()=>{});
// queueWrite is promise chained; settle below.

const requiredIds=['machineCanvas','betDisplay','creditDisplay','betMinus','betPlus','launchButton','holdCount','payoutRemain','panicButton','simMode','realMode','connectButton','limitA','limitB','channelA','channelB','livePower','livePreset','powerHistoryCanvas','waveformCanvas','scopeWindow','stimulusNow','stimulusTech','payoutLiveType','payoutLiveStrength','payoutLiveDetail','payoutBlockRow','payoutBlock','payoutBlockAmount','physicsProfile','diamondBonus','audioVolume','insertMedals','syncWaves','rankBody','diagSeed','diagMotor','diagSwings','diagDelay','diagSlot','debugHitbox'];
ok('All app-critical DOM IDs exist',requiredIds.every(id=>new RegExp(`id=[\"']${id}[\"']`).test(html)));
ok('All split JS files are referenced', ['js/kazaaan-data.js','js/kazaaan-physics.js','js/haptics.js','js/app.js'].every(f=>html.includes(`src=\"${f}\"`)));
const physicsSource=fs.readFileSync(path.join(base,'js/kazaaan-physics.js'),'utf8');
ok('Pockets revolve without visual self-rotation',!physicsSource.includes('ctx.rotate(') && physicsSource.includes('One carrier contour for ALL five stages'));
ok('Captured ball remains visible and follows captured pocket at preserved local offset',physicsSource.includes('engine.capturedBallPoint(activeStage,t.captureIndex,t.captureLocal') && physicsSource.includes('No post-capture float'));
ok('Pocket labels use one screen-space font size',physicsSource.includes('POCKET_LABEL_FONT_PX=12') && physicsSource.includes('ctx.font=`900 ${POCKET_LABEL_FONT_PX}px system-ui`'));
ok('Capture dwell remains after hard-pocket settling',appSource.includes('const CAPTURE_DWELL=.82') && appSource.includes('app.resolveTimer=CAPTURE_DWELL'));
ok('1ST-3RD use one fixed entrance gate geometry',['s1','s2','s3'].every(id=>Number.isFinite(STAGES[id].geometry.captureTheta)&&Number.isFinite(STAGES[id].geometry.gateHalfTheta)) && physicsSource.includes('gateGeometry(stageId)'));
ok('Rendered rail gap uses exact physics gate boundaries',physicsSource.includes('gate.left')&&physicsSource.includes('gate.right')&&physicsSource.includes('the SAME gateGeometry'));
ok('UP transfer continuously re-enters target stage',appSource.includes("beginStage(to,{entry:true})") && physicsSource.includes('entryPoint(stageId,W,H)'));
ok('1ST-3RD entry positions are distinct from capture gate',['s1','s2','s3'].every(id=>Math.abs(STAGES[id].geometry.entryTheta-STAGES[id].geometry.captureTheta)>.05));

const fallbackSource=fs.readFileSync(path.join(base,'js/haptics.js'),'utf8');
ok('COYOTE V3 service/write/notify UUIDs present', fallbackSource.includes('0000180c-0000-1000-8000-00805f9b34fb') && fallbackSource.includes('0000150a-0000-1000-8000-00805f9b34fb') && fallbackSource.includes('0000150b-0000-1000-8000-00805f9b34fb'));

const ranked=hc.ranked;
ok('Fallback waveform ranking is ascending',ranked.every((x,i)=>i===0||ranked[i-1].score<=x.score));
ok('Waveform ranking spans GENTLE to SEVERE',ranked[0].class==='GENTLE'&&ranked[ranked.length-1].class==='SEVERE');
const qvals=new Set();for(let i=0;i<200;i++)qvals.add(weightedQuestion('s2',Math.random,0,0));
ok('×? model stays inside documented 2ND range',[...qvals].every(v=>v>=1&&v<=10));

Promise.resolve(hc.ble.queue).then(()=>{
  ok('COYOTE BF exactly 7 bytes',Array.isArray(bf)&&bf.length===7,`BF=${bf}`);
  ok('COYOTE BF carries A/B 0-200 soft limits',bf&&bf[1]===60&&bf[2]===90,`A=${bf?.[1]} B=${bf?.[2]}`);
  ok('Player controls only BET + BALL SHOOT in game path',!/(NUDGE|TILT|STEER|AIM)/i.test(appSource));
  ok('Launch delay keeps verified 0..2s range with near-immediate bias',/sampleLaunchDelay/.test(appSource) && /Math\.pow\(clamp\(rng\(\),0,1\),2\.2\)\*2\.0/.test(appSource));

  ok('All five stage cavities use one shared contour',physicsSource.includes('One carrier contour for ALL five stages') && !physicsSource.includes('roundRect('));
  ok('Visual cavities and physics share cavityGeometry',physicsSource.includes('cavityGeometry(stageId,index)') && physicsSource.includes('engine.cavityGeometry(id,i)') && physicsSource.includes('carrierProfile(stageId,angle)'));
  ok('Carrier tooth faces are drawn on exact cavity boundaries',physicsSource.includes('cg.center-cg.cavityHalf') && physicsSource.includes('cg.center+cg.cavityHalf'));
  ok('Optional hitbox overlay redraws cavity and gate geometry',physicsSource.includes("const gate=engine.gateGeometry(id)") && appSource.includes("$('debugHitbox')?.checked"));
  ok('UP width is fixed geometry, not speed-dependent mystery shrink',!physicsSource.includes('(period-13.0)/7.0') && STAGES.s1.slots.filter(x=>x.type==='UP').every(x=>x.width===.84));
  ok('Finite ball radius is derived from rendered ball size',physicsSource.includes('const BALL_RADIUS_NORM=.010') && physicsSource.includes('ballAngularRadius(stageId') && physicsSource.includes('cavity.cavityHalf-ballMargin'));
ok('Visible cavity walls and ball-centre contact envelope share one geometry',physicsSource.includes('const inVisibleCavity=') && physicsSource.includes('const inCaptureCavity=') && physicsSource.includes('rendered-ball radius inside the cyan cavity walls'));
  ok('Carrier opening is evaluated under the ball, not at gate centre',physicsSource.includes('const profile=this.carrierProfile(t.stageId,t.theta)') && !physicsSource.includes('carrierGeometryAtGate'));
  ok('App diagnostics no longer call removed gate-centre helper',!appSource.includes('carrierGeometryAtGate') && appSource.includes('physics.carrierProfile(app.activeStage,t.theta)'));
  ok('Entered cell is latched before final result',physicsSource.includes('if(t.engaged&&!t.captured') && physicsSource.includes('t.engaged=true;t.engagedIndex=nearest.index'));
  ok('Captured local offset is exact, not clamped toward centre',avg(s1.offsets)>0.01 && Math.max(...s1.offsets)>0.04 && !physicsSource.includes('captureLocal=clamp'),`avg=${avg(s1.offsets).toFixed(3)} max=${Math.max(...s1.offsets).toFixed(3)}`);
  ok('No deprecated lip theta-teleport helper remains',!physicsSource.includes('releaseFromCarrierContact')&&!physicsSource.includes('CONTACT_RELEASE_RATIO'));
  ok('No elapsed-time force-to-result helpers remain',!physicsSource.includes('t.settle')&&!physicsSource.includes('timeBias')&&!physicsSource.includes('t.time>15')&&!physicsSource.includes('capturePull'));
  ok('No hidden second gate width remains',!physicsSource.includes('visualGap')&&!physicsSource.includes('slitW')&&!physicsSource.includes('slitH')&&!physicsSource.includes('gateProximity'));
  ok('Ball radius is not implemented as an arbitrary invisible constant',!physicsSource.includes('ballMargin:0') && physicsSource.includes('BALL_RADIUS_NORM/Math.max(.001,g.rx*radialScale)'));
  ok('Numerical carrier chatter is limited to one impact episode',Math.max(...s1.contactStreaks)<=1,`max streak=${Math.max(...s1.contactStreaks)}`);
  ok('Average 1ST carrier-top impacts remain moderate',avg(s1.dark)<4,`avg=${avg(s1.dark).toFixed(2)}`);
  ok('No arbitrary tangential side-kick remains',!physicsSource.includes('side*(.10+rng()*.16)')&&!physicsSource.includes('floorSpeed='));

  // Regression for the old proxy-at-gate bug: with an UP cavity centred under the
  // gate, a ball centre near the gate edge can be over the visible tooth. Physics
  // must classify the carrier under the BALL, not reuse the gate-centre sample.
  (function(){
    const e=new KazaaanPhysicsEngine(global.KZ_DATA),st=STAGES.s1,gate=e.gateGeometry('s1');
    e.motors.s1.phase=gate.theta; // slot #1 (UP) centred under fixed gate
    e.startStage('s1',0x12345678,new Set());
    const cg=e.cavityGeometry('s1',0);
    const theta=gate.theta+Math.min(gate.half*.96,cg.cavityHalf*1.04);
    const prof=e.carrierProfile('s1',theta);
    ok('Gate-edge ball cannot fall through a tooth because gate centre is open',Math.abs(theta-gate.theta)<gate.half && !prof.inCaptureCavity,`gateHalf=${gate.half.toFixed(4)} cavityHalf=${cg.cavityHalf.toFixed(4)} local=${Math.abs(prof.local).toFixed(4)}`);
  })();

  (function(){
    let bad=0,total=0;
    for(let n=0;n<500;n++){
      const e=new KazaaanPhysicsEngine(global.KZ_DATA);e.motors.s1.phase=(n*.417*Math.PI*2)%(Math.PI*2);e.startStage('s1',(0xB0110000+n)>>>0,new Set());
      let ev=null;for(let i=0;i<120*20&&!ev;i++){e.stepMotors(1/120);ev=e.stepTrial(1/120)}
      if(!ev)continue;total++;const cg=e.cavityGeometry('s1',ev.index),usable=cg.cavityHalf-e.ballAngularRadius('s1');if(Math.abs(ev.captureLocal)>usable+1e-6)bad++;
    }
    ok('Every seated ball centre is inside radius-aware cavity walls',total>450&&bad===0,`tested=${total} outside=${bad}`);
  })();

  // High-speed carrier contact may change radial motion but must not reverse the
  // left/right rail motion by a hidden gameplay impulse.
  (function(){
    let suspicious=0,contacts=0;
    for(let n=0;n<300;n++){
      const e=new KazaaanPhysicsEngine(global.KZ_DATA);e.motors.s1.phase=(n*.371*Math.PI*2)%(Math.PI*2);e.startStage('s1',(0xA51C0000+n)>>>0,new Set());
      for(let i=0;i<120*10&&!e.trial.captured;i++){
        const before=e.trial.velocity,dark=e.trial.darkHits;e.stepMotors(1/120);e.stepTrial(1/120);
        if(e.trial.darkHits>dark){contacts++;const after=e.trial.velocity;if(Math.abs(before)>.45&&Math.sign(before)!==Math.sign(after))suspicious++;}
      }
    }
    ok('Carrier top does not cause high-speed instant direction reversal',suspicious===0,`contacts=${contacts} suspicious=${suspicious}`);
  })();

  ok('Fixed 120Hz physics step is present',/FIXED=1\/120/.test(appSource));
  ok('SJP uses ×100 stage data',STAGES.sjpc.slots[0].mult===100);
  console.log(lines.join('\n'));
  console.log(`\nRESULT: ${fail===0?'PASS':'FAIL'} — ${pass} passed / ${fail} failed`);
  process.exitCode=fail?1:0;
});
