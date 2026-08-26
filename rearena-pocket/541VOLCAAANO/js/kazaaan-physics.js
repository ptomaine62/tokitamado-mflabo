(function(){
  'use strict';
  const TAU=Math.PI*2;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const norm=a=>{a%=TAU;if(a<0)a+=TAU;return a};
  const angleDiff=(a,b)=>{let d=norm(a-b);if(d>Math.PI)d-=TAU;return d};
  const lerp=(a,b,t)=>a+(b-a)*t;
  const smooth=t=>t*t*(3-2*t);
  // v0.8: one geometry model drives rail gap, carrier cavities, drawing and collision.
  // There are no hidden gate widths, no off-screen capture margins and no time-based
  // force-to-result helpers. A ball can fall only where the rendered fixed gate and
  // the rendered moving cavity overlap at the ball's own angular position.
  const CARRIER_OUTER_SCALE=1.035;
  const CARRIER_INNER_SCALE=.765;
  const CAVITY_FLOOR_SCALE=.815;
  const CAVITY_MOUTH_RATIO=.76;
  // Same base radius used by the canvas ball. Physics therefore treats the ball
  // as a finite sphere/circle rather than a zero-size point at the cavity lip.
  const BALL_RADIUS_NORM=.010;
  // v0.13: solid carrier contact uses the visible ball radius in the radial direction too.
  // This prevents the drawn sphere centre from sinking into dark/solid material.
  // It does NOT shrink the cavity opening; entrance width is still controlled only by the
  // shared cavity contour + finite tangential ball radius.
  const SOLID_SUPPORT_RADIUS_FACTOR=.76;
  const CARRIER_TOP_RESTITUTION=.12;
  const CAVITY_ENGAGE_SCALE=.925;
  // v0.12: once the ball is below the cavity lip it is simulated inside a hard
  // pocket. It falls onto a rigid floor, can tap the side wall, and loses its
  // relative motion through low-restitution impacts instead of being lerped/sucked.
  const CAVITY_FLOOR_CENTER_SCALE=CAVITY_FLOOR_SCALE+.026;
  const CAVITY_FLOOR_RESTITUTION=.14;
  const CAVITY_WALL_RESTITUTION=.20;
  const CAVITY_MIN_SETTLE=.16;
  const CAVITY_MAX_SETTLE=.62;
  function seedRng(seed){let a=(seed>>>0)||0x9e3779b9;return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296}};
  function randomSeed(){try{const b=new Uint32Array(1);crypto.getRandomValues(b);return b[0]>>>0}catch(_){return (Date.now()^Math.floor(Math.random()*0xffffffff))>>>0}}

  class KazaaanPhysicsEngine{
    constructor(data){
      this.data=data;
      this.profileId='early';
      this.profile=data.MOTOR_PROFILES.early;
      this.motorRng=seedRng(randomSeed());
      this.motors={};
      const directions={s1:1,s2:-1,s3:1,jpc:-1,sjpc:1};
      Object.keys(data.STAGES).forEach((id,i)=>{
        this.motors[id]={phase:(i*.83)%TAU,mode:(id==='s1'||id==='s2')?1:0,direction:directions[id]||1,nextChange:7+this.motorRng()*8};
      });
      this.trial=null;
      this.lastCapture=null;
    }
    setProfile(id){this.profileId=this.data.MOTOR_PROFILES[id]?id:'early';this.profile=this.data.MOTOR_PROFILES[this.profileId]}
    period(id){const arr=this.profile[id]||[18];const m=this.motors[id];return arr[clamp(m.mode,0,arr.length-1)]||arr[0]}
    snapshotMotors(){const out={};for(const [id,m] of Object.entries(this.motors))out[id]={phase:m.phase,mode:m.mode,direction:m.direction,period:this.period(id)};return out}
    stepMotors(dt){
      for(const [id,m] of Object.entries(this.motors)){
        const p=this.period(id);m.phase=norm(m.phase+m.direction*TAU/p*dt);
        if(this.profile.dynamic&&(id==='s1'||id==='s2')){
          m.nextChange-=dt;
          if(m.nextChange<=0){
            const r=this.motorRng();let next=m.mode+(r<.42?-1:r>.72?1:0);next=clamp(next,0,(this.profile[id]||[]).length-1);m.mode=next;m.nextChange=5.5+this.motorRng()*10.5;
          }
        }
      }
    }
    kickMotorOnUp(fromStage){
      if(!this.profile.dynamic)return;
      if(fromStage==='s1'||fromStage==='s2'){
        const m=this.motors[fromStage];m.mode=clamp(m.mode+1,0,(this.profile[fromStage]||[]).length-1);m.nextChange=3.5+this.motorRng()*5;
        const other=fromStage==='s1'?'s2':'s1';const o=this.motors[other];if(this.motorRng()<.45){o.mode=clamp(o.mode+(this.motorRng()<.5?-1:1),0,(this.profile[other]||[]).length-1);o.nextChange=4+this.motorRng()*7}
      }
    }
    startStage(stageId,seed,holds,options={}){
      const stage=this.data.STAGES[stageId],rng=seedRng((seed^stageId.length*0x45d9f3b)>>>0),p=stage.physics,g=stage.geometry;
      const entered=Boolean(options.entry);
      const theta=Number.isFinite(options.theta)?options.theta:(entered?(g.entryTheta??g.launchTheta):g.launchTheta);
      let velocity;
      if(Number.isFinite(options.velocity)) velocity=options.velocity;
      else if(entered){const dir=theta<(g.midTheta??Math.PI/2)?1:-1;velocity=Math.abs(p.launchVelocity)*(.76+rng()*.10)*dir;}
      else velocity=p.launchVelocity*(.94+rng()*.12);
      this.trial={stageId,seed,rng,time:0,theta,velocity,radial:1.085,radialV:0,swings:0,lastVelSign:Math.sign(velocity)||1,captured:false,captureIndex:-1,captureAge:0,captureLocal:0,captureRadial:CAVITY_FLOOR_CENTER_SCALE,engaged:false,engagedIndex:-1,engagedAge:0,engagedLocalV:0,pocketFloorHits:0,pocketWallHits:0,pocketFloorContact:false,holds:new Set(holds||[]),trail:[],edgeHits:0,lipHits:0,darkHits:0,gateCrossings:0,atGate:false,carrierContact:false,lastCarrierOpen:false,lastCarrierImpactAt:-99,lastCarrierImpactTheta:theta,maxContactStreak:0,contactStreak:0};
      return this.trial;
    }
    slotAtAngle(stageId,angle){
      const stage=this.data.STAGES[stageId],m=this.motors[stageId],n=stage.count;
      let best=null;
      for(let i=0;i<n;i++){
        const a=norm(m.phase+i*TAU/n),d=Math.abs(angleDiff(angle,a));
        if(!best||d<best.d)best={index:i,d,angle:a,slot:stage.slots[i]};
      }
      return best;
    }
    currentSlot(){
      const t=this.trial;if(!t)return null;
      const stage=this.data.STAGES[t.stageId];
      if(t.engaged&&t.engagedIndex>=0){
        const cg=this.cavityGeometry(t.stageId,t.engagedIndex);
        return {index:t.engagedIndex,d:Math.abs(t.captureLocal||0),angle:cg.center,slot:stage.slots[t.engagedIndex]};
      }
      // Diagnostics and physics now inspect the carrier directly under the BALL,
      // never a proxy sample at the centre of the fixed gate.
      return this.slotAtAngle(t.stageId,t.theta);
    }
    cavityGeometry(stageId,index){
      const stage=this.data.STAGES[stageId];
      const sector=TAU/stage.count;
      const slot=stage.slots[index];
      const cavityHalf=sector*.5*CAVITY_MOUTH_RATIO*(slot.width||1);
      const center=norm(this.motors[stageId].phase+index*sector);
      return {
        index,slot,sector,center,cavityHalf,
        left:norm(center-cavityHalf),right:norm(center+cavityHalf),
        outerScale:CARRIER_OUTER_SCALE,
        innerScale:CARRIER_INNER_SCALE,
        floorScale:CAVITY_FLOOR_SCALE
      };
    }
    ballAngularRadius(stageId,radialScale=CARRIER_OUTER_SCALE){
      const g=this.data.STAGES[stageId].geometry;
      // At the gate, tangential screen distance per radian is approximately rx*W.
      // BALL_RADIUS_NORM*W is the same base radius used to draw the ball, so the
      // centre-contact envelope corresponds to the visible ball touching the wall.
      return clamp(BALL_RADIUS_NORM/Math.max(.001,g.rx*radialScale),.002,.22);
    }
    solidSupportScale(stageId){
      const g=this.data.STAGES[stageId].geometry;
      // Approximate the visible screen-space ball radius along the radial direction.
      // Capped to avoid turning small upper crunes into an artificially oversized wall.
      const margin=clamp((BALL_RADIUS_NORM/Math.max(.035,g.ry))*SOLID_SUPPORT_RADIUS_FACTOR,.025,.11);
      return CARRIER_OUTER_SCALE+margin;
    }
    cavityEngageScale(stageId){
      // Shift the engage threshold outward by exactly the same centre offset used
      // for solid support. This preserves the old physical drop distance and avoids
      // making narrow UP cells artificially harder merely because the visible ball
      // radius is now respected on the solid surface.
      const oldSupport=CARRIER_OUTER_SCALE+.006;
      return CAVITY_ENGAGE_SCALE+(this.solidSupportScale(stageId)-oldSupport);
    }
    carrierProfile(stageId,angle){
      const nearest=this.slotAtAngle(stageId,angle);
      const cavity=this.cavityGeometry(stageId,nearest.index);
      const local=angleDiff(angle,cavity.center);
      const blocked=stageId==='s3'&&this.trial?.holds?.has(nearest.index);
      const ballMargin=this.ballAngularRadius(stageId,CARRIER_OUTER_SCALE);
      const captureHalf=Math.max(.001,cavity.cavityHalf-ballMargin);
      const inVisibleCavity=!blocked&&Math.abs(local)<cavity.cavityHalf;
      const inCaptureCavity=!blocked&&Math.abs(local)<captureHalf;
      return {...cavity,nearest,local,blocked,ballMargin,captureHalf,inVisibleCavity,inCaptureCavity};
    }
    gateGeometry(stageId){
      const stage=this.data.STAGES[stageId],g=stage.geometry;
      const theta=g.captureTheta??g.midTheta??Math.PI/2;
      const half=Math.max(.001,g.gateHalfTheta??.04*Math.PI);
      return {theta,half,left:theta-half,right:theta+half};
    }
    stepTrial(dt){
      const t=this.trial;if(!t||t.captured)return null;
      const stage=this.data.STAGES[t.stageId],p=stage.physics,g=stage.geometry,rng=t.rng;
      t.time+=dt;

      // v0.12 HARD POCKET: after the visible ball has passed below the lip, keep
      // simulating it inside that SAME cell. The ball has a relative tangential
      // velocity, rigid side walls and a rigid floor. No centre snap / no soft lerp.
      if(t.engaged&&!t.captured&&t.engagedIndex>=0){
        t.engagedAge+=dt;
        const cg=this.cavityGeometry(t.stageId,t.engagedIndex);
        const motorOmega=this.motors[t.stageId].direction*TAU/this.period(t.stageId);
        const usableHalf=Math.max(.001,cg.cavityHalf-this.ballAngularRadius(t.stageId,CARRIER_OUTER_SCALE));

        // Relative motion inside the moving cell. Air/rolling losses are mild until
        // floor contact; once on the hard floor the relative sliding dies quickly.
        t.captureLocal+=t.engagedLocalV*dt;
        if(Math.abs(t.captureLocal)>usableHalf){
          const side=Math.sign(t.captureLocal)||1;
          t.captureLocal=side*usableHalf;
          if(t.engagedLocalV*side>0){
            t.engagedLocalV=-t.engagedLocalV*CAVITY_WALL_RESTITUTION;
            t.pocketWallHits++;
          }
        }

        const pocketDropAccel=(stage.physics.dropAccel??2.5)*1.55;
        t.radialV-=pocketDropAccel*dt;
        t.radial+=t.radialV*dt;
        if(t.radial<=CAVITY_FLOOR_CENTER_SCALE){
          t.radial=CAVITY_FLOOR_CENTER_SCALE;
          if(t.radialV<0){
            const impact=-t.radialV;
            if(impact>.045){
              t.radialV=impact*CAVITY_FLOOR_RESTITUTION;
              t.pocketFloorHits++;
              t.engagedLocalV*=.52;
            }else t.radialV=0;
          }
          t.pocketFloorContact=true;
        }else t.pocketFloorContact=false;

        t.radialV*=Math.exp(-1.7*dt);
        t.engagedLocalV*=Math.exp(-(t.pocketFloorContact?9.0:1.1)*dt);
        t.theta=norm(cg.center+t.captureLocal);
        t.velocity=motorOmega+t.engagedLocalV;
        t.trail.push({theta:t.theta,radial:t.radial});if(t.trail.length>32)t.trail.shift();

        const settled=t.pocketFloorContact&&Math.abs(t.radialV)<.055&&Math.abs(t.engagedLocalV)<.16;
        if((t.engagedAge>=CAVITY_MIN_SETTLE&&settled)||t.engagedAge>=CAVITY_MAX_SETTLE){
          t.radial=CAVITY_FLOOR_CENTER_SCALE;t.radialV=0;t.engagedLocalV=0;
          t.captureRadial=t.radial;
          t.captured=true;t.captureIndex=t.engagedIndex;t.captureAge=0;
          const slot=stage.slots[t.captureIndex];
          this.lastCapture={stageId:t.stageId,index:t.captureIndex,slot,time:t.time,swings:t.swings,edgeHits:t.edgeHits,lipHits:t.lipHits,darkHits:t.darkHits,gateCrossings:t.gateCrossings,angle:cg.center,ballTheta:t.theta,captureLocal:t.captureLocal,maxContactStreak:t.maxContactStreak,pocketFloorHits:t.pocketFloorHits,pocketWallHits:t.pocketWallHits};
          return {type:'capture',...this.lastCapture};
        }
        return null;
      }

      // Tangential motion is a damped oscillation on the fixed rail. There is no
      // elapsed-time strengthening of the spring: the same mechanical equation is
      // used from launch until capture.
      const displacement=t.theta-g.midTheta;
      const omega0=TAU*p.naturalHz;
      let acc=-(omega0*omega0)*displacement-2*p.damping*omega0*t.velocity;
      acc+=(rng()-.5)*p.roughness;
      t.velocity+=acc*dt;t.theta+=t.velocity*dt;
      const min=(g.railMinTheta??.055*Math.PI),max=(g.railMaxTheta??.945*Math.PI);
      if(t.theta<min){t.theta=min+(min-t.theta);t.velocity=Math.abs(t.velocity)*(.60+rng()*.08);t.edgeHits++}
      if(t.theta>max){t.theta=max-(t.theta-max);t.velocity=-Math.abs(t.velocity)*(.60+rng()*.08);t.edgeHits++}
      const sign=Math.sign(t.velocity)||t.lastVelSign;if(sign!==t.lastVelSign&&Math.abs(t.velocity)<.55){t.swings++;t.lastVelSign=sign}

      const profile=this.carrierProfile(t.stageId,t.theta);
      let nearest=profile.nearest,open=false,insideGate=false;
      if(stage.overhead){
        // Ceiling roulettes now use the same rendered cavity contour as collision.
        insideGate=true;
        open=profile.inCaptureCavity;
      }else{
        const gate=this.gateGeometry(t.stageId);
        insideGate=Math.abs(angleDiff(t.theta,gate.theta))<gate.half;
        open=insideGate&&profile.inCaptureCavity;
        if(insideGate&&!t.atGate)t.gateCrossings++;
        t.atGate=insideGate;
      }

      // Radial motion: outside the fixed opening the rail supports the ball. Inside
      // it, gravity can lower the ball. If the moving carrier presents solid material
      // instead of a cavity, the visible top surface catches the ball. No hidden
      // tangential kick, no theta teleport, and no time-based "eventual capture".
      const dropAccel=p.dropAccel??2.5;
      const carrierTop=this.solidSupportScale(t.stageId);
      let radialResolved=false;
      if(!stage.overhead&&!insideGate){
        const railTarget=1.075;
        t.radialV+=(railTarget-t.radial)*p.railSpring*dt;
        t.carrierContact=false;
      }else{
        t.radialV-=dropAccel*dt;
        // Continuous contact check: test the next centre position against the solid
        // support surface so one 120-Hz frame cannot visibly tunnel into a tooth.
        const predicted=t.radial+t.radialV*dt;
        if(!open&&predicted<=carrierTop){
          const impact=Math.max(0,-t.radialV);
          t.radial=carrierTop;
          t.radialV=impact>.10?impact*CARRIER_TOP_RESTITUTION:0;
          radialResolved=true;
          if(!t.carrierContact){
            t.darkHits++;
            // Crossing from a cavity to a solid partition while partly lowered is
            // a lip contact, but it does not arbitrarily reverse tangential motion.
            if(t.lastCarrierOpen||Math.abs(profile.local)-profile.cavityHalf<profile.sector*.08)t.lipHits++;
            const samePlace=(t.time-t.lastCarrierImpactAt)<.42&&Math.abs(angleDiff(t.theta,t.lastCarrierImpactTheta))<profile.sector*.12;
            t.contactStreak=samePlace?t.contactStreak+1:1;
            t.maxContactStreak=Math.max(t.maxContactStreak,t.contactStreak);
            t.lastCarrierImpactAt=t.time;t.lastCarrierImpactTheta=t.theta;
          }
          // Resting on the same solid top for multiple 120 Hz frames is one contact,
          // not hundreds of repeated bounces.
          t.carrierContact=true;
        }else if(open){
          t.carrierContact=false;
          t.contactStreak=0;
        }
      }
      t.lastCarrierOpen=open;

      t.radialV*=Math.exp(-2.0*dt);
      if(!radialResolved)t.radial+=t.radialV*dt;
      else t.radial+=Math.max(0,t.radialV)*dt;
      t.radial=clamp(t.radial,.70,1.13);
      t.trail.push({theta:t.theta,radial:t.radial});if(t.trail.length>32)t.trail.shift();

      // Engage only after the finite-size BALL itself is below the visible lip.
      // From this point the selected physical cell is fixed, but the ball is NOT
      // snapped to its centre: its entry offset and relative velocity enter the
      // hard-pocket simulation above. The same rule is used for all five stages.
      if(open&&t.time>.55&&t.radial<=this.cavityEngageScale(t.stageId)){
        const cg=this.cavityGeometry(t.stageId,nearest.index);
        const local=angleDiff(t.theta,cg.center);
        if(Math.abs(local)<profile.captureHalf){
          const motorOmega=this.motors[t.stageId].direction*TAU/this.period(t.stageId);
          t.captureLocal=local;
          t.engagedLocalV=t.velocity-motorOmega;
          t.engaged=true;t.engagedIndex=nearest.index;t.engagedAge=0;
          t.pocketFloorHits=0;t.pocketWallHits=0;t.pocketFloorContact=false;
          // Preserve actual downward velocity; only ensure it is genuinely entering.
          t.radialV=Math.min(t.radialV,-.10);
        }
        return null;
      }
      return null;
    }
    ballPoint(stageId,theta,radial,W,H){
      const g=this.data.STAGES[stageId].geometry,cx=g.cx*W,cy=g.cy*H,rx=g.rx*W*radial,ry=g.ry*H*radial;
      return {x:cx+Math.cos(theta)*rx,y:cy+Math.sin(theta)*ry,z:Math.sin(theta)};
    }
    slotPoint(stageId,index,W,H,scale=.88){
      const st=this.data.STAGES[stageId],m=this.motors[stageId],a=norm(m.phase+index*TAU/st.count);
      return ellipsePoint(st.geometry,a,W,H,scale);
    }
    capturedBallAngle(stageId,index,localOffset=0){
      const st=this.data.STAGES[stageId],m=this.motors[stageId];
      return norm(m.phase+index*TAU/st.count+(Number(localOffset)||0));
    }
    capturedBallPoint(stageId,index,localOffset,radialScale,W,H){
      const st=this.data.STAGES[stageId];
      const a=this.capturedBallAngle(stageId,index,localOffset);
      return ellipsePoint(st.geometry,a,W,H,radialScale||CAVITY_FLOOR_SCALE+.055);
    }
    gatePoint(stageId,W,H,scale=.93){
      const g=this.data.STAGES[stageId].geometry,a=g.captureTheta??g.midTheta??Math.PI/2;
      return ellipsePoint(g,a,W,H,scale);
    }
    entryPoint(stageId,W,H){
      const g=this.data.STAGES[stageId].geometry,a=g.entryTheta??g.launchTheta;
      return this.ballPoint(stageId,a,1.085,W,H);
    }
  }

  const POCKET_LABEL_FONT_PX=12;
  function ellipsePoint(g,theta,W,H,scale=1){return{x:g.cx*W+Math.cos(theta)*g.rx*W*scale,y:g.cy*H+Math.sin(theta)*g.ry*H*scale,z:Math.sin(theta)}}
  function pathEllipse(ctx,cx,cy,rx,ry,start=0,end=TAU){ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,0,start,end)}
  function drawFlame(ctx,x,y,s,alpha=.8){ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.fillStyle=`rgba(255,74,15,${alpha})`;ctx.beginPath();ctx.moveTo(0,18);ctx.bezierCurveTo(-13,8,-5,-8,0,-22);ctx.bezierCurveTo(4,-11,15,-6,9,6);ctx.bezierCurveTo(18,2,17,13,0,18);ctx.fill();ctx.fillStyle=`rgba(255,208,45,${alpha*.8})`;ctx.beginPath();ctx.moveTo(0,13);ctx.bezierCurveTo(-6,4,1,-4,3,-10);ctx.bezierCurveTo(9,1,9,8,0,13);ctx.fill();ctx.restore()}

  function drawMachine(ctx,W,H,engine,activeStage,holds,transfer,debugContour=false){
    const data=engine.data;ctx.clearRect(0,0,W,H);
    const bg=ctx.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#110807');bg.addColorStop(.55,'#2b0c05');bg.addColorStop(1,'#080403');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
    const tower=ctx.createRadialGradient(W*.5,H*.10,0,W*.5,H*.15,W*.25);tower.addColorStop(0,'#ff9a2435');tower.addColorStop(1,'#ff2d0000');ctx.fillStyle=tower;ctx.fillRect(W*.25,0,W*.5,H*.30);
    drawFlame(ctx,W*.43,H*.105,1.4,.45);drawFlame(ctx,W*.57,H*.105,1.4,.45);drawFlame(ctx,W*.50,H*.042,1.8,.55);

    const drawTier=(id)=>{
      const st=data.STAGES[id],g=st.geometry,cx=g.cx*W,cy=g.cy*H,rx=g.rx*W,ry=g.ry*H;

      if(st.overhead){
        ctx.save();ctx.globalAlpha=(activeStage===id||activeStage==='jpc'||activeStage==='sjpc')?1:.72;
        ctx.fillStyle=id==='sjpc'?'#3b130b':'#58190c';pathEllipse(ctx,cx,cy,rx*1.18,ry*1.55);ctx.fill();
        ctx.strokeStyle='#ff7d27';ctx.lineWidth=2;ctx.stroke();ctx.restore();
      }else{
        const bodyY=cy+ry*.10,bodyH=(id==='s1'?H*.18:id==='s2'?H*.145:H*.10);
        const grad=ctx.createLinearGradient(0,bodyY,0,bodyY+bodyH);grad.addColorStop(0,id==='s3'?'#8c1e0c':'#4a150a');grad.addColorStop(1,'#100705');ctx.fillStyle=grad;
        ctx.beginPath();ctx.moveTo(cx-rx*.91,bodyY);ctx.lineTo(cx+rx*.91,bodyY);ctx.lineTo(cx+rx*.72,bodyY+bodyH);ctx.lineTo(cx-rx*.72,bodyY+bodyH);ctx.closePath();ctx.fill();ctx.strokeStyle='#73240d';ctx.lineWidth=2;ctx.stroke();
      }

      // One carrier contour for ALL five stages. The visible cavity polygons below
      // are generated from cavityGeometry(), the same function used by collision.
      ctx.save();
      ctx.fillStyle=st.overhead?(id==='sjpc'?'#7c2a12':'#8a3213'):(id==='s3'?'#a74a16':'#8b3a12');
      pathEllipse(ctx,cx,cy,rx*CARRIER_OUTER_SCALE,ry*CARRIER_OUTER_SCALE);ctx.fill();
      ctx.fillStyle='#170a05';pathEllipse(ctx,cx,cy,rx*CARRIER_INNER_SCALE,ry*CARRIER_INNER_SCALE);ctx.fill();

      const cavityItems=[];
      for(let i=0;i<st.count;i++){
        const cg=engine.cavityGeometry(id,i);
        const blocked=id==='s3'&&holds&&holds.has(i);
        const steps=12,outer=[],inner=[];
        for(let k=0;k<=steps;k++){
          const a=cg.center-cg.cavityHalf+(2*cg.cavityHalf)*(k/steps);
          outer.push(ellipsePoint(g,a,W,H,CARRIER_OUTER_SCALE+.004));
          inner.push(ellipsePoint(g,a,W,H,CAVITY_FLOOR_SCALE));
        }
        ctx.beginPath();ctx.moveTo(outer[0].x,outer[0].y);
        for(let k=1;k<outer.length;k++)ctx.lineTo(outer[k].x,outer[k].y);
        for(let k=inner.length-1;k>=0;k--)ctx.lineTo(inner[k].x,inner[k].y);
        ctx.closePath();
        let fill='#24110a',stroke='#bb6a2b',color='#f6d7a7';
        if(cg.slot.type==='OUT'){fill='#4b0d09';stroke='#c8402a';color='#ffb1a1'}
        if(['UP','JPC','SJPC','SJP'].includes(cg.slot.type)){fill='#472306';stroke='#ffd33c';color='#fff0a1'}
        if(blocked){fill='#c67d18';stroke='#fff0a6';color='#2b1500'}
        ctx.fillStyle=fill;ctx.strokeStyle=stroke;ctx.lineWidth=1.25;ctx.fill();ctx.stroke();
        const lo=ellipsePoint(g,cg.center-cg.cavityHalf,W,H,CAVITY_FLOOR_SCALE),l1=ellipsePoint(g,cg.center-cg.cavityHalf,W,H,CARRIER_OUTER_SCALE);
        const ro=ellipsePoint(g,cg.center+cg.cavityHalf,W,H,CAVITY_FLOOR_SCALE),r1=ellipsePoint(g,cg.center+cg.cavityHalf,W,H,CARRIER_OUTER_SCALE);
        ctx.strokeStyle='#ee8b37';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(lo.x,lo.y);ctx.lineTo(l1.x,l1.y);ctx.stroke();ctx.beginPath();ctx.moveTo(ro.x,ro.y);ctx.lineTo(r1.x,r1.y);ctx.stroke();
        const labelP=ellipsePoint(g,cg.center,W,H,(CAVITY_FLOOR_SCALE+CARRIER_OUTER_SCALE)*.5);
        cavityItems.push({i,cg,blocked,labelP,color});
      }
      ctx.strokeStyle='#ef7725';ctx.lineWidth=2.6;pathEllipse(ctx,cx,cy,rx*CARRIER_OUTER_SCALE,ry*CARRIER_OUTER_SCALE);ctx.stroke();ctx.restore();

      cavityItems.sort((a,b)=>a.labelP.z-b.labelP.z);
      for(const item of cavityItems){
        const text=item.blocked?'HOLD':item.cg.slot.label;
        ctx.save();ctx.font=`900 ${POCKET_LABEL_FONT_PX}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=2.6;ctx.strokeStyle='#120904';ctx.strokeText(text,item.labelP.x,item.labelP.y);ctx.fillStyle=item.color;ctx.fillText(text,item.labelP.x,item.labelP.y);ctx.restore();
        if(item.blocked){const hp=ellipsePoint(g,item.cg.center,W,H,.885);ctx.fillStyle='#d9d0b8';ctx.beginPath();ctx.arc(hp.x,hp.y,Math.max(5,ry*.16),0,TAU);ctx.fill();ctx.strokeStyle='#fff4d0';ctx.stroke()}
      }

      if(!st.overhead){
        // The rendered fixed opening and the physics gate are the SAME gateGeometry.
        const railStart=g.railMinTheta??.055*Math.PI,railEnd=g.railMaxTheta??.945*Math.PI;
        const gate=engine.gateGeometry(id);
        ctx.save();
        const railStroke=(width,color)=>{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.beginPath();ctx.ellipse(cx,cy,rx*1.085,ry*1.085,0,railStart,gate.left);ctx.stroke();ctx.beginPath();ctx.ellipse(cx,cy,rx*1.085,ry*1.085,0,gate.right,railEnd);ctx.stroke()};
        railStroke(Math.max(5,ry*.10),'#c99d55');railStroke(1.2,'#fff0bf55');
        // Draw the exact angular gate as a dark wedge; there is no second visual width.
        const steps=10,outer=[],inner=[];
        for(let k=0;k<=steps;k++){const a=gate.left+(gate.right-gate.left)*(k/steps);outer.push(ellipsePoint(g,a,W,H,1.105));inner.push(ellipsePoint(g,a,W,H,CARRIER_OUTER_SCALE+.006))}
        ctx.beginPath();ctx.moveTo(outer[0].x,outer[0].y);for(let k=1;k<outer.length;k++)ctx.lineTo(outer[k].x,outer[k].y);for(let k=inner.length-1;k>=0;k--)ctx.lineTo(inner[k].x,inner[k].y);ctx.closePath();ctx.fillStyle='#050303';ctx.fill();ctx.strokeStyle='#f0a63388';ctx.lineWidth=1.2;ctx.stroke();ctx.restore();
      }

      if(debugContour){
        ctx.save();ctx.strokeStyle='rgba(72,235,255,.95)';ctx.lineWidth=1.2;ctx.setLineDash([4,3]);
        for(let i=0;i<st.count;i++){
          const cg=engine.cavityGeometry(id,i);
          for(const a of [cg.center-cg.cavityHalf,cg.center+cg.cavityHalf]){const p0=ellipsePoint(g,a,W,H,CAVITY_FLOOR_SCALE),p1=ellipsePoint(g,a,W,H,CARRIER_OUTER_SCALE+.015);ctx.beginPath();ctx.moveTo(p0.x,p0.y);ctx.lineTo(p1.x,p1.y);ctx.stroke()}
          // Yellow lines are not a second arbitrary hitbox: they are exactly one
          // rendered-ball radius inside the cyan cavity walls, i.e. ball-centre
          // contact positions when the visible sphere touches a wall.
          const margin=engine.ballAngularRadius(id,CARRIER_OUTER_SCALE),usable=Math.max(.001,cg.cavityHalf-margin);
          ctx.save();ctx.strokeStyle='rgba(255,225,80,.86)';ctx.setLineDash([2,3]);
          for(const a of [cg.center-usable,cg.center+usable]){const p0=ellipsePoint(g,a,W,H,CAVITY_FLOOR_SCALE),p1=ellipsePoint(g,a,W,H,CARRIER_OUTER_SCALE+.015);ctx.beginPath();ctx.moveTo(p0.x,p0.y);ctx.lineTo(p1.x,p1.y);ctx.stroke()}
          ctx.restore();
        }
        if(!st.overhead){
          const gate=engine.gateGeometry(id);ctx.strokeStyle='rgba(255,90,220,.95)';ctx.setLineDash([6,4]);
          for(const a of [gate.left,gate.right]){const p0=ellipsePoint(g,a,W,H,CARRIER_OUTER_SCALE-.03),p1=ellipsePoint(g,a,W,H,1.12);ctx.beginPath();ctx.moveTo(p0.x,p0.y);ctx.lineTo(p1.x,p1.y);ctx.stroke()}
        }
        ctx.restore();
      }

      if(activeStage===id){ctx.strokeStyle='#ffe35b';ctx.lineWidth=2;ctx.setLineDash([7,7]);pathEllipse(ctx,cx,cy,rx*1.10,ry*1.19);ctx.stroke();ctx.setLineDash([])}
    };

    drawTier('s1');drawTier('s2');drawTier('s3');drawTier('jpc');drawTier('sjpc');

    const drawRamp=(from,to,side)=>{
      if(data.STAGES[from].overhead)return;
      const gate=engine.gatePoint(from,W,H,.93),entry=engine.entryPoint(to,W,H);
      let mouth;
      if(side==='right')mouth={x:W*(data.STAGES[from].geometry.cx+data.STAGES[from].geometry.rx*.72),y:H*(data.STAGES[from].geometry.cy-.01)};
      else if(side==='left')mouth={x:W*(data.STAGES[from].geometry.cx-data.STAGES[from].geometry.rx*.66),y:H*(data.STAGES[from].geometry.cy-.02)};
      else mouth={x:gate.x,y:H*(data.STAGES[from].geometry.cy-data.STAGES[from].geometry.ry*.86)};
      ctx.strokeStyle='#8a5628';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(gate.x,gate.y);ctx.quadraticCurveTo((gate.x+mouth.x)/2,gate.y-10,mouth.x,mouth.y);ctx.stroke();
      ctx.strokeStyle='#d89b3c';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(mouth.x,mouth.y);ctx.bezierCurveTo((mouth.x+entry.x)/2+28,mouth.y-30,(mouth.x+entry.x)/2-22,entry.y+24,entry.x,entry.y);ctx.stroke();ctx.strokeStyle='#ffe2a0';ctx.lineWidth=1.5;ctx.stroke();
    };
    drawRamp('s1','s2','right');drawRamp('s2','s3','left');drawRamp('s3','jpc','center');

    if(engine.trial&&engine.trial.stageId===activeStage){
      const t=engine.trial;
      let p=null,r=7;
      if(!t.captured){
        for(let i=0;i<t.trail.length;i++){const q=engine.ballPoint(activeStage,t.trail[i].theta,t.trail[i].radial,W,H);ctx.fillStyle=`rgba(255,194,67,${.02+.12*i/t.trail.length})`;ctx.beginPath();ctx.arc(q.x,q.y,3+2*q.z,0,TAU);ctx.fill()}
        p=engine.ballPoint(activeStage,t.theta,t.radial,W,H);r=clamp(W*.010*(.75+.35*p.z),5,10);
      }else if(t.captureIndex>=0){
        // v0.12: after the hard floor impact has settled, hold the ball rigidly at
        // the physical resting point in the revolving cell. No post-capture float,
        // no soft inward interpolation, and no centre snap.
        p=engine.capturedBallPoint(activeStage,t.captureIndex,t.captureLocal,t.captureRadial,W,H);
        r=clamp(W*.010*(.75+.35*p.z),5,10);
      }
      if(p){const grad=ctx.createRadialGradient(p.x-r*.35,p.y-r*.35,1,p.x,p.y,r);grad.addColorStop(0,'#fff8d0');grad.addColorStop(.35,'#e8d7ad');grad.addColorStop(1,'#6f675b');ctx.fillStyle=grad;ctx.beginPath();ctx.arc(p.x,p.y,r,0,TAU);ctx.fill();ctx.strokeStyle='#fff4d3';ctx.lineWidth=1;ctx.stroke()}
    }
    if(transfer){const q=transfer.point(W,H);const r=7;ctx.fillStyle='#e6d8b5';ctx.beginPath();ctx.arc(q.x,q.y,r,0,TAU);ctx.fill();ctx.strokeStyle='#fff4d0';ctx.stroke()}

    ctx.textAlign='center';ctx.fillStyle='#ffbf27';ctx.font='900 15px system-ui';ctx.fillText('3RD',W*.5,H*.205);ctx.fillStyle='#ff7f27';ctx.font='800 12px system-ui';ctx.fillText('JACKPOT CHANCE → CEILING ROULETTE',W*.5,H*.156);
  }

  window.KZ_PHYSICS={KazaaanPhysicsEngine,drawMachine,seedRng,randomSeed,clamp,norm,angleDiff,lerp,smooth,CARRIER_OUTER_SCALE,CARRIER_INNER_SCALE,CAVITY_FLOOR_SCALE,CAVITY_MOUTH_RATIO,BALL_RADIUS_NORM,SOLID_SUPPORT_RADIUS_FACTOR,CARRIER_TOP_RESTITUTION,CAVITY_ENGAGE_SCALE,CAVITY_FLOOR_CENTER_SCALE,CAVITY_FLOOR_RESTITUTION,CAVITY_WALL_RESTITUTION,CAVITY_MIN_SETTLE,CAVITY_MAX_SETTLE};
})();
