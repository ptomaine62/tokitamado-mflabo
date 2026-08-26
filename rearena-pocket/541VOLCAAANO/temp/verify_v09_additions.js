const fs=require('fs'),vm=require('vm');
let pass=0,fail=0; const out=[];
function check(name,ok,detail=''){(ok?pass++:fail++);out.push(`${ok?'PASS':'FAIL'} — ${name}${detail?' / '+detail:''}`)}
const app=fs.readFileSync('js/app.js','utf8');
const phy=fs.readFileSync('js/kazaaan-physics.js','utf8');
const data=fs.readFileSync('js/kazaaan-data.js','utf8');
const hap=fs.readFileSync('js/haptics.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('style.css','utf8');

check('UP physics has no UP-specific force branch',!/slot\.type\s*===?\s*['"]UP['"]/.test(phy));
check('UP aperture is geometry-only width .84',/slot\('UP','UP',\{width:\.84\}\)/.test(data));
check('Transfer uses current followed captured angle',/physics\.capturedBallAngle\(from,trial\.captureIndex,trial\.captureLocal\)/.test(app));
check('Transfer no longer starts unconditionally from fixed gate',!/const startAngle\s*=\s*physics\.gatePoint/.test(app));
check('Desktop machine column is capped near half viewport',/\.machine-column\{width:min\(760px,50vw\)\}/.test(css));
check('Desktop overall layout is capped',/max-width:1140px/.test(css));
check('Continuous telemetry samples at 25 ms cadence',/now-app\.lastTelemetryAt<25/.test(app));
check('Power history stores LIMIT-applied A/B',/powerHistory\.push\(\{t:now,a:s\.effectiveA,b:s\.effectiveB\}\)/.test(app));
check('Wave history stores WIDTH/Frequency/Power A/B',/waveHistory\.push\(\{t:now,a:s\.widthA,b:s\.widthB,fa:s\.hzA,fb:s\.hzB,pa:s\.effectiveA,pb:s\.effectiveB\}\)/.test(app));
for(const id of ['powerHistoryCanvas','waveformCanvas','scopeWindow','stimulusNow','stimulusTech','payoutLiveType','payoutLiveStrength','payoutLiveDetail']) check(`Telemetry DOM exists: ${id}`,new RegExp(`id=["']${id}["']`).test(html));
check('Payout normal chunk baseline restored',/normalChunkSqrt:1\.9,normalChunkMin:8,normalChunkMax:60/.test(app));
check('Payout JP chunk baseline restored',/jackpotMinFloor:12,jackpotMinBet:\.35,jackpotMaxFloor:55,jackpotMaxBet:1\.15,jackpotChunkCap:150/.test(app));
check('Power mapping baseline restored',/powerBase:10,powerSpan:78,powerExponent:\.68,jackpotPowerProgress:8/.test(app));
check('Hardness mapping baseline restored',/hardnessBase:\.08,hardnessSpan:\.78,hardnessExponent:\.72,jackpotHardnessProgress:\.12/.test(app));
check('Explicit ~95ms zero gap restored',/zeroGap:\.095/.test(app));
check('Waveform ranking baseline weights restored',/\.25\*x\.ndose\+\.20\*x\.navgW\+\.13\*x\.npeak\+\.13\*x\.ndensity\+\.09\*x\.nhiDensity\+\.20\*x\.nabrupt/.test(hap));
check('Anti-repeat last-3 penalty restored',/this\.lastPresets\.includes\(x\.key\)\?\.22:0/.test(hap));

// Haptics runtime sample: constant command must still expose evolving 25ms frame data and LIMIT-applied A/B.
let now=1000;const store={};
const ctx={console,Uint8Array,Math,performance:{now:()=>now},localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=String(v)},setTimeout:(f)=>f(),navigator:{},fetch:async()=>{throw Error('offline')},window:{}};
vm.createContext(ctx);vm.runInContext(hap,ctx);
const H=ctx.window.KZ_HAPTICS.HapticController,h=new H();
h.settings.limitA=30;h.settings.limitB=60;h.setOutput(80,'BUBBLE');
const s0=h.frameSample(now);now+=25;const s1=h.frameSample(now);now+=75;const s2=h.frameSample(now);
check('Runtime effective Power respects A/B LIMIT',s0.effectiveA===24&&s0.effectiveB===48,`A=${s0.effectiveA} B=${s0.effectiveB}`);
check('Runtime 25ms subslot advances under constant Power',s0.subslot!==s1.subslot,`${s0.subslot}->${s1.subslot}`);
check('Runtime 100ms raw frame advances under constant Power',s0.rawIndexA!==s2.rawIndexA,`${s0.rawIndexA}->${s2.rawIndexA}`);
const b0=h.makeB0(h.output.raw[0],h.output.raw[1]);
check('Runtime B0 remains 20 bytes with LIMIT-applied strength',b0.length===20&&b0[2]===48&&b0[3]===96,`len=${b0.length} A=${b0[2]} B=${b0[3]}`);

// Followed-pocket continuity: after motor moves during the 0.9s dwell, the current captured angle must move too.
const ctx2={console,Math,window:{},crypto:{getRandomValues:a=>{a[0]=123456789;return a}}};vm.createContext(ctx2);
vm.runInContext(data,ctx2);vm.runInContext(phy,ctx2);
const P=ctx2.window.KZ_PHYSICS.KazaaanPhysicsEngine,pe=new P(ctx2.window.KZ_DATA);
pe.startStage('s1',123,new Set()); const t=pe.trial;t.captured=true;t.captureIndex=0;t.captureLocal=.03;t.captureRadial=.80;
const oldTheta=t.theta; const a0=pe.capturedBallAngle('s1',0,.03);pe.stepMotors(.90);const a1=pe.capturedBallAngle('s1',0,.03);
check('Captured followed angle changes while motor turns during dwell',Math.abs(ctx2.window.KZ_PHYSICS.angleDiff(a1,a0))>.01,`delta=${Math.abs(ctx2.window.KZ_PHYSICS.angleDiff(a1,a0)).toFixed(4)} rad`);
check('Frozen trial.theta is not used as current followed position',Math.abs(ctx2.window.KZ_PHYSICS.angleDiff(a1,oldTheta))>.01);

console.log(out.join('\n'));console.log(`\nADDITIONAL RESULT: ${fail?'FAIL':'PASS'} — ${pass} passed / ${fail} failed`);process.exitCode=fail?1:0;
