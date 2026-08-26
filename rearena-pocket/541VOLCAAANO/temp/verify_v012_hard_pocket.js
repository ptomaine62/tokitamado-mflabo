'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const base=__dirname; global.window=global;
for(const f of ['js/kazaaan-data.js','js/kazaaan-physics.js']) vm.runInThisContext(fs.readFileSync(path.join(base,f),'utf8'),{filename:f});
const {KazaaanPhysicsEngine}=global.KZ_PHYSICS;
let pass=0,fail=0,lines=[];
function ok(name,cond,detail=''){(cond?pass++:fail++);lines.push(`${cond?'PASS':'FAIL'} — ${name}${detail?` / ${detail}`:''}`)}
const src=fs.readFileSync(path.join(base,'js/kazaaan-physics.js'),'utf8');
ok('Old soft engaged lerp is removed',!src.includes('const target=CAVITY_FLOOR_SCALE+.040')&&!src.includes('t.radial=lerp(t.radial,target'));
ok('Hard pocket floor restitution exists',src.includes('CAVITY_FLOOR_RESTITUTION=.14'));
ok('Hard pocket side-wall restitution exists',src.includes('CAVITY_WALL_RESTITUTION=.20'));
ok('Pocket keeps relative tangential velocity',src.includes('engagedLocalV=t.velocity-motorOmega'));
ok('Captured render has no soft inward interpolation',!src.includes('dwellPhase')&&!src.includes('seatedScale=lerp'));
ok('Hard pocket applies gravity after lip entry',src.includes('pocketDropAccel')&&src.includes('t.radialV-=pocketDropAccel*dt'));
let resolved=0, floorHit=0, wallHit=0, maxAge=0, maxFloor=0, maxWall=0, unresolved=0;
for(let n=0;n<1200;n++){
  const e=new KazaaanPhysicsEngine(global.KZ_DATA); e.motors.s1.phase=(n*.381966*Math.PI*2)%(Math.PI*2); e.startStage('s1',(0x12345678+n*1103515245)>>>0,new Set());
  let ev=null;
  for(let i=0;i<120*30&&!ev;i++){e.stepMotors(1/120);ev=e.stepTrial(1/120)}
  if(!ev){unresolved++;continue} resolved++;
  const f=ev.pocketFloorHits||0,w=ev.pocketWallHits||0; floorHit+=f>0; wallHit+=w>0; maxFloor=Math.max(maxFloor,f);maxWall=Math.max(maxWall,w);maxAge=Math.max(maxAge,e.trial?.engagedAge||0);
}
ok('Hard-pocket model still resolves all sampled 1ST balls',unresolved===0,`resolved=${resolved} unresolved=${unresolved}`);
ok('Every sampled seated ball makes a hard floor contact',floorHit===resolved,`floor-contact captures=${floorHit}/${resolved}`);
ok('Side walls can physically participate without being mandatory',wallHit>0&&wallHit<resolved,`wall-contact captures=${wallHit}/${resolved}`);
ok('Pocket bounce settles quickly, not float for seconds',maxAge<=.70,`max engaged age=${maxAge.toFixed(3)}s`);
ok('Floor bounce count remains bounded',maxFloor<=4,`max floor impacts=${maxFloor}`);
ok('Wall bounce count remains bounded',maxWall<=5,`max wall impacts=${maxWall}`);
console.log(lines.join('\n'));console.log(`\nV0.12 HARD POCKET RESULT: ${fail?'FAIL':'PASS'} — ${pass} passed / ${fail} failed`);process.exitCode=fail?1:0;
