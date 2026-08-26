(function(){
  'use strict';
  const STORE='volcaaaano-rotating-v1';
  const UUID={service:'0000ffa0-0000-1000-8000-00805f9b34fb',write:'0000ffa1-0000-1000-8000-00805f9b34fb'};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
  class RotatingController{
    constructor(opts={}){
      this.onStatus=opts.onStatus||(()=>{});this.onOutput=opts.onOutput||(()=>{});
      this.settings={enabled:false,min:8,max:100,connectionMode:'auto',threshold:25,carrierHz:8};
      this.ble={device:null,server:null,write:null,ready:false,queue:Promise.resolve(),lastSend:0};
      this.last={source:0,target:0,actual:0,intermittent:false,duty:0,waveLevel:0,commandPower:0,updatedAt:0};
      this.load();
    }
    load(){try{const s=JSON.parse(localStorage.getItem(STORE)||'{}');if(typeof s.enabled==='boolean')this.settings.enabled=s.enabled;if(Number.isFinite(s.min))this.settings.min=clamp(s.min,0,100);if(Number.isFinite(s.max))this.settings.max=clamp(s.max,0,100);if(this.settings.min>this.settings.max)this.settings.min=this.settings.max;if(['auto','manual'].includes(s.connectionMode))this.settings.connectionMode=s.connectionMode}catch(_){}}
    save(){try{localStorage.setItem(STORE,JSON.stringify(this.settings))}catch(_){}}
    setEnabled(v){this.settings.enabled=!!v;this.save();if(!this.settings.enabled)this.zero();this.onOutput(this.last)}
    setLimits(min,max){min=clamp(min,0,100);max=clamp(max,0,100);if(min>max)min=max;this.settings.min=min;this.settings.max=max;this.save();this.onOutput(this.last)}
    setConnectionMode(mode){this.settings.connectionMode=mode==='manual'?'manual':'auto';this.save()}
    async resetSettings(){await this.zero();await this.disconnect();this.settings={enabled:false,min:8,max:100,connectionMode:'auto',threshold:25,carrierHz:8};this.last={source:0,target:0,actual:0,intermittent:false,duty:0,waveLevel:0,commandPower:0,updatedAt:performance.now()};this.save();this.onOutput(this.last)}
    mapping(sample){
      if(!this.settings.enabled||!sample?.active||sample.power<=0||sample.test)return {source:0,target:0};
      const commandPower=clamp(sample.power,0,100),waveLevel=clamp(sample.waveLevel,0,100);
      // Deliberately simple/strong mapping requested for the hidden device:
      // payout command power + relative preset level, saturating easily at 100.
      const source=clamp(commandPower+waveLevel,0,100);
      const target=source<=0?0:this.settings.min+(this.settings.max-this.settings.min)*(source/100);
      return {source,target:clamp(target,0,this.settings.max),commandPower,waveLevel};
    }
    physicalFor(target,now){
      target=clamp(target,0,this.settings.max);
      if(target<=0)return {actual:0,intermittent:false,duty:0};
      if(target>this.settings.threshold)return {actual:target,intermittent:false,duty:1};
      const onLevel=Math.min(this.settings.max,Math.max(this.settings.threshold,this.settings.min,target));
      if(onLevel<=0)return {actual:0,intermittent:true,duty:0};
      const duty=clamp(target/onLevel,.04,1),period=1000/this.settings.carrierHz,phase=now%period;
      return {actual:phase<period*duty?onLevel:0,intermittent:true,duty};
    }
    async requestDevice(mode){
      if(mode==='manual')return navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:[UUID.service]});
      if(typeof navigator.bluetooth.getDevices==='function'){
        try{const granted=await navigator.bluetooth.getDevices();const hints=['j-mighty','joyhub','kigtoybox'];const known=granted.find(d=>hints.some(h=>(d.name||'').toLowerCase().includes(h)));if(known)return known}catch(_){}
      }
      return navigator.bluetooth.requestDevice({filters:[{services:[UUID.service]},{namePrefix:'J-MIGHTY'},{namePrefix:'JOYHUB'},{namePrefix:'KiGToyBox'}],optionalServices:[UUID.service]});
    }
    async connect(mode=this.settings.connectionMode){
      if(!navigator.bluetooth){this.onStatus('Web Bluetooth非対応');return false}
      try{
        this.setConnectionMode(mode);const device=await this.requestDevice(this.settings.connectionMode);
        device.addEventListener('gattserverdisconnected',()=>{this.ble.ready=false;this.ble.write=null;this.onStatus('DISCONNECTED')});
        const server=await device.gatt.connect(),service=await server.getPrimaryService(UUID.service),write=await service.getCharacteristic(UUID.write);
        this.ble={...this.ble,device,server,write,ready:true};await this.zero();this.onStatus(`CONNECTED / ${this.settings.connectionMode.toUpperCase()}`);return true;
      }catch(e){console.warn('rotating connect failed',e);this.ble.ready=false;this.onStatus('接続失敗: '+e.message);return false}
    }
    async disconnect(){try{await this.zero();this.ble.device?.gatt?.disconnect()}catch(_){}this.ble.ready=false;this.ble.write=null;this.onStatus('DISCONNECTED')}
    queueWrite(level){
      if(!this.ble.ready||!this.ble.write)return Promise.resolve();const power=Math.round(clamp(level,0,100)/100*255);const payload=new Uint8Array([0xA0,0x03,power,0x00,0x00,0x00,0xAA]);
      this.ble.queue=this.ble.queue.then(async()=>{if(!this.ble.write)return;try{if(this.ble.write.writeValueWithoutResponse)await this.ble.write.writeValueWithoutResponse(payload);else await this.ble.write.writeValue(payload)}catch(e){console.warn('rotating write failed',e);this.onStatus('WRITE ERROR: '+e.message)}});return this.ble.queue;
    }
    async zero(){this.last={...this.last,source:0,target:0,actual:0,intermittent:false,duty:0,updatedAt:performance.now()};await this.queueWrite(0);this.onOutput(this.last)}
    tick(now,sample){
      if(now-this.ble.lastSend<48)return this.last;this.ble.lastSend=now;
      const map=this.mapping(sample),physical=this.physicalFor(map.target||0,now);
      this.last={source:map.source||0,target:map.target||0,actual:physical.actual,intermittent:physical.intermittent,duty:physical.duty,commandPower:map.commandPower||0,waveLevel:map.waveLevel||0,updatedAt:now};
      if(this.settings.enabled&&this.ble.ready)this.queueWrite(this.last.actual);else if(!this.settings.enabled&&this.ble.ready)this.queueWrite(0);
      this.onOutput(this.last);return this.last;
    }
  }
  window.KZ_ROTATING={RotatingController};
})();
