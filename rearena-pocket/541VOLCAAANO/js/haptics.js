(function(){
  'use strict';
  // Runtime UI deliberately treats these as generic preset stimuli.
  // The remote source is only a data feed; no vendor branding is surfaced to the player.
  const PRESET_URL='https://raw.githubusercontent.com/dungeonlab-open/dglab-kit/main/src/waveform/coyote.ts';
  const STORE='haptic-kazaaan-haptics-v1';
  const UUID={
    service:'0000180c-0000-1000-8000-00805f9b34fb',
    write:'0000150a-0000-1000-8000-00805f9b34fb',
    notify:'0000150b-0000-1000-8000-00805f9b34fb'
  };
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
  const FALLBACK={
    BUBBLE:{label:'Bubble',raw:['0A0A0A0A18181818','1212121228282828','1C1C1C1C40404040','2828282855555555','3838383864646464','2828282850505050']},
    RHYTHM:{label:'Rhythm',raw:['0A0A0A0A40404040','0A0A0A0A00000000','1616161658585858','0A0A0A0A00000000']},
    AIR_WAVES:{label:'Air Waves',raw:['0A0A0A0A10101010','1414141428282828','2020202048484848','3030303060606060','2020202040404040','1414141424242424']},
    BREATHING:{label:'Breathing',raw:['1212121214141414','1818181828282828','2020202040404040','2828282858585858','2020202040404040','1818181828282828']},
    PULSATING:{label:'Pulsating',raw:['0A0A0A0A64646464','0A0A0A0A00000000','0A0A0A0A64646464','0A0A0A0A42424242','0A0A0A0A21212121','0A0A0A0A00000000']},
    QUICK_RUB:{label:'Quick Rub',raw:Array.from({length:24},(_,i)=>i%2?'0A0A0A0A64646464':'0A0A0A0A00000000')},
    PULSE:{label:'Pulse',raw:['0A0A0A0A64646464','1616161664646464','2525252564646464','4040404064646464','6C6C6C6C64646464','A0A0A0A064646464']},
    HEARTBEAT:{label:'Heartbeat',raw:['1010101064646464','0A0A0A0A00000000','1010101048484848','0A0A0A0A00000000','0A0A0A0A00000000']}
  };

  function periodMs(raw){
    raw=clamp(raw,10,240);
    if(raw<=100)return raw;
    if(raw<=200)return (raw-100)*5+100;
    return (raw-200)*10+600;
  }
  function rawHz(raw){return 1000/periodMs(raw)}
  function parseFrame(hex){
    const b=[];for(let i=0;i<16;i+=2)b.push(parseInt(hex.slice(i,i+2),16));
    return {freq:b.slice(0,4),strength:b.slice(4,8)};
  }

  // Relative intrinsic preset-load ranking at equal channel power.
  function metrics(w){
    const widths=[],hzs=[];let edges=0,last=null,on=0,hi=0;
    for(const hex of w.raw){
      const f=parseFrame(hex);
      for(let i=0;i<4;i++){
        const width=f.strength[i],hz=rawHz(f.freq[i]);
        widths.push(width);hzs.push(hz);
        if(width>0)on++;
        if(width>=75)hi++;
        if(last!==null)edges+=Math.abs(width-last)/100;
        last=width;
      }
    }
    const n=Math.max(1,widths.length);
    const avgW=widths.reduce((a,b)=>a+b,0)/n;
    const peak=Math.max(0,...widths),density=on/n,hiDensity=hi/n;
    const dose=widths.reduce((s,w,i)=>s+(w/100)*Math.sqrt(clamp(hzs[i],1,100)/100),0)/n;
    const abrupt=edges/Math.max(1,n-1);
    return {avgW,peak,density,hiDensity,dose,abrupt};
  }
  function rankWaves(waves){
    const arr=Object.entries(waves).map(([key,w])=>({key,label:w.label||key,...metrics(w)}));
    const fields=['avgW','peak','density','hiDensity','dose','abrupt'];
    for(const f of fields){
      const vals=arr.map(x=>x[f]),lo=Math.min(...vals),hi=Math.max(...vals);
      for(const x of arr)x['n'+f]=(x[f]-lo)/Math.max(.0001,hi-lo);
    }
    for(const x of arr)x.score=100*(.25*x.ndose+.20*x.navgW+.13*x.npeak+.13*x.ndensity+.09*x.nhiDensity+.20*x.nabrupt);
    arr.sort((a,b)=>a.score-b.score);
    arr.forEach((x,i)=>{x.percentile=arr.length===1?0:i/(arr.length-1);x.class=x.percentile<.2?'GENTLE':x.percentile<.4?'SOFT':x.percentile<.6?'SOLID':x.percentile<.8?'HARD':'SEVERE'});
    return arr;
  }
  function parsePresetTS(text){
    const out={};
    // Source format currently exposes keys through COYOTE_WAVEFORM.*; this parser detail is not user-facing.
    const re=/\[COYOTE_WAVEFORM\.([A-Z0-9_]+)\]\s*:\s*\{[\s\S]*?en:\s*'([^']+)'[\s\S]*?raw:\s*\[([\s\S]*?)\]\s*,?\s*\}/g;
    let m;
    while((m=re.exec(text))){
      const raw=[...m[3].matchAll(/'([0-9A-Fa-f]{16})'/g)].map(x=>x[1].toUpperCase());
      if(raw.length)out[m[1]]={label:m[2],raw};
    }
    return out;
  }

  class HapticController{
    constructor(opts={}){
      this.onStatus=opts.onStatus||(()=>{});this.onRank=opts.onRank||(()=>{});this.onOutput=opts.onOutput||(()=>{});
      this.mode='sim';this.panic=false;
      this.waves={...FALLBACK};this.waveSource='fallback';this.ranked=rankWaves(this.waves);this.lastPresets=[];
      this.output={power:0,preset:null,raw:null,changedAt:performance.now()};
      this.test={active:false,channel:null,startAt:0,duration:3500,preset:null};
      this.ble={device:null,server:null,write:null,notify:null,ready:false,queue:Promise.resolve(),lastSend:0,frame:0};
      this.settings={limitA:30,limitB:30,channelA:true,channelB:true,connectionMode:'auto'};
      this.loadCache();this.ranked=rankWaves(this.waves);this.onRank(this.ranked,this.waveSource);
    }
    loadCache(){
      try{
        const s=JSON.parse(localStorage.getItem(STORE)||'{}');
        if(s.waves&&Object.keys(s.waves).length===24){this.waves=s.waves;this.waveSource='cache'}
        if(Number.isFinite(s.limitA))this.settings.limitA=clamp(s.limitA,0,100);
        if(Number.isFinite(s.limitB))this.settings.limitB=clamp(s.limitB,0,100);
        if(typeof s.channelA==='boolean')this.settings.channelA=s.channelA;
        if(typeof s.channelB==='boolean')this.settings.channelB=s.channelB;
        if(['auto','manual'].includes(s.connectionMode))this.settings.connectionMode=s.connectionMode;
      }catch(_){}
    }
    saveCache(){
      try{localStorage.setItem(STORE,JSON.stringify({waves:Object.keys(this.waves).length===24?this.waves:undefined,...this.settings}))}catch(_){}
    }
    async resetSettings({preservePresets=true}={}){
      await this.endTest();await this.sendZeroRepeat();await this.disconnect();
      const cached=preservePresets&&Object.keys(this.waves).length===24?this.waves:null;
      this.settings={limitA:30,limitB:30,channelA:true,channelB:true,connectionMode:'auto'};
      this.mode='sim';this.panic=false;this.lastPresets=[];this.output={power:0,preset:null,raw:null,changedAt:performance.now()};
      if(cached){this.waves=cached;this.waveSource='cache'}else{this.waves={...FALLBACK};this.waveSource='fallback'}
      this.ranked=rankWaves(this.waves);this.saveCache();this.onRank(this.ranked,this.waveSource);this.onOutput(this.publicOutput());
    }
    async syncWaves(){
      this.onStatus('waves','SYNCING');
      try{
        const r=await fetch(PRESET_URL,{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);
        const parsed=parsePresetTS(await r.text());if(Object.keys(parsed).length!==24)throw new Error(`parsed ${Object.keys(parsed).length}/24`);
        this.waves=parsed;this.waveSource='preset-live';this.ranked=rankWaves(this.waves);this.saveCache();this.onRank(this.ranked,this.waveSource);this.onStatus('waves','PRESET 24 / LIVE');return true;
      }catch(e){
        console.warn('preset sync failed',e);this.ranked=rankWaves(this.waves);this.onRank(this.ranked,this.waveSource);this.onStatus('waves',this.waveSource==='cache'?'PRESET 24 / CACHE':`FALLBACK ${Object.keys(this.waves).length}`);return false;
      }
    }
    choosePreset(target){
      target=clamp(target,0,1);if(!this.ranked.length)this.ranked=rankWaves(this.waves);
      const candidates=this.ranked.map(x=>({...x,d:Math.abs(x.percentile-target)+(this.lastPresets.includes(x.key)?.22:0)})).sort((a,b)=>a.d-b.d);
      const pool=candidates.slice(0,Math.min(4,candidates.length));const pick=pool[Math.floor(Math.random()*pool.length)]||candidates[0];
      if(pick){this.lastPresets.push(pick.key);while(this.lastPresets.length>3)this.lastPresets.shift()}
      return pick;
    }
    setConnectionMode(mode){this.settings.connectionMode=mode==='manual'?'manual':'auto';this.saveCache()}
    setLimits(a,b){
      this.settings.limitA=clamp(a,0,100);this.settings.limitB=clamp(b,0,100);this.saveCache();
      if(this.ble.ready)this.writeBF().then(()=>this.sendZeroRepeat());this.onOutput(this.publicOutput());
    }
    setChannels(a,b){this.settings.channelA=!!a;this.settings.channelB=!!b;this.saveCache();this.sendZeroRepeat();this.onOutput(this.publicOutput())}
    setOutput(power,presetKey){
      if(this.panic){power=0;presetKey=null}
      const p=clamp(power,0,100),w=presetKey?this.waves[presetKey]:null;
      const changed=(this.output.preset!==presetKey)||(Math.abs(this.output.power-p)>.001);
      this.output={power:p,preset:presetKey,raw:w?.raw||null,changedAt:changed?performance.now():(this.output.changedAt||performance.now())};
      if(changed)this.ble.frame=0;this.onOutput(this.publicOutput());
    }
    testPreset(){return this.ranked.reduce((best,x)=>!best||Math.abs(x.percentile-.55)<Math.abs(best.percentile-.55)?x:best,null)}
    beginTest(channel){
      if(this.panic)return false;
      const c=channel==='b'?'b':'a',preset=this.testPreset();
      this.test={active:true,channel:c,startAt:performance.now(),duration:3500,preset:preset?.key||Object.keys(this.waves)[0]||null};
      this.ble.frame=0;this.onOutput(this.publicOutput());return true;
    }
    async endTest(){
      if(!this.test.active)return;
      this.test.active=false;this.test.channel=null;this.test.preset=null;this.onOutput(this.publicOutput());await this.sendZeroRepeat();
    }
    commandState(now=performance.now()){
      if(this.panic)return {power:0,preset:null,raw:null,changedAt:now,test:false,testChannel:null};
      if(this.test.active){
        const power=clamp((now-this.test.startAt)/this.test.duration*100,0,100),preset=this.test.preset,raw=preset?this.waves[preset]?.raw:null;
        return {power,preset,raw,changedAt:this.test.startAt,test:true,testChannel:this.test.channel};
      }
      return {...this.output,test:false,testChannel:null};
    }
    effectivePowers(now=performance.now()){
      const s=this.commandState(now);if(this.panic)return {a:0,b:0};
      if(s.test){
        return {
          a:s.testChannel==='a'&&this.settings.channelA?clamp(s.power*this.settings.limitA/100,0,this.settings.limitA):0,
          b:s.testChannel==='b'&&this.settings.channelB?clamp(s.power*this.settings.limitB/100,0,this.settings.limitB):0
        };
      }
      return {
        a:this.settings.channelA?clamp(s.power*this.settings.limitA/100,0,this.settings.limitA):0,
        b:this.settings.channelB?clamp(s.power*this.settings.limitB/100,0,this.settings.limitB):0
      };
    }
    frameSample(now=performance.now()){
      const state=this.commandState(now),rank=this.ranked.find(x=>x.key===state.preset),eff=this.effectivePowers(now),raw=state.raw;
      const common={test:state.test,testChannel:state.testChannel,waveLevel:(rank?.percentile||0)*100};
      if(!raw||!raw.length||state.power<=0||this.panic){
        return {...common,active:false,preset:state.preset,label:rank?.label||(state.test?'TEST':'IDLE'),class:rank?.class||'—',score:rank?.score||0,power:this.panic?0:state.power,effectiveA:eff.a,effectiveB:eff.b,freqRawA:10,freqRawB:10,hzA:100,hzB:100,widthA:0,widthB:0,rawIndexA:0,rawIndexB:0,subslot:0};
      }
      const elapsed=Math.max(0,now-(state.changedAt||now)),rawIndexA=Math.floor(elapsed/100)%raw.length,rawIndexB=(rawIndexA+Math.max(1,Math.floor(raw.length/3)))%raw.length,subslot=Math.floor((elapsed%100)/25)%4;
      const a=parseFrame(raw[rawIndexA]),b=parseFrame(raw[rawIndexB]);
      return {...common,active:true,preset:state.preset,label:rank?.label||state.preset,class:rank?.class||'—',score:rank?.score||0,power:state.power,effectiveA:eff.a,effectiveB:eff.b,freqRawA:a.freq[subslot],freqRawB:b.freq[subslot],hzA:rawHz(a.freq[subslot]),hzB:rawHz(b.freq[subslot]),widthA:a.strength[subslot],widthB:b.strength[subslot],rawIndexA,rawIndexB,subslot};
    }
    publicOutput(now=performance.now()){
      const s=this.commandState(now),rank=this.ranked.find(x=>x.key===s.preset),eff=this.effectivePowers(now);
      return {power:this.panic?0:s.power,effectiveA:eff.a,effectiveB:eff.b,preset:s.preset,label:rank?.label||(s.test?'TEST':'IDLE'),class:rank?.class||'—',score:rank?.score||0,test:s.test,testChannel:s.testChannel,waveLevel:(rank?.percentile||0)*100};
    }
    async setMode(mode){
      if(mode===this.mode)return;await this.endTest();await this.sendZeroRepeat();this.mode=mode==='real'?'real':'sim';this.panic=false;
      if(this.mode==='sim')await this.disconnect();this.onStatus('ble',this.mode==='sim'?'SIMULATION / 実機出力なし':'REAL / 未接続');
    }
    queueWrite(data){
      if(this.mode!=='real'||!this.ble.write)return Promise.resolve();const copy=new Uint8Array(data);
      this.ble.queue=this.ble.queue.then(async()=>{if(!this.ble.write)return;try{if(this.ble.write.writeValueWithoutResponse)await this.ble.write.writeValueWithoutResponse(copy);else await this.ble.write.writeValue(copy)}catch(e){console.warn('BLE write failed',e);this.onStatus('ble','BLE WRITE ERROR: '+e.message)}});return this.ble.queue;
    }
    async requestDevice(mode){
      if(mode==='manual')return navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:[UUID.service]});
      if(typeof navigator.bluetooth.getDevices==='function'){
        try{const granted=await navigator.bluetooth.getDevices();const known=granted.find(d=>(d.name||'').startsWith('47L121000'));if(known)return known}catch(_){}
      }
      return navigator.bluetooth.requestDevice({filters:[{namePrefix:'47L121000'}],optionalServices:[UUID.service]});
    }
    async connect(mode=this.settings.connectionMode){
      if(this.mode!=='real')return false;if(!navigator.bluetooth){this.onStatus('ble','Web Bluetooth非対応');return false}
      try{
        this.setConnectionMode(mode);this.panic=false;await this.endTest();
        const device=await this.requestDevice(this.settings.connectionMode);
        device.addEventListener('gattserverdisconnected',()=>{this.ble.ready=false;this.ble.write=null;this.onStatus('ble','REAL / DISCONNECTED')});
        const server=await device.gatt.connect(),service=await server.getPrimaryService(UUID.service),write=await service.getCharacteristic(UUID.write);
        let notify=null;try{notify=await service.getCharacteristic(UUID.notify);await notify.startNotifications();notify.addEventListener('characteristicvaluechanged',e=>this.notify(e))}catch(e){console.warn('notify unavailable',e)}
        this.ble={...this.ble,device,server,write,notify,ready:false};await this.writeBF();this.ble.ready=true;this.onStatus('ble',`REAL / CONNECTED / ${this.settings.connectionMode.toUpperCase()} / LIMIT READY`);await this.sendZeroRepeat();return true;
      }catch(e){console.error(e);this.ble.ready=false;this.onStatus('ble','接続失敗: '+e.message);return false}
    }
    async disconnect(){try{await this.endTest();await this.sendZeroRepeat();this.ble.device?.gatt?.disconnect()}catch(_){}this.ble.ready=false;this.ble.write=null;this.ble.notify=null;this.onStatus('ble',this.mode==='real'?'REAL / DISCONNECTED':'SIMULATION / 実機出力なし')}
    notify(e){const d=new Uint8Array(e.target.value.buffer);if(d[0]===0xB1&&d.length>=4)this.onStatus('ble',`REAL / DEVICE A ${d[2]}/200 · B ${d[3]}/200`)}
    async writeBF(){if(!this.ble.write)return;const a=Math.round(this.settings.limitA*2),b=Math.round(this.settings.limitB*2);await this.queueWrite(new Uint8Array([0xBF,a,b,128,128,128,128]))}
    makeB0(rawA,rawB,now=performance.now()){
      const eff=this.effectivePowers(now),a=Math.round(eff.a*2),b=Math.round(eff.b*2);
      const bytes=h=>{const z=[];for(let i=0;i<16;i+=2)z.push(parseInt(h.slice(i,i+2),16));return z};
      const aa=bytes(rawA||'0A0A0A0A00000000'),bb=bytes(rawB||rawA||'0A0A0A0A00000000');
      return new Uint8Array([0xB0,0x0F,a,b,...aa.slice(0,4),...aa.slice(4,8),...bb.slice(0,4),...bb.slice(4,8)]);
    }
    zeroPacket(){return new Uint8Array([0xB0,0x0F,0,0,10,10,10,10,0,0,0,0,10,10,10,10,0,0,0,0])}
    async sendZeroRepeat(){for(let i=0;i<3;i++){await this.queueWrite(this.zeroPacket());await new Promise(r=>setTimeout(r,35))}}
    async emergency(){this.panic=true;this.test.active=false;this.output.power=0;await this.sendZeroRepeat();this.onOutput(this.publicOutput());this.onStatus('ble',this.mode==='real'?'EMERGENCY / OUTPUT ZERO':'EMERGENCY / SIM ZERO')}
    clearEmergency(){this.panic=false;this.onOutput(this.publicOutput())}
    tick(now){
      if(now-this.ble.lastSend<98)return;this.ble.lastSend=now;
      const s=this.commandState(now);if(this.mode!=='real'||!this.ble.ready||this.panic||!s.raw||s.power<=0)return;
      const raw=s.raw,ia=this.ble.frame++%raw.length,ib=(ia+Math.max(1,Math.floor(raw.length/3)))%raw.length;this.queueWrite(this.makeB0(raw[ia],raw[ib],now));
    }
  }
  window.KZ_HAPTICS={HapticController,rankWaves,metrics,parsePresetTS,parseFrame,periodMs,rawHz};
})();
