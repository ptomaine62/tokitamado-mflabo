(function(){
  'use strict';
  const slot=(type,label,extra={})=>({type,label,...extra});
  // Initial 100&MEDAL KAZAAAN!! pocket order. 2nd-stage order follows the
  // contemporaneous explicit strategy diagram; counts are also corroborated
  // by multiple reference descriptions. See RESEARCH_AUDIT.md.
  const STAGES={
    s1:{
      id:'s1',name:'1ST STAGE',count:18,
      slots:Array.from({length:18},(_,i)=>i%3===0?slot('UP','UP',{width:.84}):slot('OUT','OUT',{width:1.00})),
      geometry:{cx:.50,cy:.725,rx:.405,ry:.128,bodyTop:.64,trackScale:1.03,launchTheta:.13*Math.PI,entryTheta:.13*Math.PI,midTheta:.50*Math.PI,captureTheta:.50*Math.PI,gateHalfTheta:.0391*Math.PI},
      physics:{naturalHz:.43,damping:.105,launchVelocity:4.30,dropAccel:2.45,railSpring:8.4,roughness:.030}
    },
    s2:{
      id:'s2',name:'2ND STAGE',count:15,
      slots:[
        slot('UP','UP',{width:.84}),slot('WIN','×1',{mult:1}),slot('Q','×?',{min:1,max:10}),slot('OUT','OUT'),slot('WIN','×2',{mult:2}),
        slot('UP','UP',{width:.84}),slot('OUT','OUT'),slot('Q','×?',{min:1,max:10}),slot('WIN','×3',{mult:3}),slot('OUT','OUT'),
        slot('UP','UP',{width:.84}),slot('OUT','OUT'),slot('Q','×?',{min:1,max:10}),slot('WIN','×2',{mult:2}),slot('OUT','OUT')
      ],
      geometry:{cx:.50,cy:.485,rx:.302,ry:.101,bodyTop:.425,trackScale:1.03,launchTheta:.84*Math.PI,entryTheta:.14*Math.PI,midTheta:.50*Math.PI,captureTheta:.50*Math.PI,gateHalfTheta:.0408*Math.PI},
      physics:{naturalHz:.46,damping:.112,launchVelocity:-4.05,dropAccel:2.38,railSpring:8.6,roughness:.032}
    },
    s3:{
      id:'s3',name:'3RD STAGE',count:6,
      slots:[
        slot('JPC','JPC',{width:.86}),slot('HOLD','×3',{mult:3,hold:true}),slot('HOLD','×6',{mult:6,hold:true}),
        slot('Q','×?',{min:3,max:15}),slot('HOLD','×6',{mult:6,hold:true}),slot('HOLD','×3',{mult:3,hold:true})
      ],
      holdIndices:[1,2,4,5],
      geometry:{cx:.50,cy:.292,rx:.205,ry:.075,bodyTop:.245,trackScale:1.02,launchTheta:.17*Math.PI,entryTheta:.86*Math.PI,midTheta:.50*Math.PI,captureTheta:.50*Math.PI,gateHalfTheta:.0442*Math.PI},
      physics:{naturalHz:.50,damping:.125,launchVelocity:3.45,dropAccel:2.55,railSpring:9.0,roughness:.026}
    },
    jpc:{
      id:'jpc',name:'JACKPOT CHANCE',count:6,overhead:true,
      slots:[slot('SJPC','SJPC',{width:.86}),slot('WIN','×6',{mult:6}),slot('WIN','×12',{mult:12}),slot('Q','×?',{min:6,max:30}),slot('WIN','×12',{mult:12}),slot('WIN','×6',{mult:6})],
      geometry:{cx:.50,cy:.105,rx:.112,ry:.039,trackScale:1.0,launchTheta:.08*Math.PI,entryTheta:.50*Math.PI,midTheta:.50*Math.PI},
      physics:{naturalHz:.60,damping:.145,launchVelocity:4.65,dropAccel:2.9,railSpring:9.6,roughness:.022}
    },
    sjpc:{
      id:'sjpc',name:'SUPER JACKPOT CHANCE',count:6,overhead:true,
      slots:[slot('SJP','SJP ×100',{mult:100,width:.84}),slot('WIN','×15',{mult:15}),slot('WIN','×30',{mult:30}),slot('Q','×?',{min:15,max:50}),slot('WIN','×30',{mult:30}),slot('WIN','×15',{mult:15})],
      geometry:{cx:.50,cy:.055,rx:.082,ry:.029,trackScale:1.0,launchTheta:.90*Math.PI,entryTheta:.50*Math.PI,midTheta:.50*Math.PI},
      physics:{naturalHz:.66,damping:.155,launchVelocity:-4.75,dropAccel:3.0,railSpring:9.8,roughness:.020}
    }
  };

  // The service documents establish motor-driven rotating crunes. Exact game-ROM
  // mode tables are not public. These periods are therefore reconstruction
  // profiles, not asserted original constants. 18.9s and 14.0s anchor to public
  // maintenance speed-check ranges; other modes interpolate between observed modes.
  const MOTOR_PROFILES={
    early:{
      label:'2010 EARLY / 安定回転',dynamic:false,
      s1:[22.0,18.9,16.0,14.0],s2:[22.8,19.4,16.4,14.3],s3:[19.5],jpc:[16.8],sjpc:[15.2]
    },
    countermeasure:{
      label:'LATE / 対策ROM相当',dynamic:true,
      s1:[22.0,18.9,16.0,14.0],s2:[22.8,19.4,16.4,14.3],s3:[19.5],jpc:[16.8],sjpc:[15.2]
    }
  };

  const RAMPS={
    s1:{from:[.70,.66],to:[.72,.51],side:'right'},
    s2:{from:[.32,.43],to:[.36,.31],side:'left'},
    s3:{from:[.50,.247],to:[.50,.145],side:'center'},
    jpc:{from:[.50,.098],to:[.50,.055],side:'tower'}
  };

  // Public sources expose ranges, not exact internal probability tables. This
  // function deliberately models the reported P/O tendency without claiming it
  // is SEGA's original table. It is isolated here so it can be replaced if a
  // verified table becomes available.
  function weightedQuestion(stageId,rng,houseHeat,holdCount){
    const stage=STAGES[stageId];
    const lo=stage.slots.find(s=>s.type==='Q')?.min||1;
    const hi=stage.slots.find(s=>s.type==='Q')?.max||lo;
    let heat=Math.max(-1,Math.min(1,Number(houseHeat)||0));
    if(stageId==='s3' && holdCount>=4) heat-=.55; // reported tendency: max-HOLD ? is usually low.
    const values=[];
    for(let v=lo;v<=hi;v++){
      const n=(v-lo)/Math.max(1,hi-lo);
      // Low multipliers dominate when cold; recovered station allows more high values.
      const exponent=2.9-1.55*((heat+1)/2);
      let w=Math.pow(1-n+.05,exponent);
      if(v===lo) w*=1.35;
      if(v===hi) w*=.72;
      values.push([v,w]);
    }
    let total=values.reduce((s,x)=>s+x[1],0),r=rng()*total;
    for(const [v,w] of values){r-=w;if(r<=0)return v;}
    return lo;
  }

  window.KZ_DATA={STAGES,MOTOR_PROFILES,RAMPS,weightedQuestion};
})();
