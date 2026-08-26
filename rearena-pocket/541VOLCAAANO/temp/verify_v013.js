'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.resolve(__dirname,'..'); global.window=global; global.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
for(const f of ['js/kazaaan-data.js','js/kazaaan-physics.js','js/haptics.js','js/rotating.js']) vm.runInThisContext(fs.readFileSync(path.join(root,f),'utf8'),{filename:f});
let pass=0,fail=0,lines=[];function ok(n,c,d=''){c?pass++:fail++;lines.push(`${c?'PASS':'FAIL'} — ${n}${d?' / '+d:''}`)}
const physSrc=fs.readFileSync(path.join(root,'js/kazaaan-physics.js'),'utf8');
const hapSrc=fs.readFileSync(path.join(root,'js/haptics.js'),'utf8');
const rotSrc=fs.readFileSync(path.join(root,'js/rotating.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
ok('Solid surface uses visible-radius radial support',physSrc.includes('solidSupportScale')&&physSrc.includes('SOLID_SUPPORT_RADIUS_FACTOR'));
ok('Solid collision uses predicted next radial position',physSrc.includes('const predicted=t.radial+t.radialV*dt'));
ok('No new UP-specific force branch',!(/slot\.type\s*===\s*['"]UP['"][\s\S]{0,180}(velocity|radialV|acc)/.test(physSrc)));
ok('UP remains width-only model in data',global.KZ_DATA.STAGES.s1.slots.filter(x=>x.type==='UP').every(x=>x.width===.84));
let results={};
for(const sid of ['s1','s2','s3']){
 let unresolved=0,counts={},dark=0,maxStreak=0;
 for(let n=0;n<700;n++){
  const e=new global.KZ_PHYSICS.KazaaanPhysicsEngine(global.KZ_DATA);e.motors[sid].phase=(n*.381966*Math.PI*2)%(Math.PI*2);e.startStage(sid,(0x7113+n*2654435761)>>>0,new Set());let ev=null;
  for(let i=0;i<120*35&&!ev;i++){e.stepMotors(1/120);ev=e.stepTrial(1/120)}
  if(!ev){unresolved++;continue} counts[ev.slot.type]=(counts[ev.slot.type]||0)+1;dark+=ev.darkHits||0;maxStreak=Math.max(maxStreak,ev.maxContactStreak||0);
 }
 results[sid]={unresolved,counts,dark,maxStreak};
 ok(`${sid} physics resolves 700 samples`,unresolved===0,JSON.stringify(counts));
 ok(`${sid} solid contacts do not chatter`,maxStreak<=2,`max streak=${maxStreak}`);
}
ok('1ST still produces both UP and OUT',results.s1.counts.UP>0&&results.s1.counts.OUT>0,JSON.stringify(results.s1.counts));
ok('2ND still produces UP/OUT/payout types',results.s2.counts.UP>0&&results.s2.counts.OUT>0&&(results.s2.counts.WIN>0||results.s2.counts.Q>0),JSON.stringify(results.s2.counts));

const H=new global.KZ_HAPTICS.HapticController();H.settings.limitA=30;H.settings.limitB=60;H.beginTest('a');const t0=H.test.startAt;let ep=H.effectivePowers(t0+1750);ok('HOLD TEST A 50% envelope maps within A LIMIT',Math.abs(ep.a-15)<.01&&ep.b===0,`A=${ep.a} B=${ep.b}`);ep=H.effectivePowers(t0+3500);ok('HOLD TEST A reaches configured A LIMIT only',Math.abs(ep.a-30)<.01&&ep.b===0,`A=${ep.a}`);H.test.active=false;
H.setOutput(80,H.ranked[Math.floor(H.ranked.length*.8)]?.key);ep=H.effectivePowers(performance.now());ok('E-STIM proportional LIMIT mapping retained',Math.abs(ep.a-24)<.01&&Math.abs(ep.b-48)<.01,`A=${ep.a} B=${ep.b}`);
ok('E-STIM connection has AUTO and MANUAL chooser paths',hapSrc.includes("mode==='manual'")&&hapSrc.includes('acceptAllDevices:true')&&hapSrc.includes('getDevices'));
ok('E-STIM explicit disconnect is present',hapSrc.includes('async disconnect()'));

const R=new global.KZ_ROTATING.RotatingController();R.settings.enabled=true;R.setLimits(8,100);
let m=R.mapping({active:true,power:55,waveLevel:60});ok('ROTIATING source is POWER + wave LEVEL and saturates easily',m.source===100&&m.target===100,`source=${m.source} target=${m.target}`);
m=R.mapping({active:true,power:5,waveLevel:0});ok('ROTIATING MIN/MAX mapping gives nonzero floor',m.target>8&&m.target<100,`target=${m.target.toFixed(2)}`);
let ph=R.physicalFor(20,0);ok('ROTIATING <=25% enters intermittent mode',ph.intermittent===true&&ph.duty>0&&ph.duty<=1,`actual=${ph.actual} duty=${ph.duty}`);
ph=R.physicalFor(26,0);ok('ROTIATING >25% is continuous',ph.intermittent===false&&ph.actual===26);
ok('ROTIATING packet format is A0 03 power 00 00 00 AA',rotSrc.includes('0xA0,0x03,power,0x00,0x00,0x00,0xAA'));
ok('ROTIATING uses FFA0/FFA1 BLE UUIDs',rotSrc.includes('0000ffa0-0000-1000-8000-00805f9b34fb')&&rotSrc.includes('0000ffa1-0000-1000-8000-00805f9b34fb'));
ok('ROTIATING send cadence is ~20Hz',rotSrc.includes('now-this.ble.lastSend<48'));
ok('Hidden panel exists and graph is conditional',html.includes('id="rotatingPanel"')&&html.includes('id="rotatingGraphWrap" hidden')&&html.includes('id="rotatingCanvas"'));
ok('Factory reset UI exists',html.includes('id="factoryReset"')&&fs.readFileSync(path.join(root,'js/app.js'),'utf8').includes('async function factoryReset'));
ok('Runtime UI has no DG-LAB branding',!html.toLowerCase().includes('dg-lab')&&!fs.readFileSync(path.join(root,'js/app.js'),'utf8').toLowerCase().includes('dg-lab'));
ok('Generic preset stimulus UI is present',html.includes('PRESET STIMULI')&&html.includes('プリセット刺激24種を同期'));
console.log(lines.join('\n'));console.log(`\nV0.13 RESULT: ${fail?'FAIL':'PASS'} — ${pass} passed / ${fail} failed`);process.exitCode=fail?1:0;
