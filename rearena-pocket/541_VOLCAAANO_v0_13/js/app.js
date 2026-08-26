(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const {STAGES,weightedQuestion}=window.KZ_DATA;
  const {KazaaanPhysicsEngine,drawMachine,seedRng,randomSeed,clamp}=window.KZ_PHYSICS;
  const HapticController=window.KZ_HAPTICS.HapticController;
  const RotatingController=window.KZ_ROTATING.RotatingController;
  // Keep the established storage key so existing v0.5-v0.8 credits/settings survive v0.9.
  const STORE='haptic-kazaaan-v05-game';
  const FIXED=1/120;
  const CAPTURE_DWELL=.82;
  const PAYOUT_RULES=Object.freeze({
    normalChunkSqrt:1.9,normalChunkMin:8,normalChunkMax:60,normalJitterMin:.85,normalJitterSpan:.30,
    jackpotMinFloor:12,jackpotMinBet:.35,jackpotMaxFloor:55,jackpotMaxBet:1.15,jackpotChunkCap:150,
    normalNorm:65,jackpotNormFloor:70,jackpotNormBet:1.2,
    hardnessBase:.08,hardnessSpan:.78,hardnessExponent:.72,jackpotHardnessProgress:.12,
    powerBase:10,powerSpan:78,powerExponent:.68,jackpotPowerProgress:8,
    normalCycle:.50,zeroGap:.095,
    // v0.11: non-SJP payouts get countable amount breaks without adding phantom payout.
    // <100 total: every 10 medals; >=100 total: every 100 medals.
    normalMilestoneSmall:10,normalMilestoneLarge:100,normalMilestoneThreshold:100,
    normalMilestonePauseSmall:.14,normalMilestonePauseLarge:.22,
    // v0.11: SJP stays a distinct payout envelope, but is now deliberately LONGER as well as stronger.
    // The amount is still conserved exactly: blocks only GROUP the real HAPTIC PAYOUT; no phantom pulses are added.
    // The amount is still conserved exactly: blocks only GROUP the real HAPTIC PAYOUT; no phantom pulses are added.
    sjpBlockSmall:100,sjpBlockMedium:250,sjpBlockLarge:400,sjpBlockHuge:600,
    sjpBlockBreak1:1000,sjpBlockBreak2:3000,sjpBlockBreak3:6000,
    sjpPowerFloorStart:78,sjpPowerFloorEnd:100,sjpPowerFloorExponent:.70,
    sjpHardnessFloorStart:.72,sjpHardnessFloorEnd:1,sjpHardnessFloorExponent:.68,
    sjpBlockKickPower:6,sjpBlockKickHardness:.05,sjpBlockRampPower:4,sjpBlockRampHardness:.035,
    sjpOnStart:.72,sjpOnEnd:.64,sjpZeroStart:.032,sjpZeroEnd:.008,
    sjpBlockPauseStart:.60,sjpBlockPauseEnd:.22,
    sjpFinalPowerFloor:95,sjpFinalHardnessFloor:.96,sjpFinalOn:.70,sjpFinalZero:.004
  });
  const app={
    bet:5,credit:2000,diamonds:0,diamondBonus:20,holds:new Set(),busy:false,phase:'waiting',activeStage:'s1',lastResult:'—',lastWin:0,
    seed:0,roundRng:null,launchDelay:0,launchTimer:0,resolveTimer:0,transfer:null,payout:null,machineBank:0,totalBet:0,totalWin:0,
    lastNow:performance.now(),acc:0,audio:null,audioVolume:.28,messageTimer:0,
    powerHistory:[],waveHistory:[],rotatingHistory:[],lastTelemetryAt:0,lastLiveSample:null,rotatingUnlocked:false,secretClicks:[]
  };
  const physics=new KazaaanPhysicsEngine(window.KZ_DATA);
  let haptics;
  haptics=new HapticController({onStatus:onHapticStatus,onRank:renderRank,onOutput:renderHapticOutput});
  const rotating=new RotatingController({onStatus:onRotatingStatus,onOutput:renderRotatingOutput});

  function load(){try{const s=JSON.parse(localStorage.getItem(STORE)||'{}');app.bet=clamp(s.bet??5,5,99);app.credit=Math.max(0,Number.isFinite(s.credit)?s.credit:2000);app.diamonds=clamp(s.diamonds??0,0,7);app.diamondBonus=clamp(s.diamondBonus??20,1,999);app.machineBank=Number.isFinite(s.machineBank)?s.machineBank:0;app.totalBet=Number(s.totalBet)||0;app.totalWin=Number(s.totalWin)||0;app.holds=new Set(Array.isArray(s.holds)?s.holds.filter(x=>[1,2,4,5].includes(x)):[]);if(s.profile)physics.setProfile(s.profile);if(Number.isFinite(s.audioVolume))app.audioVolume=clamp(s.audioVolume,0,1);app.rotatingUnlocked=Boolean(s.rotatingUnlocked)||new URLSearchParams(location.search).get('rotating')==='1'}catch(e){console.warn('load failed',e)}}
  function save(){try{localStorage.setItem(STORE,JSON.stringify({bet:app.bet,credit:app.credit,diamonds:app.diamonds,diamondBonus:app.diamondBonus,holds:[...app.holds],machineBank:app.machineBank,totalBet:app.totalBet,totalWin:app.totalWin,profile:physics.profileId,audioVolume:app.audioVolume,rotatingUnlocked:app.rotatingUnlocked}))}catch(e){console.warn('save failed',e)}}
  function houseHeat(){return Math.tanh(app.machineBank/1200)}
  function setMessage(title,sub='',holdMs=0){$('messageTitle').textContent=title;$('messageSub').textContent=sub;$('machineMessage').classList.add('show');clearTimeout(app.messageTimer);if(holdMs>0)app.messageTimer=setTimeout(()=>$('machineMessage').classList.remove('show'),holdMs)}
  function hideMessage(){$('machineMessage').classList.remove('show')}
  function audioCtx(){try{const A=window.AudioContext||window.webkitAudioContext;if(!A)return null;if(!app.audio)app.audio=new A();if(app.audio.state==='suspended')app.audio.resume();return app.audio}catch(_){return null}}
  function tone(freq,dur=.08,gain=.025,type='sine',delay=0){const ac=audioCtx();if(!ac||app.audioVolume<=0)return;const o=ac.createOscillator(),g=ac.createGain(),t=ac.currentTime+delay;o.type=type;o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(Math.max(.0001,gain*app.audioVolume),t);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g).connect(ac.destination);o.start(t);o.stop(t+dur+.02)}
  function soundLaunch(){tone(220,.06,.05,'square');tone(330,.06,.035,'square',.07)}
  function soundMaxBet(){for(let i=0;i<6;i++)tone(72+i*8,.11,.018,'sawtooth',i*.045)}
  function soundUp(){tone(280,.09,.04,'triangle');tone(430,.10,.04,'triangle',.08);tone(610,.12,.035,'triangle',.17)}
  function soundOut(){tone(115,.16,.035,'sawtooth');tone(80,.20,.02,'sawtooth',.12)}
  function soundWin(mult){tone(260+Math.min(500,mult*14),.10,.04,'square');tone(370+Math.min(400,mult*10),.12,.025,'square',.08)}
  function soundPayout(chunk,jp){tone((jp?150:180)+Math.min(560,chunk*4),.055,.032,'square')}
  function soundStartButton(){tone(520,.035,.028,'square');tone(760,.025,.018,'square',.035)}
  function sampleLaunchDelay(rng){
    // Contemporary reports establish a random lag from effectively immediate
    // to about 2 s, but do not publish its probability table. Keep that verified
    // range while biasing the emulation toward short/near-immediate releases so
    // every press does not feel like a mandatory one-second wait.
    return Math.pow(clamp(rng(),0,1),2.2)*2.0;
  }

  function setBet(v){if(app.busy)return;app.bet=clamp(Math.round(v),5,99);save();renderUI()}
  function startRound(){
    if(app.busy||app.credit<app.bet||haptics.panic||haptics.test.active)return;
    audioCtx();app.credit-=app.bet;app.totalBet+=app.bet;app.machineBank+=app.bet;app.lastWin=0;app.lastResult='—';app.busy=true;app.phase='launchDelay';app.activeStage='s1';app.seed=randomSeed();app.roundRng=seedRng(app.seed);app.launchDelay=sampleLaunchDelay(app.roundRng);app.launchTimer=app.launchDelay;app.transfer=null;app.payout=null;haptics.setOutput(0,null);
    $('diagSeed').textContent=app.seed.toString(16).toUpperCase().padStart(8,'0');$('diagDelay').textContent=app.launchDelay.toFixed(2)+'s';
    setMessage('START!',app.launchDelay<.10?'BALL RELEASE / ほぼ即時':`RELEASE WAIT ${app.launchDelay.toFixed(2)}s / 発射機構待ち`);soundStartButton();if(app.bet===99)soundMaxBet();save();renderUI();
  }
  function beginStage(id,options={}){app.activeStage=id;app.phase='rolling';physics.startStage(id,(app.seed^((id.charCodeAt(0)<<24)>>>0)^Math.floor(app.roundRng()*0xffffffff))>>>0,app.holds,options);hideMessage();renderUI()}
  function startTransfer(from,to){
    app.phase='transfer';
    const duration=(from==='s3'||from==='jpc')?1.70:1.45;
    const trial=physics.trial;
    // The transfer begins at the ACTUAL captured-ball position, not at the fixed gate.
    // First the ball drops inward through the UP/JPC pocket, then it travels through
    // the visible collector/ramp. This removes the old "floats out of UP" illusion.
    // During the result dwell the motor keeps rotating and the visible ball
    // follows its captured pocket. Use THAT current followed position, not trial.theta
    // frozen at the capture instant, so transfer starts with zero visual teleport.
    const startAngle=(trial?.captured&&trial.captureIndex>=0)
      ? physics.capturedBallAngle(from,trial.captureIndex,trial.captureLocal)
      : (Number.isFinite(trial?.theta)?trial.theta:(physics.lastCapture?.ballTheta??STAGES[from].geometry.captureTheta??Math.PI/2));
    const startScale=Number.isFinite(trial?.captureRadial)?trial.captureRadial:.86;
    app.transfer={from,to,t:0,duration,startAngle,startScale,point:(W,H)=>{
      const p=clamp(app.transfer.t/duration,0,1);
      const start=physics.ballPoint(from,startAngle,startScale,W,H);
      const g=STAGES[from].geometry;
      // An inward collector below the rotating pocket. Decreasing radial scale makes
      // the ball visibly fall INTO the machine rather than emerge back out of the hole.
      const throat=physics.ballPoint(from,startAngle,.70,W,H);
      let mouth;
      if(from==='s1')mouth={x:W*(g.cx+g.rx*.72),y:H*(g.cy-.01)};
      else if(from==='s2')mouth={x:W*(g.cx-g.rx*.66),y:H*(g.cy-.02)};
      else if(from==='s3')mouth={x:W*g.cx,y:H*(g.cy-g.ry*.86)};
      else mouth={x:W*g.cx,y:H*(g.cy-g.ry*.70)};
      const entry=physics.entryPoint(to,W,H);
      if(p<.18){
        const u=p/.18,q=u*u; // gravity-like acceleration into the pocket
        return{x:start.x+(throat.x-start.x)*q,y:start.y+(throat.y-start.y)*q,alpha:1,phase:'sink'};
      }
      if(p<.42){
        const u=(p-.18)/.24,q=u*u*(3-2*u);
        return{x:throat.x+(mouth.x-throat.x)*q,y:throat.y+(mouth.y-throat.y)*q,alpha:1,phase:'collector'};
      }
      const u=(p-.42)/.58,q=u*u*(3-2*u),arch=Math.sin(Math.PI*q)*H*(from==='s3'?.035:.023);
      return{x:mouth.x+(entry.x-mouth.x)*q,y:mouth.y+(entry.y-mouth.y)*q-arch,alpha:1,phase:'ramp'};
    }};
    soundUp();setMessage(to==='jpc'?'JACKPOT CHANCE!':to==='sjpc'?'SUPER JACKPOT CHANCE!':'UP!',to==='jpc'?'ポケット内へ落下 → スロープを通って天井へ':`ポケット内へ落下 → スロープ → ${STAGES[to].name}`,800)
  }
  function updateTransfer(dt){if(!app.transfer)return;app.transfer.t+=dt;if(app.transfer.t>=app.transfer.duration){const to=app.transfer.to;app.transfer=null;beginStage(to,{entry:true})}}

  function pickHeldRelease(){const arr=[...app.holds];if(!arr.length)return null;const idx=Math.floor(app.roundRng()*arr.length),v=arr[idx];app.holds.delete(v);return v}
  function diamondDraw(){
    // Public material exposes 0..8 but not the original probability table.
    // This table intentionally remains an emulation model; see audit.
    const heat=(houseHeat()+1)/2,base=[34,28,18,10,5,2.7,1.3,.65,.25];const weights=base.map((w,i)=>w*Math.pow(1+.75*heat,i/8));let r=app.roundRng()*weights.reduce((a,b)=>a+b,0);for(let i=0;i<weights.length;i++){r-=weights[i];if(r<=0)return i}return 0
  }
  function resolveCapture(event){
    const stage=STAGES[event.stageId],slot=event.slot,index=event.index;$('diagSlot').textContent=`${event.stageId.toUpperCase()} #${index+1} ${slot.label}`;
    if(slot.type==='UP'){physics.kickMotorOnUp(event.stageId);startTransfer(event.stageId,event.stageId==='s1'?'s2':'s3');return}
    if(slot.type==='JPC'){
      const released=pickHeldRelease();save();startTransfer('s3','jpc');if(released!==null)setMessage('JACKPOT CHANCE!',`HOLD #${released} を1球回収 → 天井へ`,900);return
    }
    if(slot.type==='SJPC'){startTransfer('jpc','sjpc');return}
    if(slot.type==='OUT'){
      app.lastResult='OUT';app.lastWin=0;soundOut();
      if(event.stageId==='s2'&&app.bet>=10){const got=diamondDraw();app.diamonds+=got;let bonus=0;if(app.diamonds>=8){app.diamonds-=8;bonus=app.diamondBonus;app.credit+=bonus;app.totalWin+=bonus;app.machineBank-=bonus}setMessage('DIAMOND CHANCE',got?`DIAMOND +${got}${bonus?` / BONUS ${bonus}`:''}`:'NO DIAMOND',1200);if(bonus>0){startPayout(bonus,false,'DIAMOND BONUS');return}}
      finishRoundSoon();return
    }
    let mult=slot.mult||1;if(slot.type==='Q')mult=weightedQuestion(event.stageId,app.roundRng,houseHeat(),app.holds.size);
    const win=Math.round(app.bet*mult);app.lastResult=slot.type==='Q'?`×? → ×${mult}`:`×${mult}`;app.lastWin=win;app.credit+=win;app.totalWin+=win;app.machineBank-=win;
    if(slot.type==='HOLD'){app.holds.add(index);save()}
    const jackpot=slot.type==='SJP';soundWin(mult);startPayout(win,jackpot,jackpot?'SUPER JACKPOT':slot.type==='HOLD'?'HOLD PAYOUT':'PAYOUT');
  }
  function finishRoundSoon(){app.phase='result';app.resolveTimer=.85;haptics.setOutput(0,null);save();renderUI()}
  function finishRound(){app.busy=false;app.phase='waiting';app.activeStage='s1';app.transfer=null;physics.trial=null;haptics.setOutput(0,null);hideMessage();save();renderUI()}

  function normalMilestoneSize(total){
    const R=PAYOUT_RULES;
    return total<R.normalMilestoneThreshold?R.normalMilestoneSmall:R.normalMilestoneLarge;
  }
  function normalMilestonePause(size){
    const R=PAYOUT_RULES;
    return size===R.normalMilestoneSmall?R.normalMilestonePauseSmall:R.normalMilestonePauseLarge;
  }
  function sjpBlockSize(total){
    const R=PAYOUT_RULES;
    if(total<=R.sjpBlockBreak1)return R.sjpBlockSmall;
    if(total<=R.sjpBlockBreak2)return R.sjpBlockMedium;
    if(total<=R.sjpBlockBreak3)return R.sjpBlockLarge;
    return R.sjpBlockHuge;
  }
  function sjpBlockPause(progress){
    const R=PAYOUT_RULES,p=clamp(progress,0,1);
    return R.sjpBlockPauseStart-(R.sjpBlockPauseStart-R.sjpBlockPauseEnd)*Math.pow(p,.75);
  }
  function sjpZeroGap(progress,finale){
    const R=PAYOUT_RULES;if(finale)return R.sjpFinalZero;
    const p=clamp(progress,0,1);
    return R.sjpZeroStart-(R.sjpZeroStart-R.sjpZeroEnd)*Math.pow(p,.85);
  }
  function sjpOnDuration(progress,finale){
    const R=PAYOUT_RULES;if(finale)return R.sjpFinalOn;
    const p=clamp(progress,0,1);
    return R.sjpOnStart-(R.sjpOnStart-R.sjpOnEnd)*Math.pow(p,.80);
  }
  function payoutChunk(p){
    const remain=p.remaining,total=p.total,progress=1-remain/Math.max(1,total),R=PAYOUT_RULES;
    if(p.jackpot){
      const lo=Math.max(R.jackpotMinFloor,Math.round(app.bet*R.jackpotMinBet));
      const hi=Math.min(R.jackpotChunkCap,Math.max(R.jackpotMaxFloor,Math.round(app.bet*R.jackpotMaxBet)));
      const eased=progress*progress*(3-2*progress);
      const raw=Math.max(1,Math.round((lo+(hi-lo)*eased)/5)*5);
      const blockRemain=Math.max(1,(p.blockTarget||remain)-(p.blockDelivered||0));
      return Math.min(remain,blockRemain,raw);
    }
    const base=clamp(Math.round(Math.sqrt(total)*R.normalChunkSqrt),R.normalChunkMin,R.normalChunkMax);
    const jitter=R.normalJitterMin+app.roundRng()*R.normalJitterSpan;
    const nominal=Math.max(1,Math.round(base*jitter));
    // Never jump across the next visible/countable medal boundary. A small remainder
    // pulse is allowed at the edge; this is real payout amount, not an added pulse.
    const toBoundary=p.milestoneSize?Math.max(1,p.milestoneNext-p.delivered):remain;
    return Math.min(remain,toBoundary,nominal);
  }
  function startPayout(total,jackpot,label){
    const blockSize=jackpot?sjpBlockSize(total):total;
    const blockCount=jackpot?Math.max(1,Math.ceil(total/blockSize)):1;
    const milestoneSize=jackpot?0:normalMilestoneSize(total);
    const milestoneCount=jackpot?0:Math.max(1,Math.ceil(total/milestoneSize));
    app.payout={total,remaining:total,jackpot,label,phase:'off',timer:.20,chunk:0,delivered:0,lastPreset:null,lastPower:0,
      blockSize,blockCount,blockIndex:1,blockDelivered:0,blockTarget:Math.min(blockSize,total),pulseInBlock:0,blockCompletePending:false,
      milestoneSize,milestoneCount,milestoneNext:milestoneSize,milestoneBreaks:0,milestoneCompletePending:false};
    app.phase='payout';setMessage(jackpot?'SUPER JACKPOT ×100!':label,jackpot?`${total} HAPTIC PAYOUT / ${blockCount} BLOCKS`:`${total} HAPTIC PAYOUT / ${milestoneSize}枚ごとに区切り`,jackpot?1600:850);renderUI()
  }
  function updatePayout(dt){
    const p=app.payout;if(!p)return;
    p.timer-=dt;if(p.timer>0)return;
    const R=PAYOUT_RULES;
    if(p.phase==='on'){
      haptics.setOutput(0,null);
      if(!p.jackpot&&p.milestoneCompletePending&&p.remaining>0){
        p.milestoneCompletePending=false;p.phase='amountGap';p.timer=normalMilestonePause(p.milestoneSize);renderUI();return
      }
      if(p.jackpot&&p.blockCompletePending&&p.remaining>0){
        p.blockCompletePending=false;p.phase='blockGap';p.timer=sjpBlockPause(p.delivered/Math.max(1,p.total));renderUI();return
      }
      const progress=p.delivered/Math.max(1,p.total),finale=p.jackpot&&p.blockIndex===p.blockCount;
      p.phase='off';p.timer=p.jackpot?sjpZeroGap(progress,finale):R.zeroGap;renderUI();return
    }
    if(p.phase==='amountGap'){
      p.milestoneBreaks+=1;p.milestoneNext=Math.min(p.total,p.milestoneNext+p.milestoneSize);p.phase='off';
    }
    if(p.phase==='blockGap'){
      p.blockIndex=Math.min(p.blockCount,p.blockIndex+1);p.blockDelivered=0;p.pulseInBlock=0;p.blockTarget=Math.min(p.blockSize,p.remaining);p.phase='off';
    }
    if(p.remaining<=0){app.payout=null;haptics.setOutput(0,null);setMessage('PAYOUT COMPLETE','',650);finishRoundSoon();return}
    const firstPulseInBlock=p.jackpot&&p.pulseInBlock===0;
    const chunk=payoutChunk(p);p.chunk=chunk;p.remaining-=chunk;p.delivered+=chunk;
    if(p.jackpot){p.blockDelivered+=chunk;p.pulseInBlock+=1;p.blockCompletePending=p.blockDelivered>=p.blockTarget}
    else if(p.milestoneSize){p.milestoneCompletePending=p.delivered>=p.milestoneNext&&p.remaining>0}
    const progress=p.delivered/Math.max(1,p.total);
    const blockProgress=p.jackpot?clamp(p.blockDelivered/Math.max(1,p.blockTarget),0,1):0;
    const finale=p.jackpot&&p.blockIndex===p.blockCount;
    const sizeNorm=clamp(chunk/(p.jackpot?Math.max(R.jackpotNormFloor,app.bet*R.jackpotNormBet):R.normalNorm),0,1);
    let hardness=clamp(R.hardnessBase+R.hardnessSpan*Math.pow(sizeNorm,R.hardnessExponent)+(p.jackpot?R.jackpotHardnessProgress*progress:0),0,1);
    let power=clamp(R.powerBase+R.powerSpan*Math.pow(sizeNorm,R.powerExponent)+(p.jackpot?R.jackpotPowerProgress*progress:0),0,100);
    if(p.jackpot){
      const powerFloor=R.sjpPowerFloorStart+(R.sjpPowerFloorEnd-R.sjpPowerFloorStart)*Math.pow(progress,R.sjpPowerFloorExponent);
      const hardnessFloor=R.sjpHardnessFloorStart+(R.sjpHardnessFloorEnd-R.sjpHardnessFloorStart)*Math.pow(progress,R.sjpHardnessFloorExponent);
      power=Math.max(power,powerFloor+R.sjpBlockRampPower*Math.pow(blockProgress,1.15)+(firstPulseInBlock?R.sjpBlockKickPower:0));
      hardness=Math.max(hardness,hardnessFloor+R.sjpBlockRampHardness*Math.pow(blockProgress,1.1)+(firstPulseInBlock?R.sjpBlockKickHardness:0));
      if(finale){
        const finalProgress=clamp(p.blockDelivered/Math.max(1,p.blockTarget),0,1);
        power=Math.max(power,R.sjpFinalPowerFloor+(100-R.sjpFinalPowerFloor)*Math.pow(finalProgress,.65));
        hardness=Math.max(hardness,R.sjpFinalHardnessFloor+(1-R.sjpFinalHardnessFloor)*Math.pow(finalProgress,.70));
      }
      power=clamp(power,0,100);hardness=clamp(hardness,0,1);
    }
    const preset=haptics.choosePreset(hardness);
    p.lastPreset=preset?.key||null;p.lastPower=power;
    haptics.setOutput(power,p.lastPreset);soundPayout(chunk,p.jackpot);p.phase='on';
    p.timer=p.jackpot?sjpOnDuration(progress,finale):Math.max(.16,R.normalCycle-R.zeroGap);
    renderUI()
  }

  function onHapticStatus(kind,text){if(kind==='ble'){$('bleStatus').textContent=text;$('bleTop').textContent='E-STIM DEVICE: '+(haptics.mode==='sim'?'SIM':haptics.ble.ready?'REAL ON':'REAL WAIT');$('bleTop').className='chip '+(haptics.ble.ready?'good':'')}else{$('waveStatus').textContent=text;$('waveStatusTop').textContent='PRESETS: '+text;$('waveStatusTop').className='chip '+(text.includes('24')?'good':'')}}
  function onRotatingStatus(text){if($('rotatingStatus'))$('rotatingStatus').textContent=text}
  function renderRotatingOutput(out){
    if(!$('rotatingSource'))return;
    $('rotatingSource').textContent=Math.round(out.source||0)+'%';
    $('rotatingTarget').textContent=Math.round(out.target||0)+'%';
    $('rotatingActual').textContent=Math.round(out.actual||0)+'%';
    $('rotatingDriveMode').textContent=out.intermittent?`断続 8Hz / DUTY ${Math.round((out.duty||0)*100)}%`:(out.target>0?'CONTINUOUS':'OFF');
  }
  function renderRank(ranked,source){const body=$('rankBody');if(!body)return;body.replaceChildren();for(let i=0;i<ranked.length;i++){const x=ranked[i],tr=document.createElement('tr');if(haptics?.output?.preset===x.key)tr.className='active';tr.innerHTML=`<td>${i+1}</td><td>${escapeHtml(x.label)}</td><td>${x.class}</td><td>${x.score.toFixed(1)}</td>`;body.appendChild(tr)}if(source)onHapticStatus('waves',source==='preset-live'?'PRESET 24 / LIVE':source==='cache'?'PRESET 24 / CACHE':`FALLBACK ${ranked.length}`)}
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function stimulusClassJa(c){return ({GENTLE:'やわらかい',SOFT:'弱め',SOLID:'中程度',HARD:'強め',SEVERE:'かなり強め'})[c]||c||'—'}
  function renderHapticOutput(out){
    const effective=Math.max(out.effectiveA||0,out.effectiveB||0);
    $('livePower').textContent=Math.round(out.power||0)+'%';
    $('liveAB').textContent=`A ${Math.round(out.effectiveA||0)}% / B ${Math.round(out.effectiveB||0)}%`;
    $('livePreset').textContent=out.label||'IDLE';
    $('liveMeta').textContent=out.preset?`${out.class} / ${stimulusClassJa(out.class)} / LOAD INDEX ${(out.score||0).toFixed(1)}`:'—';
    $('powerMeter').style.width=clamp(effective,0,100)+'%';
    renderRank(haptics.ranked);
  }
  function fitCanvas(id){
    const c=$(id),r=c.getBoundingClientRect(),d=Math.min(2,devicePixelRatio||1);
    const w=Math.max(2,Math.round(r.width*d)),h=Math.max(2,Math.round(r.height*d));
    if(c.width!==w||c.height!==h){c.width=w;c.height=h}
    const x=c.getContext('2d');x.setTransform(d,0,0,d,0,0);return {c,x,w:r.width,h:r.height,d};
  }
  function telemetryWindowMs(){return clamp(+$('scopeWindow')?.value||4000,1000,8000)}
  function sampleTelemetry(now){
    if(now-app.lastTelemetryAt<25)return;
    app.lastTelemetryAt=now;
    const s=haptics.frameSample(now);app.lastLiveSample=s;
    app.powerHistory.push({t:now,a:s.effectiveA,b:s.effectiveB});
    app.waveHistory.push({t:now,a:s.widthA,b:s.widthB,fa:s.hzA,fb:s.hzB,pa:s.effectiveA,pb:s.effectiveB});
    const ro=rotating.tick(now,s);
    if(rotating.settings.enabled)app.rotatingHistory.push({t:now,target:ro.target||0,actual:ro.actual||0});
    const keep=telemetryWindowMs()+350;
    while(app.powerHistory.length&&now-app.powerHistory[0].t>keep)app.powerHistory.shift();
    while(app.waveHistory.length&&now-app.waveHistory[0].t>keep)app.waveHistory.shift();
    while(app.rotatingHistory.length&&now-app.rotatingHistory[0].t>keep)app.rotatingHistory.shift();
    renderLiveSample(s);drawPowerHistory(now);drawWaveHistory(now);if(rotating.settings.enabled)drawRotatingHistory(now);
  }
  function renderLiveSample(s){
    const active=s.active&&(s.effectiveA>0||s.effectiveB>0);
    const testPrefix=s.test?`TEST ${String(s.testChannel||'').toUpperCase()} · `:'';
    $('livePower').textContent=Math.round(s.power||0)+'%';$('liveAB').textContent=`A ${Math.round(s.effectiveA||0)}% / B ${Math.round(s.effectiveB||0)}%`;$('livePreset').textContent=s.label||'IDLE';$('liveMeta').textContent=s.preset?`${testPrefix}${s.class} / ${stimulusClassJa(s.class)} / LEVEL ${Math.round(s.waveLevel||0)}%`:'—';$('powerMeter').style.width=clamp(Math.max(s.effectiveA||0,s.effectiveB||0),0,100)+'%';
    $('stimulusNow').textContent=active?`${testPrefix}${s.label} / ${s.class}（${stimulusClassJa(s.class)}）`:'待機 / OUTPUT ZERO';
    $('stimulusTech').textContent=active?`A ${Math.round(s.effectiveA)}% · ${s.hzA.toFixed(1)}Hz / WIDTH ${s.widthA}　|　B ${Math.round(s.effectiveB)}% · ${s.hzB.toFixed(1)}Hz / WIDTH ${s.widthB}`:'A/B OUTPUT ZERO';
    if(app.payout){
      const p=app.payout,finale=p.jackpot&&p.blockIndex===p.blockCount;
      const prefix=p.jackpot?(finale?'FINALE':`BLOCK ${p.blockIndex}/${p.blockCount}`):'';
      const idleLabel=p.phase==='blockGap'?'BLOCK BREAK / 区切り':p.phase==='off'?'PULSE GAP / 無出力区間':'IDLE';
      $('payoutLiveType').textContent=active?`${prefix?prefix+' · ':''}${s.label} / ${s.class}`:idleLabel;
      $('payoutLiveStrength').textContent=active?`${Math.round(s.power)}% CMD`:'0%';
      $('payoutLiveDetail').textContent=active?`A ${Math.round(s.effectiveA)}% / B ${Math.round(s.effectiveB)}% · ${s.hzA.toFixed(1)}/${s.hzB.toFixed(1)}Hz · WIDTH A${s.widthA}/B${s.widthB}`:`A 0% / B 0% · CHUNK ${p.chunk||0}`;
    }else{
      $('payoutLiveType').textContent='IDLE';$('payoutLiveStrength').textContent='0%';$('payoutLiveDetail').textContent='A 0% / B 0% · OUTPUT ZERO';
    }
  }
  function drawPowerHistory(now){
    const {x,w,h}=fitCanvas('powerHistoryCanvas'),windowMs=telemetryWindowMs(),hist=app.powerHistory;
    x.clearRect(0,0,w,h);x.fillStyle='#090705';x.fillRect(0,0,w,h);
    x.strokeStyle='#342719';x.lineWidth=1;
    for(const y of [.25,.5,.75]){x.beginPath();x.moveTo(0,h*y);x.lineTo(w,h*y);x.stroke()}
    const draw=(key,color)=>{
      x.strokeStyle=color;x.lineWidth=1.6;x.beginPath();let started=false;
      for(const q of hist){const age=now-q.t;if(age<0||age>windowMs)continue;const px=w-(age/windowMs)*w,py=h-3-clamp(q[key],0,100)/100*(h-6);if(!started){x.moveTo(px,py);started=true}else x.lineTo(px,py)}
      if(started)x.stroke();
    };
    draw('a','#ffd45f');draw('b','#67dcff');
  }
  function drawWaveHistory(now){
    const {x,w,h}=fitCanvas('waveformCanvas'),windowMs=telemetryWindowMs(),hist=app.waveHistory,mid=h/2;
    x.clearRect(0,0,w,h);x.fillStyle='#080604';x.fillRect(0,0,w,h);
    x.strokeStyle='#332619';x.lineWidth=1;x.beginPath();x.moveTo(0,mid);x.lineTo(w,mid);x.stroke();
    const barW=Math.max(1,Math.min(3,w/(windowMs/25)*.68));
    for(const q of hist){
      const age=now-q.t;if(age<0||age>windowMs)continue;const px=w-(age/windowMs)*w;
      const ah=(h*.42)*(clamp(q.a,0,100)/100),bh=(h*.42)*(clamp(q.b,0,100)/100);
      const aa=.14+.86*(clamp(q.pa,0,100)/100),ba=.14+.86*(clamp(q.pb,0,100)/100);
      x.fillStyle=`rgba(255,212,95,${aa})`;x.fillRect(px-barW/2,mid-ah,barW,ah);
      x.fillStyle=`rgba(103,220,255,${ba})`;x.fillRect(px-barW/2,mid,barW,bh);
      if(q.pa>0&&q.a>0){const dots=Math.max(1,Math.min(4,Math.round(q.fa/25)));x.fillStyle=`rgba(255,246,190,${aa})`;for(let j=0;j<dots;j++)x.fillRect(px-1,mid-ah+(j+.5)*ah/dots,2,1)}
      if(q.pb>0&&q.b>0){const dots=Math.max(1,Math.min(4,Math.round(q.fb/25)));x.fillStyle=`rgba(205,247,255,${ba})`;for(let j=0;j<dots;j++)x.fillRect(px-1,mid+(j+.5)*bh/dots,2,1)}
    }
    x.font='700 8px system-ui';x.fillStyle='#d2b177';x.fillText('A',4,9);x.fillStyle='#79dfff';x.fillText('B',4,h-3);
  }

  function drawRotatingHistory(now){
    if(!$('rotatingCanvas')||!rotating.settings.enabled)return;
    const {x,w,h}=fitCanvas('rotatingCanvas'),windowMs=telemetryWindowMs(),hist=app.rotatingHistory;
    x.clearRect(0,0,w,h);x.fillStyle='#050805';x.fillRect(0,0,w,h);
    x.strokeStyle='#26331d';x.lineWidth=1;for(const y of [.25,.5,.75]){x.beginPath();x.moveTo(0,h*y);x.lineTo(w,h*y);x.stroke()}
    const draw=(key,color,width)=>{x.strokeStyle=color;x.lineWidth=width;x.beginPath();let started=false;for(const q of hist){const age=now-q.t;if(age<0||age>windowMs)continue;const px=w-(age/windowMs)*w,py=h-3-clamp(q[key],0,100)/100*(h-6);if(!started){x.moveTo(px,py);started=true}else x.lineTo(px,py)}if(started)x.stroke()};
    draw('target','#8aa86b',1.1);draw('actual','#c9f18e',1.8);
  }

  function renderRotatingPanel(){
    const panel=$('rotatingPanel');if(!panel)return;panel.hidden=!app.rotatingUnlocked;if(!app.rotatingUnlocked)return;
    $('rotatingEnabled').checked=rotating.settings.enabled;$('rotatingMin').value=rotating.settings.min;$('rotatingMax').value=rotating.settings.max;$('rotatingMinOut').textContent=Math.round(rotating.settings.min)+'%';$('rotatingMaxOut').textContent=Math.round(rotating.settings.max)+'%';$('rotatingConnectMode').value=rotating.settings.connectionMode;
    $('rotatingGraphWrap').hidden=!rotating.settings.enabled;panel.classList.toggle('mode-on',rotating.settings.enabled);
    if(!rotating.settings.enabled)$('rotatingStatus').textContent=rotating.ble.ready?'CONNECTED / MODE OFF':'HIDDEN MODE / OFF';
  }

  async function factoryReset(){
    if(!confirm('ゲーム進行・CREDIT・HOLD・各LIMIT・接続設定を初期状態へ戻しますか？\nプリセット刺激のキャッシュだけは保持します。'))return;
    try{await haptics.emergency();await rotating.zero();await haptics.resetSettings({preservePresets:true});await rotating.resetSettings()}catch(e){console.warn('reset zero failed',e)}
    localStorage.removeItem(STORE);location.reload();
  }

  function renderDiamonds(){const r=$('diamondRow');r.replaceChildren();for(let i=0;i<8;i++){const d=document.createElement('i');d.className='diamond '+(i<app.diamonds?'on':'');r.appendChild(d)}$('diamondBonusValue').textContent=app.diamondBonus}
  function renderUI(){
    $('creditDisplay').textContent=String(Math.floor(app.credit)).padStart(4,'0');$('betDisplay').textContent=String(app.bet).padStart(2,'0');$('lastResult').textContent=app.lastResult;$('lastWin').textContent=app.lastWin;$('holdCount').textContent=`${app.holds.size} / 4`;$('payoutRemain').textContent=app.payout?.remaining||0;renderDiamonds();
    const locked=app.busy||haptics.panic||haptics.test.active;$('insertMedals').disabled=app.busy;$('testA').disabled=app.busy||haptics.panic;$('testB').disabled=app.busy||haptics.panic;$('betMinus').disabled=locked;$('betPlus').disabled=locked;document.querySelectorAll('[data-bet]').forEach(b=>b.disabled=locked);$('launchButton').disabled=locked||app.credit<app.bet;
    $('activeStage').textContent=STAGES[app.activeStage]?.name||'—';$('stageState').textContent=app.phase.toUpperCase();
    const m=physics.motors[app.activeStage]||physics.motors.s1;$('diagMotor').textContent=`${m.direction>0?'CW':'CCW'} M${m.mode+1} / ${physics.period(app.activeStage).toFixed(1)}s`;$('diagSwings').textContent=physics.trial?.swings||0;
    $('profileChip').textContent=physics.profileId==='early'?'2010 / EARLY':'LATE / DYNAMIC';$('physicsProfile').value=physics.profileId;$('diamondBonus').value=app.diamondBonus;$('audioVolume').value=Math.round(app.audioVolume*100);$('estimConnectMode').value=haptics.settings.connectionMode;renderRotatingPanel();
    if(app.payout){
      const p=app.payout,pct=100*p.delivered/p.total,finale=p.jackpot&&p.blockIndex===p.blockCount;
      $('payoutMeter').style.width=pct+'%';$('payoutChunk').textContent='+'+(p.chunk||0);
      $('payoutClass').textContent=p.jackpot?(finale?'SJP FINALE':'SJP PAYOUT'):p.label;$('payoutClass').className='chip '+(p.jackpot?'hot':'good');
      $('payoutCounter').textContent=`${p.delivered} / ${p.total}`;$('payoutProgressText').textContent=pct.toFixed(0)+'%';
      $('payoutBlockRow').hidden=false;
      if(p.jackpot){
        $('payoutBlockRow').classList.toggle('finale',finale);
        $('payoutBlock').textContent=finale?`FINALE ${p.blockIndex}/${p.blockCount}`:`SJP BLOCK ${p.blockIndex} / ${p.blockCount}`;
        $('payoutBlockAmount').textContent=`${p.blockDelivered} / ${p.blockTarget} 枚`;
      }else{
        $('payoutBlockRow').classList.remove('finale');
        $('payoutBlock').textContent=`${p.milestoneSize}枚 COUNT`;
        const next=Math.min(p.total,p.milestoneNext);
        $('payoutBlockAmount').textContent=p.phase==='amountGap'?`BREAK ${p.delivered} / ${p.total} 枚`:`NEXT ${next} / ${p.total} 枚`;
      }
    }else{
      $('payoutMeter').style.width='0%';$('payoutChunk').textContent='+0';$('payoutClass').textContent='IDLE';$('payoutClass').className='chip';$('payoutCounter').textContent='0 / 0';$('payoutProgressText').textContent='0%';$('payoutBlockRow').hidden=true;$('payoutBlockRow').classList.remove('finale');$('payoutBlock').textContent='—';$('payoutBlockAmount').textContent='—';
    }
  }

  function fixedStep(dt){
    physics.stepMotors(dt);
    if(app.phase==='launchDelay'){app.launchTimer-=dt;if(app.launchTimer<=0){soundLaunch();beginStage('s1')}}
    else if(app.phase==='rolling'){const ev=physics.stepTrial(dt);if(ev){app.phase='captured';app.resolveTimer=CAPTURE_DWELL;if(physics.trial)physics.trial.captureAge=0;renderUI()}}
    else if(app.phase==='captured'){app.resolveTimer-=dt;if(physics.trial)physics.trial.captureAge+=dt;if(app.resolveTimer<=0)resolveCapture(physics.lastCapture)}
    else if(app.phase==='transfer')updateTransfer(dt);
    else if(app.phase==='payout')updatePayout(dt);
    else if(app.phase==='result'){app.resolveTimer-=dt;if(app.resolveTimer<=0)finishRound()}
  }
  function resizeCanvas(){const c=$('machineCanvas'),r=c.getBoundingClientRect(),d=Math.min(2,devicePixelRatio||1);const w=Math.max(480,Math.round(r.width*d)),h=Math.max(420,Math.round(r.height*d));if(c.width!==w||c.height!==h){c.width=w;c.height=h}}
  function draw(){const c=$('machineCanvas'),d=Math.min(2,devicePixelRatio||1),W=c.width/d,H=c.height/d,ctx=c.getContext('2d');ctx.setTransform(d,0,0,d,0,0);drawMachine(ctx,W,H,physics,app.activeStage,app.holds,app.transfer,Boolean($('debugHitbox')?.checked))}
  function loop(now){const dt=Math.min(.05,(now-app.lastNow)/1000);app.lastNow=now;app.acc+=dt;while(app.acc>=FIXED){fixedStep(FIXED);app.acc-=FIXED}resizeCanvas();draw();haptics.tick(now);sampleTelemetry(now);renderDiagnostics();requestAnimationFrame(loop)}
  function renderDiagnostics(){
    const m=physics.motors[app.activeStage]||physics.motors.s1;
    $('diagMotor').textContent=`${m.direction>0?'CW':'CCW'} M${m.mode+1} / ${physics.period(app.activeStage).toFixed(1)}s`;
    $('diagSwings').textContent=physics.trial?.swings||0;
    const near=physics.currentSlot(),t=physics.trial;if(!near||t?.captured)return;
    const st=STAGES[app.activeStage];
    if(t?.engaged){$('diagSlot').textContent=`SEATED #${near.index+1} ${near.slot.label} / OFFSET ${(Math.abs(t.captureLocal||0)*180/Math.PI).toFixed(1)}°`;return}
    const prof=physics.carrierProfile(app.activeStage,t.theta);
    if(st&&!st.overhead){
      const gate=physics.gateGeometry(app.activeStage),inGate=Math.abs(KZ_PHYSICS.angleDiff(t.theta,gate.theta))<gate.half;
      $('diagSlot').textContent=`BALL #${prof.nearest.index+1} ${prof.nearest.slot.label} / ${inGate?'GATE':'RAIL'} / ${prof.inVisibleCavity?'CAVITY':'TOOTH'} / LOCAL ${(Math.abs(prof.local)*180/Math.PI).toFixed(1)}°`;
    }else $('diagSlot').textContent=`BALL #${prof.nearest.index+1} ${prof.nearest.slot.label} / ${prof.inVisibleCavity?'CAVITY':'TOOTH'} / LOCAL ${(Math.abs(prof.local)*180/Math.PI).toFixed(1)}°`;
  }

  function bind(){
    $('insertMedals').onclick=()=>{if(app.busy)return;app.credit+=100;save();renderUI();tone(560,.045,.02,'square');tone(680,.045,.018,'square',.045)};
    $('betMinus').onclick=()=>setBet(app.bet-1);$('betPlus').onclick=()=>setBet(app.bet+1);document.querySelectorAll('[data-bet]').forEach(b=>b.onclick=()=>setBet(+b.dataset.bet));$('launchButton').onclick=startRound;
    $('physicsProfile').onchange=e=>{if(app.busy){e.target.value=physics.profileId;return}physics.setProfile(e.target.value);save();renderUI()};
    $('diamondBonus').onchange=e=>{app.diamondBonus=clamp(e.target.value,1,999);save();renderUI()};$('audioVolume').oninput=e=>{app.audioVolume=clamp(e.target.value,0,100)/100;save()};
    $('limitA').value=haptics.settings.limitA;$('limitB').value=haptics.settings.limitB;$('channelA').checked=haptics.settings.channelA;$('channelB').checked=haptics.settings.channelB;const limits=()=>{haptics.setLimits($('limitA').value,$('limitB').value);$('limitAOut').textContent=$('limitA').value+'%';$('limitBOut').textContent=$('limitB').value+'%'};$('limitA').oninput=limits;$('limitB').oninput=limits;limits();
    const chans=()=>haptics.setChannels($('channelA').checked,$('channelB').checked);$('channelA').onchange=chans;$('channelB').onchange=chans;
    $('estimConnectMode').value=haptics.settings.connectionMode;$('estimConnectMode').onchange=e=>haptics.setConnectionMode(e.target.value);
    $('simMode').onclick=async()=>{await haptics.setMode('sim');$('simMode').classList.add('active');$('realMode').classList.remove('active');$('connectButton').disabled=true};
    $('realMode').onclick=async()=>{await haptics.setMode('real');$('realMode').classList.add('active');$('simMode').classList.remove('active');$('connectButton').disabled=false};$('connectButton').onclick=()=>haptics.connect($('estimConnectMode').value);$('disconnectButton').onclick=()=>haptics.disconnect();
    const bindHoldTest=(id,channel)=>{const b=$(id);const start=e=>{if(app.busy||haptics.panic)return;e.preventDefault();b.setPointerCapture?.(e.pointerId);haptics.beginTest(channel);b.classList.add('testing')};const stop=async e=>{if(e)e.preventDefault();b.classList.remove('testing');await haptics.endTest()};b.addEventListener('pointerdown',start);['pointerup','pointercancel','lostpointercapture'].forEach(ev=>b.addEventListener(ev,stop));b.addEventListener('pointerleave',e=>{if(e.buttons)stop(e)})};bindHoldTest('testA','a');bindHoldTest('testB','b');
    $('panicButton').onclick=async()=>{if(!haptics.panic){await haptics.emergency();await rotating.zero();setMessage('EMERGENCY STOP','E-STIM DEVICE OUTPUT ZERO / ゲーム外停止');$('panicButton').textContent='RESET STOP'}else{haptics.clearEmergency();$('panicButton').textContent='EMERGENCY STOP';if(!app.busy)hideMessage()}renderUI()};
    $('scopeWindow').onchange=()=>{app.powerHistory=[];app.waveHistory=[];app.rotatingHistory=[];app.lastTelemetryAt=0};
    $('syncWaves').onclick=()=>haptics.syncWaves();$('factoryReset').onclick=factoryReset;
    $('rotatingEnabled').onchange=e=>{rotating.setEnabled(e.target.checked);app.rotatingHistory=[];renderRotatingPanel()};
    $('rotatingConnectMode').onchange=e=>rotating.setConnectionMode(e.target.value);$('rotatingConnect').onclick=()=>rotating.connect($('rotatingConnectMode').value);$('rotatingDisconnect').onclick=()=>rotating.disconnect();
    const rotatingLimits=()=>{let mn=+$('rotatingMin').value,mx=+$('rotatingMax').value;if(mn>mx){if(document.activeElement===$('rotatingMin'))mx=mn;else mn=mx;$('rotatingMin').value=mn;$('rotatingMax').value=mx}rotating.setLimits(mn,mx);renderRotatingPanel()};$('rotatingMin').oninput=rotatingLimits;$('rotatingMax').oninput=rotatingLimits;
    $('secretTitle').addEventListener('click',()=>{const now=performance.now();app.secretClicks=app.secretClicks.filter(t=>now-t<3200);app.secretClicks.push(now);if(app.secretClicks.length>=5){app.rotatingUnlocked=true;app.secretClicks=[];save();renderRotatingPanel();setMessage('HIDDEN OUTPUT UNLOCKED','ROTIATING DEVICE',1100)}});
window.addEventListener('keydown',async e=>{if(e.key==='Escape'){e.preventDefault();if(!haptics.panic){await haptics.emergency();await rotating.zero();setMessage('EMERGENCY STOP','E-STIM DEVICE OUTPUT ZERO');$('panicButton').textContent='RESET STOP';renderUI()}}});window.addEventListener('blur',()=>haptics.endTest());document.addEventListener('visibilitychange',()=>{if(document.hidden){haptics.endTest();rotating.zero()}});window.addEventListener('pagehide',()=>{haptics.sendZeroRepeat();rotating.zero()});
    new ResizeObserver(resizeCanvas).observe($('machineCanvas').parentElement);
  }
  async function init(){load();if(!app.rotatingUnlocked&&rotating.settings.enabled)rotating.setEnabled(false);physics.setProfile(physics.profileId);bind();renderUI();renderHapticOutput(haptics.publicOutput());renderRotatingOutput(rotating.last);renderLiveSample(haptics.frameSample(performance.now()));setMessage('READY','BETと発射タイミングだけを決めます',900);requestAnimationFrame(loop);haptics.syncWaves()}
  init();
})();
