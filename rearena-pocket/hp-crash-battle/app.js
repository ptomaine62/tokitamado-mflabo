"use strict";

const VERSION = "20260605-hp-03-coyote";
const PRODUCT_FAMILY = "SHOCKiG REARENA POCKET";
const PRODUCT_NAME = "HP CRASH BATTLE";
const ACCESS_CODE = "HCB-MFLABO-202606";
const DEVICE_NAME_PREFIX = "47L";

const BLE_SERVICE_UUID = "0000180c-0000-1000-8000-00805f9b34fb";
const BLE_CHAR_UUID = "0000150a-0000-1000-8000-00805f9b34fb";
const BLE_NOTIFY_UUID = "0000150b-0000-1000-8000-00805f9b34fb";

const COYOTE_INIT_PACKET = new Uint8Array([0xBF, 200, 200, 128, 128, 128, 128]);

const PHASE = {
  ACCESS: "ACCESS",
  DISCLAIMER: "DISCLAIMER",
  CONNECT: "CONNECT",
  CHANNEL_TEST: "CHANNEL_TEST",
  RULE_SETUP: "RULE_SETUP",
  PLAYING: "PLAYING",
  RESULT: "RESULT",
  SAFE_LOCKED: "SAFE_LOCKED"
};

const STATUS = {
  WAIT_ACTION: "WAIT_ACTION",
  ROLLING_ATTACK: "ROLLING_ATTACK",
  ROLLING_RELEASE: "ROLLING_RELEASE",
  REVEAL: "REVEAL",
  RESULT: "RESULT"
};

const STORE = {
  access: "hcb_access_granted_v1",
  disclaimer: "hcb_disclaimer_accepted_v1",
  settings: "hcb_settings_v1"
};

const TIMING = {
  diceMs: 720,
  diceTickMs: 55,
  normalHoldMs: 3600,
  stimHoldMs: 4200,
  criticalHoldMs: 4700,
  resultHoldMs: 5200,
  outputTickMs: 50,
  gaugeTickMs: 100
};

const DICE = {
  1: "⚀",
  2: "⚁",
  3: "⚂",
  4: "⚃",
  5: "⚄",
  6: "⚅"
};

const DEFAULT_SETTINGS = {
  players: {
    p1: { name: "P1", channel: "A", colorIndex: 1 },
    p2: { name: "P2", channel: "B", colorIndex: 2 }
  },
  channels: {
    A: { limit: 30, testPercent: 5, pulseWidth: 20, frequency: 100, tested: false },
    B: { limit: 30, testPercent: 5, pulseWidth: 20, frequency: 100, tested: false }
  },
  hpCrash: {
    initialHp: 100,
    turnLimit: 0,

    normalPulseDurationMs: 900,
    strongPulseDurationMs: 1000,
    criticalPulseDurationMs: 1200,
    fumblePulseDurationMs: 900,

    strongSettlementBonusPercent: 5,
    criticalSettlementBonusPercent: 8,

    minGrazeStimPercent: 3,
    minHitStimPercent: 4,
    minStrongStimPercent: 6,
    minCriticalStimPercent: 8,
    minFumbleStimPercent: 5,

    releaseThreshold: 30,
    releaseBurstSelfDamage: 15,
    releaseFailureTargetDamage: 10,
    releaseFailureSelfDamage: 8,
    releaseSuccessBaseDamage: 10,
    releaseGreatBaseDamage: 20,
    releaseDamageDebtDivisor: 2,

    releaseSuccessTargetDebt: 20,
    releaseGreatTargetDebt: 30,

    releaseSelfBonusPercent: 5,
    releaseFailureSelfBonusPercent: 6,
    releaseBurstSelfBonusPercent: 8,
    releaseSuccessTargetBonusPercent: 8,
    releaseGreatTargetBonusPercent: 12,

    minReleaseSelfStimPercent: 8,
    minReleaseFailureStimPercent: 8,
    minReleaseBurstStimPercent: 10,
    minReleaseSuccessStimPercent: 10,
    minReleaseGreatStimPercent: 12,

    releaseSelfPulseDurationMs: 1200,
    releaseFailurePulseDurationMs: 1200,
    releaseBurstPulseDurationMs: 1500,
    releaseSuccessPulseDurationMs: 1500,
    releaseGreatPulseDurationMs: 2000,

    table: {
      fumble: { roll: 2, selfDebt: 15 },
      graze: { min: 3, max: 5, damage: 5, debt: 5 },
      hit: { min: 6, max: 8, damage: 10, debt: 10 },
      strong: { min: 9, max: 11, damage: 15, debt: 15 },
      critical: { roll: 12, damage: 25, debt: 25 }
    }
  },
  audio: {
    soundEnabled: true,
    soundVolume: 0.5,
    speechEnabled: false,
    speechRate: 1.0,
    speechPitch: 1.0,
    speechVolume: 1.0,
    voiceName: ""
  }
};

const view = document.getElementById("view");
const appShell = document.getElementById("app");
const toastRoot = document.getElementById("toast-root");

const state = {
  phase: PHASE.ACCESS,
  previousPhase: PHASE.ACCESS,
  safeReturnPhase: PHASE.CONNECT,
  accessGranted: false,
  disclaimerAccepted: false,
  paused: false,
  safeReason: "",
  settings: loadSettings(),
  game: null,
  output: {
    A: 0,
    B: 0,
    testHold: null,
    eventPulse: null
  },
  device: {
    mode: "none",
    connected: false,
    name: "",
    bluetoothDevice: null,
    characteristic: null,
    notifyCharacteristic: null,
    sending: false,
    lastSendAt: 0,
    lastPacket: "",
    writeMode: "auto",
    notifyLog: []
  },
  ui: {
    rotated: false,
    message: "",
    tone: "normal",
    diceRolling: false,
    rollFaces: { p1: [1, 1], p2: [1, 1] },
    skipHandler: null,
    voices: []
  },
  timers: {
    auto: null,
    dice: null,
    output: null,
    live: null
  },
  audio: {
    ctx: null,
    master: null,
    unlocked: false,
    lastSpeech: ""
  },
  log: []
};

boot();

function boot() {
  state.accessGranted = localStorage.getItem(STORE.access) === "yes";
  state.disclaimerAccepted = localStorage.getItem(STORE.disclaimer) === "yes";

  if (!state.accessGranted) {
    state.phase = PHASE.ACCESS;
  } else if (!state.disclaimerAccepted) {
    state.phase = PHASE.DISCLAIMER;
  } else {
    state.phase = PHASE.CONNECT;
  }

  normalizeSavedSettings();
  bindDocumentEvents();
  bindSafetyEvents();
  loadVoices();
  startOutputLoop();
  startLiveDomLoop();
  render();
  scrollTopSoon();
  log("HP CRASH BATTLE 起動");
}

function normalizeSavedSettings() {
  for (const ch of ["A", "B"]) {
    const cfg = state.settings.channels[ch];

    if (!cfg) {
      continue;
    }

    cfg.limit = intClamp(cfg.limit, 0, 100);
    cfg.testPercent = intClamp(cfg.testPercent, 0, 100);
    cfg.pulseWidth = intClamp(cfg.pulseWidth, 1, 100);
    cfg.frequency = intClamp(cfg.frequency, 10, 240);
  }

  saveSettings();
}

function bindDocumentEvents() {
  document.addEventListener("click", onClick);
  document.addEventListener("input", onInput);
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointerup", stopChannelTest);
  document.addEventListener("pointercancel", stopChannelTest);
  document.addEventListener("touchmove", preventPlayingRubberBand, { passive: false });

  if ("speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = () => {
      loadVoices();
      if (state.phase === PHASE.RULE_SETUP) {
        render();
      }
    };
  }
}

function bindSafetyEvents() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      safeStop("画面が非表示になりました");
    }
  });

  window.addEventListener("pagehide", emergencyZeroOnly);
  window.addEventListener("beforeunload", emergencyZeroOnly);
}

function preventPlayingRubberBand(event) {
  if (state.phase !== PHASE.PLAYING) {
    return;
  }

  const target = event.target;

  if (target && target.closest && target.closest("button,input,select,textarea,a")) {
    return;
  }

  event.preventDefault();
}

async function onClick(event) {
  const el = event.target.closest("[data-action]");

  if (!el) {
    return;
  }

  const action = el.dataset.action;

  if (action === "attack" || action === "release") {
    event.stopPropagation();
  }

  await unlockAudio();

  if (action === "check-access") checkAccess();
  else if (action === "accept-disclaimer") acceptDisclaimer();
  else if (action === "connect-known") connectKnown();
  else if (action === "connect-preferred") connectPreferred();
  else if (action === "connect-manual") connectManual();
  else if (action === "connect-simulation") connectSimulation();
  else if (action === "disconnect") disconnectDevice(true);
  else if (action === "go-rule-setup") setPhase(PHASE.RULE_SETUP);
  else if (action === "back-channel-test") setPhase(PHASE.CHANNEL_TEST);
  else if (action === "back-connect") setPhase(PHASE.CONNECT);
  else if (action === "start-game") startGame();
  else if (action === "attack") rollAttack();
  else if (action === "release") rollRelease();
  else if (action === "advance") advanceMessage();
  else if (action === "pause") togglePause();
  else if (action === "give-up-p1") giveUp("p1");
  else if (action === "give-up-p2") giveUp("p2");
  else if (action === "rotate") toggleRotate();
  else if (action === "emergency-stop") safeStop("緊急停止ボタンが押されました");
  else if (action === "zero") sendZeroRepeated();
  else if (action === "safe-return-previous") safeReturnPrevious();
  else if (action === "safe-return-channel") safeReturnChannel();
  else if (action === "reset-access") resetAccess();
  else if (action === "rematch") startGame();
  else if (action === "result-settings") setPhase(PHASE.RULE_SETUP);
  else if (action === "test-speech") testSpeech();
}

function onInput(event) {
  const el = event.target;

  if (el.dataset.range) {
    updateChannelSetting(el);
    return;
  }

  if (el.dataset.hp) {
    const min = Number(el.min);
    const max = Number(el.max);
    state.settings.hpCrash[el.dataset.hp] = intClamp(el.value, min, max);
    saveSettings();
    return;
  }

  if (el.dataset.hpSec) {
    const min = Number(el.min);
    const max = Number(el.max);
    const seconds = clamp(el.value, min, max);
    state.settings.hpCrash[el.dataset.hpSec] = Math.round(seconds * 1000);
    saveSettings();
    return;
  }

  if (el.dataset.audioNumber) {
    const key = el.dataset.audioNumber;
    const min = Number(el.min);
    const max = Number(el.max);
    const value = clamp(el.value, min, max);
    state.settings.audio[key] = value;
    updateAudioValueLabel(key, value);
    saveSettings();
    return;
  }

  if (el.dataset.audioSelect) {
    state.settings.audio[el.dataset.audioSelect] = el.value;
    saveSettings();
    return;
  }

  if (el.dataset.check) {
    const section = el.dataset.section || "hpCrash";
    state.settings[section][el.dataset.check] = el.checked;
    saveSettings();
    return;
  }

  if (el.id === "p1-name") {
    state.settings.players.p1.name = el.value || "P1";
    saveSettings();
    return;
  }

  if (el.id === "p2-name") {
    state.settings.players.p2.name = el.value || "P2";
    saveSettings();
  }
}

function onPointerDown(event) {
  const testButton = event.target.closest("[data-test-channel]");

  if (!testButton) {
    return;
  }

  event.preventDefault();
  startChannelTest(testButton.dataset.testChannel);
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE.settings) || "null");
    return merge(structuredClone(DEFAULT_SETTINGS), saved || {});
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function saveSettings() {
  localStorage.setItem(STORE.settings, JSON.stringify(state.settings));
}

function merge(base, patch) {
  for (const key of Object.keys(patch || {})) {
    if (patch[key] && typeof patch[key] === "object" && !Array.isArray(patch[key])) {
      if (!base[key]) {
        base[key] = {};
      }
      merge(base[key], patch[key]);
    } else {
      base[key] = patch[key];
    }
  }

  return base;
}

function setPhase(phase) {
  state.previousPhase = state.phase;
  state.phase = phase;

  if (phase !== PHASE.PLAYING) {
    state.ui.rotated = false;
    applyRotation();
  }

  updateViewportLock();
  render();
  scrollTopSoon();
}

function updateViewportLock() {
  const locked = state.phase === PHASE.PLAYING;

  document.documentElement.classList.toggle("playing-lock", locked);
  document.body.classList.toggle("playing-lock", locked);
}

function render() {
  updateViewportLock();
  applyRotation();

  if (state.phase === PHASE.ACCESS) renderAccess();
  else if (state.phase === PHASE.DISCLAIMER) renderDisclaimer();
  else if (state.phase === PHASE.CONNECT) renderConnect();
  else if (state.phase === PHASE.CHANNEL_TEST) renderChannelTest();
  else if (state.phase === PHASE.RULE_SETUP) renderRuleSetup();
  else if (state.phase === PHASE.PLAYING) renderPlaying();
  else if (state.phase === PHASE.RESULT) renderResult();
  else if (state.phase === PHASE.SAFE_LOCKED) renderSafeLocked();
}

function header(title, subtitle = "", options = {}) {
  const rotate = options.rotate === true;
  const menu = options.menu === true;

  return `
    <header class="header">
      <div class="header-main">
        <div class="brand-kicker-mini">${escape(PRODUCT_FAMILY)}</div>
        <h1 class="header-title">${escape(title)}</h1>
        ${subtitle ? `<p class="header-sub">${escape(subtitle)}</p>` : ""}
      </div>
      <div class="header-actions">
        <div class="status-strip">
          <div class="pill">${deviceStatusHtml()}</div>
          <div class="pill version-pill">APP v${VERSION}</div>
        </div>
        ${rotate ? `<button class="rotate-fab" data-action="rotate" aria-label="180度回転">↻</button>` : ""}
        ${menu ? `<button class="btn icon ghost" data-action="pause" aria-label="一時停止">⏸</button>` : ""}
      </div>
    </header>
  `;
}

function deviceStatusHtml() {
  if (state.device.mode === "simulation") {
    return `<span class="dot connected">●</span>確認モード`;
  }

  if (state.device.connected) {
    return `<span class="dot connected">●</span>COYOTE接続`;
  }

  return `<span class="dot disconnected">●</span>未接続`;
}

function renderVersionStrip() {
  return `
    <div class="version-strip">
      <span>${escape(PRODUCT_FAMILY)}</span>
      <b>${escape(PRODUCT_NAME)}</b>
      <span>v${VERSION}</span>
    </div>
  `;
}

function renderAccess() {
  view.innerHTML = `
    <section class="hero">
      <div class="hero-card">
        ${renderVersionStrip()}
        <div class="brand-kicker">${escape(PRODUCT_FAMILY)}</div>
        <h1 class="brand-title">HP<br>CRASH<br>BATTLE</h1>
        <div class="brand-ja">アクセスコード</div>
        <p class="notice">
          BOOTH購入者向けAccess Codeを入力してください。<br>
          認証前はゲーム・接続・安全ロック解除へ進めません。
        </p>
        <div class="form-stack">
          <label class="field-label">Access Code</label>
          <input id="access-code" class="input big-input" autocomplete="off" inputmode="latin" placeholder="HCB-..." />
          <button class="btn primary wide stable-btn" data-action="check-access">認証して開始</button>
        </div>
      </div>
    </section>
  `;
}

function renderDisclaimer() {
  view.innerHTML = `
    <section class="screen">
      ${header(PRODUCT_NAME, "WARNING & DISCLAIMER")}
      <div class="card warning-card">
        <h2>安全確認と同意</h2>
        <p>本アプリはCOYOTE BLEデバイスを制御します。必ず低い出力から開始してください。</p>
        <ul class="safety-list">
          <li>体調不良、違和感、痛み、しびれ等を感じた場合は直ちに使用を中止してください。</li>
          <li>心臓疾患、医療機器、ペースメーカー等に関係する方は使用しないでください。</li>
          <li>画面非表示、通信切断、送信エラー、緊急停止時は出力0%へ移行します。</li>
          <li>A/Bチャンネルテスト完了まではゲームを開始できません。</li>
          <li>使用は自己責任で、同意できる場合のみ起動してください。</li>
        </ul>
        <label class="check-row">
          <input id="disclaimer-check" type="checkbox" />
          <span>上記の内容を確認し、自己責任で使用します。</span>
        </label>
        <button class="btn danger wide stable-btn" data-action="accept-disclaimer">同意して接続へ</button>
      </div>
    </section>
  `;
}

function renderConnect() {
  view.innerHTML = `
    <section class="screen">
      ${header(PRODUCT_NAME, "COYOTE接続")}
      <div class="grid two">
        <div class="card">
          <h2>接続</h2>
          <p class="muted">Web BluetoothでCOYOTE V3へ直接接続します。HTTPS環境と対応ブラウザが必要です。</p>
          <div class="button-stack">
            <button class="btn primary wide stable-btn" data-action="connect-known">かんたん接続</button>
            <button class="btn cyan wide stable-btn" data-action="connect-preferred">47Lから探す</button>
            <button class="btn ghost wide stable-btn" data-action="connect-manual">手動で探す</button>
            <button class="btn danger wide stable-btn" data-action="disconnect">切断</button>
          </div>
        </div>
        <div class="card">
          <h2>確認モード</h2>
          <p class="muted">BLE送信なしで、画面・音・進行・出力ゲージだけ確認できます。</p>
          <button class="btn orange wide stable-btn" data-action="connect-simulation">COYOTEなし確認モード</button>
        </div>
      </div>
      ${renderLog()}
    </section>
  `;
}

function renderChannelTest() {
  const A = state.settings.channels.A;
  const B = state.settings.channels.B;

  view.innerHTML = `
    <section class="screen">
      ${header(PRODUCT_NAME, "A/Bチャンネル設定")}
      <div class="grid two">
        ${renderChannelCard("A", A, "P1 / チャンネルA")}
        ${renderChannelCard("B", B, "P2 / チャンネルB")}
      </div>
      <div class="card">
        <p class="muted">テストボタンは押している間だけ出力します。離す・キャンセル・画面外へ出ると0%になります。</p>
        <p class="muted">COYOTE V3向けに、強度は0〜200、波形周波数は10〜240、波形強度は0〜100へ変換して送信します。</p>
        <button class="btn primary wide stable-btn" data-action="go-rule-setup" ${A.tested && B.tested ? "" : "disabled"}>
          A/Bテスト完了：ゲーム設定へ
        </button>
      </div>
      ${renderFooterSafe(false)}
    </section>
  `;
}

function renderChannelCard(ch, cfg, title) {
  return `
    <div class="card channel-card player-tone-${ch === "A" ? "1" : "2"}">
      <h2>${escape(title)}</h2>
      <div class="form-grid">
        ${rangeInput(`limit-${ch}`, "出力リミット", cfg.limit, 0, 100, 1, "%")}
        ${rangeInput(`test-${ch}`, "テストの強さ", cfg.testPercent, 0, 100, 1, "%")}
        ${rangeInput(`width-${ch}`, "波形強度", cfg.pulseWidth, 1, 100, 1, "")}
        ${rangeInput(`freq-${ch}`, "波形周波数", cfg.frequency, 10, 240, 1, "")}
      </div>
      <button class="btn big ${cfg.tested ? "safe" : "primary"} stable-btn" data-test-channel="${ch}">
        ${cfg.tested ? "✓ テスト済み" : "押してテスト"}
      </button>
      <div class="bar out">
        <div class="bar-fill" data-out-bar="${ch}" style="width:${state.output[ch]}%"></div>
      </div>
    </div>
  `;
}

function rangeInput(id, label, value, min, max, step, unit) {
  return `
    <label class="range-row">
      <span>${escape(label)}</span>
      <input id="${escape(id)}" type="range" min="${min}" max="${max}" step="${step}" value="${escape(value)}" data-range="${escape(id)}" />
      <b id="${escape(id)}-value">${escape(value)}${escape(unit)}</b>
    </label>
  `;
}

function renderRuleSetup() {
  const h = state.settings.hpCrash;
  const p = state.settings.players;
  const audio = state.settings.audio;

  view.innerHTML = `
    <section class="screen">
      ${header(PRODUCT_NAME, "ゲーム設定")}

      <div class="card">
        <h2>プレイヤー</h2>
        <div class="grid two">
          <label class="field-label">P1名前<input class="input" id="p1-name" value="${escape(p.p1.name)}"></label>
          <label class="field-label">P2名前<input class="input" id="p2-name" value="${escape(p.p2.name)}"></label>
        </div>
      </div>

      <div class="card">
        <h2>HPクラッシュ設定</h2>
        <div class="setup-grid">
          ${hpNumberField("initialHp", "初期HP", h.initialHp, 10, 300, 1)}
          ${hpNumberField("turnLimit", "ターン上限（0で無制限）", h.turnLimit, 0, 99, 1)}
          ${hpNumberField("releaseThreshold", "蓄積解放しきい値", h.releaseThreshold, 0, 100, 1)}
          ${hpNumberField("releaseDamageDebtDivisor", "解放ダメージ除数", h.releaseDamageDebtDivisor, 1, 10, 1)}

          ${hpSecondField("normalPulseDurationMs", "通常パルス秒", h.normalPulseDurationMs, 0.1, 10, 0.1)}
          ${hpSecondField("strongPulseDurationMs", "強打パルス秒", h.strongPulseDurationMs, 0.1, 10, 0.1)}
          ${hpSecondField("criticalPulseDurationMs", "クリティカル秒", h.criticalPulseDurationMs, 0.1, 10, 0.1)}
          ${hpSecondField("fumblePulseDurationMs", "ファンブル秒", h.fumblePulseDurationMs, 0.1, 10, 0.1)}

          ${hpNumberField("minGrazeStimPercent", "かすり最低%", h.minGrazeStimPercent, 0, 100, 1)}
          ${hpNumberField("minHitStimPercent", "命中最低%", h.minHitStimPercent, 0, 100, 1)}
          ${hpNumberField("minStrongStimPercent", "強打最低%", h.minStrongStimPercent, 0, 100, 1)}
          ${hpNumberField("minCriticalStimPercent", "クリティカル最低%", h.minCriticalStimPercent, 0, 100, 1)}
          ${hpNumberField("minFumbleStimPercent", "ファンブル最低%", h.minFumbleStimPercent, 0, 100, 1)}

          ${hpNumberField("releaseBurstSelfDamage", "暴発 自傷", h.releaseBurstSelfDamage, 0, 100, 1)}
          ${hpNumberField("releaseFailureTargetDamage", "失敗 対象ダメージ", h.releaseFailureTargetDamage, 0, 100, 1)}
          ${hpNumberField("releaseFailureSelfDamage", "失敗 自傷", h.releaseFailureSelfDamage, 0, 100, 1)}
          ${hpNumberField("releaseSuccessBaseDamage", "成功 基本ダメージ", h.releaseSuccessBaseDamage, 0, 100, 1)}
          ${hpNumberField("releaseGreatBaseDamage", "大成功 基本ダメージ", h.releaseGreatBaseDamage, 0, 100, 1)}
        </div>
      </div>

      <div class="card">
        <h2>音声・効果音</h2>
        <div class="setup-grid">
          ${checkField("soundEnabled", "効果音", audio.soundEnabled, "audio")}
          ${audioNumberField("soundVolume", "効果音音量", audio.soundVolume, 0, 1, 0.05)}
          ${checkField("speechEnabled", "音声読み上げ", audio.speechEnabled, "audio")}
          ${voiceSelectField(audio.voiceName)}
          ${audioNumberField("speechRate", "読み上げ速度", audio.speechRate, 0.5, 1.8, 0.1)}
          ${audioNumberField("speechPitch", "読み上げ高さ", audio.speechPitch, 0.5, 1.8, 0.1)}
          ${audioNumberField("speechVolume", "読み上げ音量", audio.speechVolume, 0, 1, 0.05)}
          <button class="btn ghost stable-btn" data-action="test-speech">音声テスト</button>
        </div>
      </div>

      <div class="footer-safe">
        <button class="btn ghost stable-btn" data-action="back-channel-test">A/B設定</button>
        <button class="btn primary stable-btn" data-action="start-game">ゲーム開始</button>
        <button class="btn danger stable-btn" data-action="emergency-stop">緊急停止</button>
      </div>
    </section>
  `;
}

function hpNumberField(key, label, value, min, max, step) {
  return `
    <label class="field-label">
      ${escape(label)}
      <input class="input" type="number" id="hp-${escape(key)}" value="${escape(value)}" min="${min}" max="${max}" step="${step}" data-hp="${escape(key)}">
    </label>
  `;
}

function hpSecondField(key, label, valueMs, min, max, step) {
  const valueSec = Number((Number(valueMs || 0) / 1000).toFixed(2));

  return `
    <label class="field-label">
      ${escape(label)}
      <input class="input" type="number" id="hp-sec-${escape(key)}" value="${escape(valueSec)}" min="${min}" max="${max}" step="${step}" data-hp-sec="${escape(key)}">
    </label>
  `;
}

function checkField(key, label, checked, section = "hpCrash") {
  return `
    <label class="check-row">
      <input type="checkbox" data-check="${escape(key)}" data-section="${escape(section)}" ${checked ? "checked" : ""}>
      <span>${escape(label)}</span>
    </label>
  `;
}

function audioNumberField(key, label, value, min, max, step) {
  return `
    <label class="field-label">
      ${escape(label)} <span class="inline-value" id="audio-value-${escape(key)}">${escape(formatAudioValue(key, value))}</span>
      <input class="input" type="range" value="${escape(value)}" min="${min}" max="${max}" step="${step}" data-audio-number="${escape(key)}">
    </label>
  `;
}

function voiceSelectField(selectedName) {
  const voices = state.ui.voices;
  const options = [
    `<option value="">ブラウザ標準</option>`,
    ...voices.map((voice) => {
      const selected = voice.name === selectedName ? "selected" : "";
      return `<option value="${escape(voice.name)}" ${selected}>${escape(voice.name)} / ${escape(voice.lang)}</option>`;
    })
  ].join("");

  return `
    <label class="field-label">
      読み上げ音声
      <select class="input" data-audio-select="voiceName">
        ${options}
      </select>
    </label>
  `;
}

function renderPlaying() {
  const g = state.game;

  if (!g) {
    setPhase(PHASE.RULE_SETUP);
    return;
  }

  view.innerHTML = `
    <section class="screen playing-screen">
      ${header("HP CRASH BATTLE", g.message, { rotate: true, menu: true })}

      <div class="battle-main">
        <div class="desktop-hud play-layout">
          ${renderBattlePlayerCard("p1")}
          ${renderBattlePlayerCard("p2")}
        </div>

        <div class="mobile-hud">
          ${renderMiniHud("p1")}
          ${renderMiniHud("p2")}
        </div>

        <section class="card game-center ${canAdvance() ? "message-hold-clickable" : ""}" data-action="advance">
          <div class="round-label">${renderTurnLabel()}</div>
          ${renderMessageBox(state.ui.message || g.message, state.ui.tone)}
          ${state.paused ? `<div class="pause-banner">PAUSED：再開するまで進行しません</div>` : ""}
          <div class="phase-hint" id="phase-hint">${escape(phaseHintText())}</div>
          <div class="countdown-line" id="countdown-line"></div>
          <div class="message-advance-hint" id="advance-hint">${canAdvance() ? "タップで次へ" : "操作待ち"}</div>

          <div class="dice-area">
            ${renderDiceBox("p1")}
            ${renderDiceBox("p2")}
          </div>

          <div class="battle-actions">
            <button class="btn primary big stable-btn" data-action="attack" ${canAct() ? "" : "disabled"}>
              ⚔ 攻撃
            </button>
            <button class="btn orange big stable-btn" data-action="release" ${canRelease() ? "" : "disabled"}>
              🔥 解放
            </button>
          </div>
        </section>

        <div class="log-section-desktop">${renderLog()}</div>
      </div>

      ${renderGameFooter()}
    </section>
  `;

  updateLiveDom();
}

function renderTurnLabel() {
  const g = state.game;

  if (!g) {
    return "";
  }

  const limit = g.turnLimit > 0 ? ` / ${g.turnLimit}` : "";
  return `
    <span class="round-main">TURN ${escape(g.turn)}${escape(limit)}</span>
    <span class="round-sub">ATTACKER: ${escape(playerName(g.attackerId))}</span>
  `;
}

function renderBattlePlayerCard(id) {
  const p = state.game.players[id];
  const active = state.game.attackerId === id;
  const target = state.game.defenderId === id;
  const maxDebt = 100;

  return `
    <section class="battle-player-card card player-tone-${p.colorIndex} ${active ? "is-active" : ""} ${target ? "is-loser" : ""}">
      <div class="battle-player-top">
        <div>
          <div class="player-id">${escape(id.toUpperCase())} / CH ${escape(p.channel)}</div>
          <h2 class="battle-player-name">${escape(p.name)}</h2>
        </div>
        <div class="battle-charge-number" data-charge-number="${id}">${Math.round(p.hp)}</div>
      </div>

      <div class="battle-gauge-stack">
        ${gauge("HP", p.hp, state.settings.hpCrash.initialHp, "hp", id)}
        ${gauge("蓄積", p.debt, maxDebt, "charge", id)}
        ${gauge("OUTPUT", outputOf(id), 100, "output", id)}
      </div>

      <div class="battle-player-meta">
        <span>LIMIT ${escape(state.settings.channels[p.channel].limit)}%</span>
        <span>${p.releaseUsed ? "解放済み" : p.debt >= state.settings.hpCrash.releaseThreshold ? "解放可能" : "解放待ち"}</span>
      </div>
    </section>
  `;
}

function renderMiniHud(id) {
  const p = state.game.players[id];

  return `
    <section class="mini-hud-card player-tone-${p.colorIndex}">
      <div class="mini-hud-head">
        <b>${escape(p.name)}</b>
        <span>CH ${escape(p.channel)}</span>
      </div>
      <div class="mini-hud-gauges">
        ${miniGauge("HP", p.hp, state.settings.hpCrash.initialHp, "hp", id)}
        ${miniGauge("蓄積", p.debt, 100, "charge", id)}
        ${miniGauge("OUTPUT", outputOf(id), 100, "output", id)}
      </div>
    </section>
  `;
}

function gauge(label, value, max, kind, id) {
  const pct = percent(value, max);

  return `
    <div class="gauge-row">
      <div class="gauge-label">
        <span>${escape(label)}</span>
        <b data-gauge-text="${kind}-${id}">${kind === "output" ? formatPercent(value) : Math.round(value)}</b>
      </div>
      <div class="bar ${escape(kind)}">
        <div class="bar-fill" data-gauge="${kind}-${id}" style="width:${pct}%"></div>
      </div>
    </div>
  `;
}

function miniGauge(label, value, max, kind, id) {
  const pct = percent(value, max);

  return `
    <div class="mini-gauge-row">
      <div class="mini-gauge-label">
        <span>${escape(label)}</span>
        <b data-mini-gauge-text="${kind}-${id}">${kind === "output" ? formatPercent(value) : Math.round(value)}</b>
      </div>
      <div class="mini-bar ${escape(kind)}">
        <div class="mini-bar-fill" data-mini-gauge="${kind}-${id}" style="width:${pct}%"></div>
      </div>
    </div>
  `;
}

function renderMessageBox(message, tone) {
  const lines = String(message || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3);

  return `
    <div class="game-message-box tone-${escape(tone || "normal")}" id="message-box">
      ${lines.map((line, i) => `<div class="game-message-line ${i === 0 ? "" : i === 1 ? "sub" : "detail"}">${colorPlayerNames(line)}</div>`).join("")}
    </div>
  `;
}

function renderDiceBox(id) {
  const p = state.game.players[id];
  const active = state.game.attackerId === id;
  const faces = state.ui.diceRolling && active ? state.ui.rollFaces[id] : p.lastDice || [1, 1];
  const total = p.lastRoll || "-";

  return `
    <div class="dice-box player-tone-${p.colorIndex} ${active ? "active" : ""}">
      <div class="dice-owner">${escape(p.name)}</div>
      <div class="dice-face ${state.ui.diceRolling && active ? "rolling" : ""}" data-dice-face="${id}">
        ${DICE[faces[0]]}${DICE[faces[1]]}
      </div>
      <div class="dice-value" data-dice-result="${id}">${escape(total)}</div>
    </div>
  `;
}

function renderGameFooter() {
  return `
    <footer class="game-footer four">
      <button class="btn ghost footer-btn stable-btn" data-action="give-up-p1">P1ギブアップ</button>
      <button class="btn ghost footer-btn stable-btn" data-action="give-up-p2">P2ギブアップ</button>
      <button class="btn ghost footer-btn stable-btn" data-action="pause">${state.paused ? "再開" : "一時停止"}</button>
      <button class="btn danger footer-btn emergency stable-btn" data-action="emergency-stop">緊急停止</button>
    </footer>
  `;
}

function renderFooterSafe(showGameControls) {
  return `
    <div class="footer-safe">
      <button class="btn ghost stable-btn" data-action="${showGameControls ? "give-up-p1" : "back-connect"}">${showGameControls ? "P1ギブアップ" : "接続へ"}</button>
      <button class="btn ghost stable-btn" data-action="${showGameControls ? "give-up-p2" : "zero"}">${showGameControls ? "P2ギブアップ" : "出力0%"}</button>
      <button class="btn danger stable-btn" data-action="emergency-stop">緊急停止</button>
    </div>
  `;
}

function renderResult() {
  const g = state.game;
  const p1 = g?.players?.p1 || { name: "P1", hp: 0, debt: 0 };
  const p2 = g?.players?.p2 || { name: "P2", hp: 0, debt: 0 };

  view.innerHTML = `
    <section class="screen">
      ${header(PRODUCT_NAME, "RESULT")}
      <div class="card result-card">
        <h1 class="result-title">RESULT</h1>
        <p class="result-reason">${escape(g?.resultReason || "")}</p>
        <div class="grid two">
          <div class="score-card player-tone-1">
            <h2>${escape(p1.name)}</h2>
            <div class="score-number">${Math.round(p1.hp)}</div>
            <p>HP / 蓄積 ${Math.round(p1.debt)}</p>
          </div>
          <div class="score-card player-tone-2">
            <h2>${escape(p2.name)}</h2>
            <div class="score-number">${Math.round(p2.hp)}</div>
            <p>HP / 蓄積 ${Math.round(p2.debt)}</p>
          </div>
        </div>
        <div class="button-row">
          <button class="btn primary stable-btn" data-action="rematch">もう一度遊ぶ</button>
          <button class="btn ghost stable-btn" data-action="result-settings">設定へ戻る</button>
        </div>
      </div>
    </section>
  `;
}

function renderSafeLocked() {
  view.innerHTML = `
    <section class="safe-screen">
      <div class="card safe-card">
        <h1 class="safe-title">SAFE STOP</h1>
        <p class="safe-reason">${escape(state.safeReason || "安全停止しました")}</p>
        <p class="muted">A/B出力は0%にリセットされました。復帰先を選んでください。</p>
        <div class="button-stack">
          <button class="btn danger wide stable-btn" data-action="zero">出力0%を再送信</button>
          <button class="btn primary wide stable-btn" data-action="safe-return-previous">直前の画面に戻る</button>
          <button class="btn cyan wide stable-btn" data-action="safe-return-channel">チャンネル設定にもどる</button>
          <button class="btn ghost wide stable-btn" data-action="reset-access">Access Codeからやり直す</button>
        </div>
      </div>
    </section>
  `;
}

function renderLog() {
  return `
    <div class="card log-card">
      <h3>LOG</h3>
      <div class="log-box">${state.log.map(escape).join("<br>") || "ログはまだありません"}</div>
    </div>
  `;
}

function checkAccess() {
  const code = (document.getElementById("access-code")?.value || "").trim();

  if (code !== ACCESS_CODE) {
    toast("Access Codeが違います");
    log("Access Code認証失敗");
    return;
  }

  state.accessGranted = true;
  localStorage.setItem(STORE.access, "yes");
  log("Access Code認証完了");
  setPhase(state.disclaimerAccepted ? PHASE.CONNECT : PHASE.DISCLAIMER);
}

function acceptDisclaimer() {
  if (!document.getElementById("disclaimer-check")?.checked) {
    toast("同意チェックが必要です");
    return;
  }

  state.disclaimerAccepted = true;
  localStorage.setItem(STORE.disclaimer, "yes");
  log("Disclaimer同意完了");
  setPhase(PHASE.CONNECT);
}

async function connectKnown() {
  if (!guardAccess()) {
    return;
  }

  if (!navigator.bluetooth || !navigator.bluetooth.getDevices) {
    toast("このブラウザはかんたん接続に対応していません");
    return;
  }

  try {
    const devices = await navigator.bluetooth.getDevices();
    const device = devices.find((d) => (d.name || "").startsWith(DEVICE_NAME_PREFIX)) || devices[0];

    if (!device) {
      toast("過去に許可したCOYOTEがありません");
      return;
    }

    await attachDevice(device);
  } catch (error) {
    handleConnectError(`かんたん接続失敗: ${error.message}`);
  }
}

async function connectPreferred() {
  if (!guardAccess()) {
    return;
  }

  if (!navigator.bluetooth) {
    toast("Web Bluetooth非対応ブラウザです");
    return;
  }

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: DEVICE_NAME_PREFIX }],
      optionalServices: [BLE_SERVICE_UUID]
    });

    await attachDevice(device);
  } catch (error) {
    if (!String(error.message || "").includes("User cancelled")) {
      handleConnectError(`47L接続失敗: ${error.message}`);
    }
  }
}

async function connectManual() {
  if (!guardAccess()) {
    return;
  }

  if (!navigator.bluetooth) {
    toast("Web Bluetooth非対応ブラウザです");
    return;
  }

  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [BLE_SERVICE_UUID]
    });

    await attachDevice(device);
  } catch (error) {
    if (!String(error.message || "").includes("User cancelled")) {
      handleConnectError(`手動接続失敗: ${error.message}`);
    }
  }
}

function handleConnectError(message) {
  log(message);
  toast(message);

  if (state.phase === PHASE.PLAYING) {
    safeStop(message);
  }
}

async function attachDevice(device) {
  await disconnectDevice(false);

  state.device.bluetoothDevice = device;
  state.device.name = device.name || "COYOTE";

  device.addEventListener("gattserverdisconnected", () => {
    handleDeviceDisconnected();
  });

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(BLE_SERVICE_UUID);
  state.device.characteristic = await service.getCharacteristic(BLE_CHAR_UUID);

  try {
    state.device.notifyCharacteristic = await service.getCharacteristic(BLE_NOTIFY_UUID);
    state.device.notifyCharacteristic.addEventListener("characteristicvaluechanged", onCoyoteNotify);
    await state.device.notifyCharacteristic.startNotifications();
    log("COYOTE Notify開始");
  } catch (error) {
    state.device.notifyCharacteristic = null;
    log(`Notify未使用: ${error.message}`);
  }

  state.device.mode = "ble";
  state.device.connected = true;
  state.device.writeMode = "auto";

  await sendCoyoteInit();
  await sleep(80);
  await sendZeroRepeated();

  log(`COYOTE接続: ${state.device.name}`);
  setPhase(PHASE.CHANNEL_TEST);
}

function onCoyoteNotify(event) {
  const value = event.target.value;

  if (!value) {
    return;
  }

  const bytes = [];

  for (let i = 0; i < value.byteLength; i++) {
    bytes.push(value.getUint8(i));
  }

  const hex = bytes.map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join(" ");
  state.device.notifyLog.push(hex);
  state.device.notifyLog = state.device.notifyLog.slice(-20);
}

function handleDeviceDisconnected() {
  state.device.mode = "none";
  state.device.connected = false;
  state.device.name = "";
  state.device.bluetoothDevice = null;
  state.device.characteristic = null;
  state.device.notifyCharacteristic = null;
  state.device.writeMode = "auto";
  stopAllOutputLocal();

  if (state.phase === PHASE.PLAYING) {
    safeStop("COYOTEが切断されました");
  } else {
    log("COYOTEが切断されました");
    toast("COYOTEが切断されました");
    render();
  }
}

function connectSimulation() {
  if (!guardAccess()) {
    return;
  }

  state.device.mode = "simulation";
  state.device.connected = true;
  state.device.name = "COYOTEなし確認モード";
  log("確認モードで開始");
  setPhase(PHASE.CHANNEL_TEST);
}

async function disconnectDevice(goConnect) {
  await sendZeroRepeated();

  try {
    if (state.device.notifyCharacteristic) {
      try {
        await state.device.notifyCharacteristic.stopNotifications();
      } catch {}
    }

    if (state.device.bluetoothDevice?.gatt?.connected) {
      state.device.bluetoothDevice.gatt.disconnect();
    }
  } catch {}

  state.device.mode = "none";
  state.device.connected = false;
  state.device.name = "";
  state.device.bluetoothDevice = null;
  state.device.characteristic = null;
  state.device.notifyCharacteristic = null;
  state.device.sending = false;
  state.device.lastPacket = "";
  state.device.writeMode = "auto";

  if (goConnect) {
    setPhase(PHASE.CONNECT);
  }
}

function guardAccess() {
  if (!state.accessGranted) {
    setPhase(PHASE.ACCESS);
    return false;
  }

  if (!state.disclaimerAccepted) {
    setPhase(PHASE.DISCLAIMER);
    return false;
  }

  return true;
}

function startGame() {
  if (!state.device.connected) {
    toast("先に接続または確認モードを開始してください");
    return;
  }

  if (!state.settings.channels.A.tested || !state.settings.channels.B.tested) {
    toast("A/Bチャンネルテストが必要です");
    setPhase(PHASE.CHANNEL_TEST);
    return;
  }

  stopAllOutputLocal();
  clearTimers();

  const h = state.settings.hpCrash;
  const initialHp = intClamp(h.initialHp, 10, 300);

  state.game = {
    status: STATUS.WAIT_ACTION,
    turn: 1,
    turnLimit: intClamp(h.turnLimit, 0, 99),
    attackerId: "p1",
    defenderId: "p2",
    lastAction: "",
    lastCategory: "",
    lastRoll: 0,
    resultReason: "",
    message: `${state.settings.players.p1.name} のターン\n攻撃または蓄積解放を選択`,
    players: {
      p1: {
        id: "p1",
        name: state.settings.players.p1.name || "P1",
        channel: state.settings.players.p1.channel || "A",
        colorIndex: 1,
        hp: initialHp,
        debt: 0,
        releaseUsed: false,
        lastRoll: 0,
        lastDice: [1, 1],
        gaveUp: false
      },
      p2: {
        id: "p2",
        name: state.settings.players.p2.name || "P2",
        channel: state.settings.players.p2.channel || "B",
        colorIndex: 2,
        hp: initialHp,
        debt: 0,
        releaseUsed: false,
        lastRoll: 0,
        lastDice: [1, 1],
        gaveUp: false
      }
    }
  };

  state.ui.message = state.game.message;
  state.ui.tone = "normal";
  state.ui.skipHandler = null;
  state.paused = false;
  log("HP CRASH BATTLE 開始");
  setPhase(PHASE.PLAYING);
  speakMessage(state.ui.message);
}

function canAct() {
  return (
    state.phase === PHASE.PLAYING &&
    state.game &&
    state.game.status === STATUS.WAIT_ACTION &&
    !state.paused
  );
}

function canRelease() {
  if (!canAct()) {
    return false;
  }

  const attacker = currentAttacker();
  const threshold = Number(state.settings.hpCrash.releaseThreshold || 30);

  return attacker && !attacker.releaseUsed && attacker.debt >= threshold;
}

function canAdvance() {
  return state.game && state.game.status === STATUS.REVEAL && typeof state.ui.skipHandler === "function";
}

function rollAttack() {
  if (!canAct()) {
    return;
  }

  startRolling("attack");
}

function rollRelease() {
  if (!canRelease()) {
    toast("蓄積が足りない、または解放済みです");
    return;
  }

  startRolling("release");
}

function startRolling(action) {
  const g = state.game;
  const attacker = currentAttacker();

  if (!g || !attacker) {
    return;
  }

  clearTimers();
  stopAllOutputLocal();

  g.status = action === "release" ? STATUS.ROLLING_RELEASE : STATUS.ROLLING_ATTACK;
  g.lastAction = action;
  state.ui.diceRolling = true;
  state.ui.tone = action === "release" ? "critical" : "normal";
  state.ui.message = action === "release"
    ? `${attacker.name} の蓄積解放\n2D6を振っています`
    : `${attacker.name} の攻撃\n2D6を振っています`;

  playSound(action === "release" ? "critical" : "roll");
  render();

  state.timers.dice = setInterval(() => {
    state.ui.rollFaces[attacker.id] = [randDice(), randDice()];
    updateDiceDisplays();
  }, TIMING.diceTickMs);

  state.timers.auto = setTimeout(() => {
    clearInterval(state.timers.dice);
    state.timers.dice = null;

    const dice = [randDice(), randDice()];
    const total = dice[0] + dice[1];

    attacker.lastDice = dice;
    attacker.lastRoll = total;
    state.ui.rollFaces[attacker.id] = dice;
    state.ui.diceRolling = false;

    if (action === "release") {
      resolveRelease(total, dice);
    } else {
      resolveAttack(total, dice);
    }
  }, TIMING.diceMs);
}

function resolveAttack(total, dice) {
  const g = state.game;
  const h = state.settings.hpCrash;
  const attacker = currentAttacker();
  const defender = currentDefender();

  if (!g || !attacker || !defender) {
    return;
  }

  const result = attackResultFromRoll(total);
  let pulseTarget = defender.id;
  let pulsePercent = 0;
  let pulseDuration = h.normalPulseDurationMs;
  let tone = "stim";
  let message = "";

  if (result.key === "fumble") {
    attacker.debt = clamp(attacker.debt + result.debt, 0, 100);
    pulseTarget = attacker.id;
    pulsePercent = scaledStimForPlayer(attacker.id, h.minFumbleStimPercent, 0, "linear");
    pulseDuration = h.fumblePulseDurationMs;
    tone = "critical";
    message = `ファンブル！ ${attacker.name} に反動\n出目 ${total} / 蓄積 +${result.debt}`;
  } else {
    defender.hp = Math.max(0, defender.hp - result.damage);
    defender.debt = clamp(defender.debt + result.debt, 0, 100);

    if (result.key === "graze") {
      pulsePercent = scaledStimForPlayer(defender.id, h.minGrazeStimPercent, 0, "soft");
      pulseDuration = h.normalPulseDurationMs;
      tone = "stim";
    } else if (result.key === "hit") {
      pulsePercent = scaledStimForPlayer(defender.id, h.minHitStimPercent, 0, "linear");
      pulseDuration = h.normalPulseDurationMs;
      tone = "stim";
    } else if (result.key === "strong") {
      pulsePercent = scaledStimForPlayer(defender.id, h.minStrongStimPercent, h.strongSettlementBonusPercent, "linear");
      pulseDuration = h.strongPulseDurationMs;
      tone = "critical";
    } else {
      pulsePercent = scaledStimForPlayer(defender.id, h.minCriticalStimPercent, h.criticalSettlementBonusPercent, "hard");
      pulseDuration = h.criticalPulseDurationMs;
      tone = "critical";
    }

    message = `${result.category}！ ${defender.name} に ${result.damage} ダメージ\n出目 ${total} / 蓄積 +${result.debt}`;
  }

  g.lastRoll = total;
  g.lastCategory = result.category;
  g.message = message;
  state.ui.message = message;
  state.ui.tone = tone;
  g.status = STATUS.REVEAL;

  startPlayerPulse(pulseTarget, pulsePercent, pulseDuration);
  log(message.replaceAll("\n", " / "));
  playSound(tone === "critical" ? "critical" : "hit");
  speakMessage(message);

  const winner = checkWinnerAfterAction(attacker, defender, result.key === "fumble" ? "attack-fumble" : "attack");
  prepareAdvance(winner);
  render();
}

function resolveRelease(total, dice) {
  const g = state.game;
  const h = state.settings.hpCrash;
  const attacker = currentAttacker();
  const defender = currentDefender();

  if (!g || !attacker || !defender) {
    return;
  }

  attacker.releaseUsed = true;

  let category = "";
  let message = "";
  let tone = "critical";
  let pulseA = 0;
  let pulseB = 0;
  let duration = h.releaseSuccessPulseDurationMs;

  if (total <= 4) {
    category = "暴発";
    attacker.hp = Math.max(0, attacker.hp - h.releaseBurstSelfDamage);

    const selfPercent = scaledStimForPlayer(
      attacker.id,
      h.minReleaseBurstStimPercent,
      h.releaseBurstSelfBonusPercent,
      "hard"
    );

    pulseA = attacker.channel === "A" ? selfPercent : 0;
    pulseB = attacker.channel === "B" ? selfPercent : 0;
    duration = h.releaseBurstPulseDurationMs;
    message = `蓄積解放：暴発！\n${attacker.name} に ${h.releaseBurstSelfDamage} ダメージ`;
  } else if (total <= 7) {
    category = "失敗";
    defender.hp = Math.max(0, defender.hp - h.releaseFailureTargetDamage);
    attacker.hp = Math.max(0, attacker.hp - h.releaseFailureSelfDamage);

    const selfPercent = scaledStimForPlayer(
      attacker.id,
      h.minReleaseFailureStimPercent,
      h.releaseFailureSelfBonusPercent,
      "linear"
    );

    const targetPercent = scaledStimForPlayer(
      defender.id,
      h.minReleaseFailureStimPercent,
      0,
      "linear"
    );

    pulseA = attacker.channel === "A" ? selfPercent : targetPercent;
    pulseB = attacker.channel === "B" ? selfPercent : targetPercent;
    duration = h.releaseFailurePulseDurationMs;
    message = `蓄積解放：失敗\n${defender.name} に ${h.releaseFailureTargetDamage} / ${attacker.name} に ${h.releaseFailureSelfDamage}`;
  } else if (total <= 10) {
    category = "成功";
    const damage = h.releaseSuccessBaseDamage + Math.floor(attacker.debt / Math.max(1, h.releaseDamageDebtDivisor));
    defender.hp = Math.max(0, defender.hp - damage);
    defender.debt = clamp(defender.debt + h.releaseSuccessTargetDebt, 0, 100);

    const targetPercent = scaledStimForPlayer(
      defender.id,
      h.minReleaseSuccessStimPercent,
      h.releaseSuccessTargetBonusPercent,
      "hard"
    );

    pulseA = defender.channel === "A" ? targetPercent : 0;
    pulseB = defender.channel === "B" ? targetPercent : 0;
    duration = h.releaseSuccessPulseDurationMs;
    message = `蓄積解放：成功！\n${defender.name} に ${damage} ダメージ / 蓄積 +${h.releaseSuccessTargetDebt}`;
  } else {
    category = "大成功";
    const damage = h.releaseGreatBaseDamage + Math.floor(attacker.debt / Math.max(1, h.releaseDamageDebtDivisor));
    defender.hp = Math.max(0, defender.hp - damage);
    defender.debt = clamp(defender.debt + h.releaseGreatTargetDebt, 0, 100);

    const targetPercent = scaledStimForPlayer(
      defender.id,
      h.minReleaseGreatStimPercent,
      h.releaseGreatTargetBonusPercent,
      "hard"
    );

    pulseA = defender.channel === "A" ? targetPercent : 0;
    pulseB = defender.channel === "B" ? targetPercent : 0;
    duration = h.releaseGreatPulseDurationMs;
    message = `蓄積解放：大成功！\n${defender.name} に ${damage} ダメージ / 蓄積 +${h.releaseGreatTargetDebt}`;
  }

  g.lastRoll = total;
  g.lastCategory = category;
  g.message = message;
  state.ui.message = message;
  state.ui.tone = tone;
  g.status = STATUS.REVEAL;

  startPulseAB(pulseA, pulseB, duration);
  log(message.replaceAll("\n", " / "));
  playSound("critical");
  speakMessage(message);

  const winner = checkWinnerAfterAction(attacker, defender, "release");
  prepareAdvance(winner);
  render();
}

function attackResultFromRoll(total) {
  const table = state.settings.hpCrash.table;

  if (total === table.fumble.roll) {
    return {
      key: "fumble",
      category: "ファンブル",
      damage: 0,
      debt: table.fumble.selfDebt
    };
  }

  if (total >= table.graze.min && total <= table.graze.max) {
    return {
      key: "graze",
      category: "かすり",
      damage: table.graze.damage,
      debt: table.graze.debt
    };
  }

  if (total >= table.hit.min && total <= table.hit.max) {
    return {
      key: "hit",
      category: "命中",
      damage: table.hit.damage,
      debt: table.hit.debt
    };
  }

  if (total >= table.strong.min && total <= table.strong.max) {
    return {
      key: "strong",
      category: "強打",
      damage: table.strong.damage,
      debt: table.strong.debt
    };
  }

  return {
    key: "critical",
    category: "クリティカル",
    damage: table.critical.damage,
    debt: table.critical.debt
  };
}

function checkWinnerAfterAction(attacker, defender, action) {
  const g = state.game;

  if (!g) {
    return null;
  }

  const p1 = g.players.p1;
  const p2 = g.players.p2;

  if (p1.hp <= 0 && p2.hp <= 0) {
    return {
      winnerId: null,
      reason: "両者のHPが0：引き分け"
    };
  }

  if (defender.hp <= 0) {
    return {
      winnerId: attacker.id,
      reason: `${defender.name} のHPが0：${attacker.name} の勝利`
    };
  }

  if (attacker.hp <= 0) {
    const reason = action === "release"
      ? `${attacker.name} は蓄積解放の反動で倒れた：${defender.name} の勝利`
      : `${attacker.name} のHPが0：${defender.name} の勝利`;

    return {
      winnerId: defender.id,
      reason
    };
  }

  if (g.turnLimit > 0 && g.turn >= g.turnLimit && attacker.id === "p2") {
    if (p1.hp > p2.hp) {
      return {
        winnerId: "p1",
        reason: `ターン上限到達：HPが多い ${p1.name} の勝利`
      };
    }

    if (p2.hp > p1.hp) {
      return {
        winnerId: "p2",
        reason: `ターン上限到達：HPが多い ${p2.name} の勝利`
      };
    }

    if (p1.debt < p2.debt) {
      return {
        winnerId: "p1",
        reason: `ターン上限到達：蓄積が少ない ${p1.name} の勝利`
      };
    }

    if (p2.debt < p1.debt) {
      return {
        winnerId: "p2",
        reason: `ターン上限到達：蓄積が少ない ${p2.name} の勝利`
      };
    }

    return {
      winnerId: null,
      reason: "ターン上限到達：完全引き分け"
    };
  }

  return null;
}

function prepareAdvance(winner) {
  state.ui.skipHandler = () => {
    if (winner) {
      finishGame(winner.winnerId, winner.reason);
    } else {
      nextTurn();
    }
  };

  const hold = state.ui.tone === "critical" ? TIMING.criticalHoldMs : TIMING.stimHoldMs;

  state.timers.auto = setTimeout(() => {
    if (state.game && state.game.status === STATUS.REVEAL && !state.paused) {
      advanceMessage();
    }
  }, hold);
}

function advanceMessage() {
  if (!canAdvance()) {
    return;
  }

  const handler = state.ui.skipHandler;
  state.ui.skipHandler = null;
  handler();
}

function nextTurn() {
  const g = state.game;

  if (!g) {
    return;
  }

  stopAllOutputLocal();

  if (g.attackerId === "p1") {
    g.attackerId = "p2";
    g.defenderId = "p1";
  } else {
    g.attackerId = "p1";
    g.defenderId = "p2";
    g.turn += 1;
  }

  g.status = STATUS.WAIT_ACTION;
  g.message = `${playerName(g.attackerId)} のターン\n攻撃または蓄積解放を選択`;
  state.ui.message = g.message;
  state.ui.tone = "normal";
  playSound("turn");
  speakMessage(g.message);
  render();
}

function finishGame(winnerId, reason) {
  stopAllOutputLocal();

  if (state.game) {
    state.game.status = STATUS.RESULT;
    state.game.resultReason = reason || "勝敗が決定しました";
  }

  log(`RESULT: ${reason}`);
  playSound("result");
  setPhase(PHASE.RESULT);
}

function giveUp(id) {
  if (!state.game) {
    return;
  }

  const loser = state.game.players[id];
  const winnerId = id === "p1" ? "p2" : "p1";
  const winner = state.game.players[winnerId];

  if (!loser || !winner) {
    return;
  }

  loser.gaveUp = true;
  finishGame(winnerId, `${loser.name} がギブアップ：${winner.name} の勝利`);
}

function togglePause() {
  state.paused = !state.paused;

  if (state.paused) {
    stopAllOutputLocal();
    log("一時停止");
  } else {
    log("再開");
  }

  render();
}

function toggleRotate() {
  state.ui.rotated = !state.ui.rotated;
  applyRotation();
}

function applyRotation() {
  if (!appShell) {
    return;
  }

  appShell.classList.toggle("screen-rotated", state.ui.rotated);
}

function safeReturnPrevious() {
  const phase = state.safeReturnPhase || PHASE.CONNECT;
  state.safeReason = "";
  setPhase(phase === PHASE.PLAYING ? PHASE.CHANNEL_TEST : phase);
}

function safeReturnChannel() {
  state.safeReason = "";
  setPhase(PHASE.CHANNEL_TEST);
}

function resetAccess() {
  localStorage.removeItem(STORE.access);
  localStorage.removeItem(STORE.disclaimer);
  state.accessGranted = false;
  state.disclaimerAccepted = false;
  state.safeReason = "";
  setPhase(PHASE.ACCESS);
}

function updateChannelSetting(el) {
  const [kind, ch] = String(el.dataset.range || "").split("-");
  const cfg = state.settings.channels[ch];

  if (!cfg) {
    return;
  }

  if (kind === "limit") cfg.limit = intClamp(el.value, 0, 100);
  if (kind === "test") cfg.testPercent = intClamp(el.value, 0, 100);
  if (kind === "width") cfg.pulseWidth = intClamp(el.value, 1, 100);
  if (kind === "freq") cfg.frequency = intClamp(el.value, 10, 240);

  cfg.tested = false;
  saveSettings();

  const suffix = kind === "limit" || kind === "test" ? "%" : "";
  setText(`#${CSS.escape(el.dataset.range)}-value`, `${el.value}${suffix}`);
}

function outputOf(id) {
  if (!state.game) {
    return 0;
  }

  const player = state.game.players[id];

  if (!player) {
    return 0;
  }

  return player.channel === "A" ? state.output.A : state.output.B;
}

function limitChannel(ch, value) {
  const cfg = state.settings.channels[ch];
  const limit = cfg ? cfg.limit : 0;

  return clamp(Math.min(Number(value || 0), limit), 0, 100);
}

function scaledStimForPlayer(playerId, minPercent, bonusPercent = 0, curve = "linear") {
  const player = state.game?.players?.[playerId];

  if (!player) {
    return 0;
  }

  const ch = player.channel;
  const limit = clamp(state.settings.channels[ch]?.limit || 0, 0, 100);
  const debt = clamp(player.debt || 0, 0, 100);
  const min = clamp(minPercent || 0, 0, limit);
  const bonus = clamp(bonusPercent || 0, 0, 100);

  let t = debt / 100;

  if (curve === "soft") {
    t = Math.pow(t, 1.35);
  } else if (curve === "hard") {
    t = Math.pow(t, 0.75);
  }

  const base = min + (limit - min) * t;
  const bonusRoom = Math.max(0, limit - base);
  const bonusScaled = bonusRoom * (bonus / 100);

  return clamp(base + bonusScaled, 0, limit);
}

function startPlayerPulse(playerId, percent, durationMs) {
  const p = state.game?.players?.[playerId];

  if (!p) {
    return;
  }

  const A = p.channel === "A" ? percent : 0;
  const B = p.channel === "B" ? percent : 0;
  startPulseAB(A, B, durationMs);
}

function startPulseAB(A, B, durationMs) {
  const safeA = limitChannel("A", A);
  const safeB = limitChannel("B", B);

  state.output.eventPulse = {
    A: safeA,
    B: safeB,
    untilMs: Date.now() + Math.max(50, Number(durationMs || 300))
  };

  state.output.A = safeA;
  state.output.B = safeB;
  updateLiveDom();
}

function startChannelTest(ch) {
  if (!state.settings.channels[ch]) {
    return;
  }

  state.output.testHold = ch;
  state.settings.channels[ch].tested = true;
  saveSettings();

  const percentValue = limitChannel(ch, state.settings.channels[ch].testPercent);

  if (ch === "A") {
    state.output.A = percentValue;
    state.output.B = 0;
  } else {
    state.output.A = 0;
    state.output.B = percentValue;
  }

  playSound("test");
  updateLiveDom();
}

function stopChannelTest() {
  if (!state.output.testHold) {
    return;
  }

  state.output.testHold = null;
  state.output.A = 0;
  state.output.B = 0;
  sendOutputPacket(0, 0);
  updateLiveDom();
  render();
}

function startOutputLoop() {
  if (state.timers.output) {
    clearInterval(state.timers.output);
  }

  state.timers.output = setInterval(() => {
    tickOutput();
  }, TIMING.outputTickMs);
}

function tickOutput() {
  if (state.phase === PHASE.SAFE_LOCKED || state.paused) {
    state.output.A = 0;
    state.output.B = 0;
    sendOutputThrottled(0, 0);
    return;
  }

  if (state.output.testHold) {
    const ch = state.output.testHold;
    const value = limitChannel(ch, state.settings.channels[ch].testPercent);
    state.output.A = ch === "A" ? value : 0;
    state.output.B = ch === "B" ? value : 0;
    sendOutputThrottled(state.output.A, state.output.B);
    return;
  }

  if (state.output.eventPulse) {
    if (Date.now() <= state.output.eventPulse.untilMs) {
      state.output.A = limitChannel("A", state.output.eventPulse.A);
      state.output.B = limitChannel("B", state.output.eventPulse.B);
      sendOutputThrottled(state.output.A, state.output.B);
      return;
    }

    state.output.eventPulse = null;
  }

  state.output.A = 0;
  state.output.B = 0;
  sendOutputThrottled(0, 0);
}

async function sendCoyoteInit() {
  if (state.device.mode === "simulation") {
    return true;
  }

  if (state.device.mode !== "ble" || !state.device.characteristic) {
    return false;
  }

  let ok = false;

  for (let i = 0; i < 3; i++) {
    ok = await writeBlePacket(COYOTE_INIT_PACKET, true);

    if (ok) {
      await sleep(60);
    }
  }

  if (ok) {
    log("COYOTE BF初期化送信");
  } else {
    log("COYOTE BF初期化失敗");
  }

  return ok;
}

async function sendOutputThrottled(A, B) {
  const now = Date.now();

  if (now - state.device.lastSendAt < 50) {
    return;
  }

  const safeA = clamp(A, 0, 100);
  const safeB = clamp(B, 0, 100);
  const packetKey = `${Math.round(safeA)}:${Math.round(safeB)}`;

  if (packetKey === state.device.lastPacket && safeA !== 0 && safeB !== 0) {
    return;
  }

  state.device.lastSendAt = now;
  state.device.lastPacket = packetKey;
  await sendOutputPacket(safeA, safeB);
}

async function sendOutputPacket(A, B) {
  A = clamp(A, 0, 100);
  B = clamp(B, 0, 100);

  if (state.device.mode === "simulation") {
    return true;
  }

  if (state.device.mode !== "ble" || !state.device.characteristic) {
    return false;
  }

  const packet = buildPacket(A, B);
  const ok = await writeBlePacket(packet, false);

  if (!ok && state.phase === PHASE.PLAYING) {
    safeStop("BLE送信エラー");
  }

  return ok;
}

async function writeBlePacket(packet, force) {
  if (!state.device.characteristic) {
    return false;
  }

  if (state.device.sending && !force) {
    return false;
  }

  state.device.sending = true;

  try {
    const data = packet instanceof Uint8Array ? packet : new Uint8Array(packet);

    if (state.device.writeMode === "withoutResponse") {
      await state.device.characteristic.writeValueWithoutResponse(data);
      state.device.sending = false;
      return true;
    }

    if (state.device.writeMode === "withResponse") {
      await writeWithResponseCompatible(data);
      state.device.sending = false;
      return true;
    }

    try {
      await state.device.characteristic.writeValueWithoutResponse(data);
      state.device.writeMode = "withoutResponse";
      state.device.sending = false;
      return true;
    } catch (errorWithoutResponse) {
      try {
        await writeWithResponseCompatible(data);
        state.device.writeMode = "withResponse";
        state.device.sending = false;
        return true;
      } catch (errorWithResponse) {
        log(`BLE書込失敗: ${errorWithResponse.message || errorWithoutResponse.message}`);
        state.device.sending = false;
        return false;
      }
    }
  } catch (error) {
    log(`BLE書込例外: ${error.message}`);
    state.device.sending = false;
    return false;
  }
}

async function writeWithResponseCompatible(data) {
  if (typeof state.device.characteristic.writeValueWithResponse === "function") {
    await state.device.characteristic.writeValueWithResponse(data);
    return;
  }

  if (typeof state.device.characteristic.writeValue === "function") {
    await state.device.characteristic.writeValue(data);
    return;
  }

  throw new Error("writeValueWithResponse/writeValueが使用できません");
}

function buildPacket(A, B) {
  const strengthA = coyoteStrengthFromPercent(A);
  const strengthB = coyoteStrengthFromPercent(B);

  const freqA = coyoteFrequency("A");
  const freqB = coyoteFrequency("B");
  const waveA = coyoteWaveStrength("A");
  const waveB = coyoteWaveStrength("B");

  const bytes = [
    0xB0,
    0x0F,
    strengthA,
    strengthB,
    freqA,
    freqA,
    freqA,
    freqA,
    waveA,
    waveA,
    waveA,
    waveA,
    freqB,
    freqB,
    freqB,
    freqB,
    waveB,
    waveB,
    waveB,
    waveB
  ];

  return new Uint8Array(bytes);
}

function coyoteStrengthFromPercent(percentValue) {
  const safePercent = clamp(percentValue, 0, 100);
  return intClamp((safePercent / 100) * 200, 0, 200);
}

function coyoteFrequency(ch) {
  const cfg = state.settings.channels[ch] || {};
  return intClamp(cfg.frequency || 100, 10, 240);
}

function coyoteWaveStrength(ch) {
  const cfg = state.settings.channels[ch] || {};
  return intClamp(cfg.pulseWidth || 20, 0, 100);
}

async function sendZeroRepeated() {
  stopAllOutputLocal();

  for (let i = 0; i < 6; i++) {
    await sendOutputPacket(0, 0);
    await sleep(35);
  }

  updateLiveDom();
  log("ゼロ出力を送信しました");
}

function emergencyZeroOnly() {
  stopAllOutputLocal();
  sendOutputPacket(0, 0);
  sendOutputPacket(0, 0);
  sendOutputPacket(0, 0);
}

async function safeStop(reason) {
  state.safeReason = reason || "安全停止しました";
  state.safeReturnPhase = state.phase === PHASE.SAFE_LOCKED ? state.safeReturnPhase : state.phase;

  stopAllOutputLocal();
  clearTimers();
  playSound("warning");
  log(`SAFE STOP: ${state.safeReason}`);
  await sendZeroRepeated();

  state.ui.rotated = false;
  applyRotation();

  if (!state.accessGranted) {
    setPhase(PHASE.ACCESS);
  } else {
    setPhase(PHASE.SAFE_LOCKED);
  }
}

function stopAllOutputLocal() {
  state.output.A = 0;
  state.output.B = 0;
  state.output.testHold = null;
  state.output.eventPulse = null;
  state.device.lastPacket = "";
  updateLiveDom();
}

function clearTimers() {
  if (state.timers.auto) {
    clearTimeout(state.timers.auto);
    state.timers.auto = null;
  }

  if (state.timers.dice) {
    clearInterval(state.timers.dice);
    state.timers.dice = null;
  }
}

function startLiveDomLoop() {
  if (state.timers.live) {
    clearInterval(state.timers.live);
  }

  state.timers.live = setInterval(() => {
    updateLiveDom();
  }, TIMING.gaugeTickMs);
}

function updateLiveDom() {
  updateOutputBars();
  updateBattleGauges();
  updateDiceDisplays();
}

function updateOutputBars() {
  setBar("[data-out-bar='A']", state.output.A);
  setBar("[data-out-bar='B']", state.output.B);
}

function updateBattleGauges() {
  if (!state.game) {
    return;
  }

  for (const id of ["p1", "p2"]) {
    const p = state.game.players[id];

    if (!p) {
      continue;
    }

    setGauge(`hp-${id}`, p.hp, state.settings.hpCrash.initialHp);
    setGauge(`charge-${id}`, p.debt, 100);
    setGauge(`output-${id}`, outputOf(id), 100);
    setText(`[data-gauge-text='hp-${id}']`, String(Math.round(p.hp)));
    setText(`[data-gauge-text='charge-${id}']`, String(Math.round(p.debt)));
    setText(`[data-gauge-text='output-${id}']`, formatPercent(outputOf(id)));

    setMiniGauge(`hp-${id}`, p.hp, state.settings.hpCrash.initialHp);
    setMiniGauge(`charge-${id}`, p.debt, 100);
    setMiniGauge(`output-${id}`, outputOf(id), 100);
    setText(`[data-mini-gauge-text='hp-${id}']`, String(Math.round(p.hp)));
    setText(`[data-mini-gauge-text='charge-${id}']`, String(Math.round(p.debt)));
    setText(`[data-mini-gauge-text='output-${id}']`, formatPercent(outputOf(id)));

    setText(`[data-charge-number='${id}']`, String(Math.round(p.hp)));
  }
}

function updateDiceDisplays() {
  if (!state.game) {
    return;
  }

  for (const id of ["p1", "p2"]) {
    const p = state.game.players[id];

    if (!p) {
      continue;
    }

    const active = state.game.attackerId === id;
    const faces = state.ui.diceRolling && active ? state.ui.rollFaces[id] : p.lastDice;
    const faceText = `${DICE[faces[0]]}${DICE[faces[1]]}`;
    setText(`[data-dice-face='${id}']`, faceText);
    setText(`[data-dice-result='${id}']`, p.lastRoll ? String(p.lastRoll) : "-");
  }
}

function setGauge(key, value, max) {
  setBar(`[data-gauge='${key}']`, percent(value, max));
}

function setMiniGauge(key, value, max) {
  setBar(`[data-mini-gauge='${key}']`, percent(value, max));
}

function setBar(selector, pct) {
  document.querySelectorAll(selector).forEach((el) => {
    el.style.width = `${clamp(pct, 0, 100)}%`;
  });
}

function setText(selector, text) {
  document.querySelectorAll(selector).forEach((el) => {
    el.textContent = text;
  });
}

function phaseHintText() {
  if (!state.game) {
    return "";
  }

  if (state.paused) {
    return "一時停止中";
  }

  if (state.game.status === STATUS.WAIT_ACTION) {
    const attacker = currentAttacker();
    const can = canRelease() ? " / 蓄積解放可能" : "";
    return `${attacker?.name || ""} の操作待ち${can}`;
  }

  if (state.game.status === STATUS.ROLLING_ATTACK) {
    return "攻撃ダイス判定中";
  }

  if (state.game.status === STATUS.ROLLING_RELEASE) {
    return "蓄積解放判定中";
  }

  if (state.game.status === STATUS.REVEAL) {
    return "結果表示中";
  }

  return "";
}

function currentAttacker() {
  return state.game?.players?.[state.game.attackerId] || null;
}

function currentDefender() {
  return state.game?.players?.[state.game.defenderId] || null;
}

function playerName(id) {
  return state.game?.players?.[id]?.name || id.toUpperCase();
}

function colorPlayerNames(text) {
  let html = escape(text);

  if (!state.game) {
    return html;
  }

  for (const id of ["p1", "p2"]) {
    const p = state.game.players[id];

    if (!p || !p.name) {
      continue;
    }

    const safeName = escape(p.name);
    const cls = `tone-text-${p.colorIndex}`;
    html = html.split(safeName).join(`<span class="player-name-inline ${cls}">${safeName}</span>`);
  }

  return html;
}

function loadVoices() {
  if (!("speechSynthesis" in window)) {
    state.ui.voices = [];
    return;
  }

  state.ui.voices = window.speechSynthesis.getVoices() || [];
}

async function unlockAudio() {
  if (state.audio.unlocked) {
    return;
  }

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      return;
    }

    state.audio.ctx = state.audio.ctx || new AudioContextClass();

    if (state.audio.ctx.state === "suspended") {
      await state.audio.ctx.resume();
    }

    state.audio.master = state.audio.master || state.audio.ctx.createGain();
    state.audio.master.gain.value = state.settings.audio.soundVolume;
    state.audio.master.connect(state.audio.ctx.destination);
    state.audio.unlocked = true;
  } catch {}
}

function playSound(kind) {
  const audio = state.settings.audio;

  if (!audio.soundEnabled || !state.audio.ctx || !state.audio.master) {
    return;
  }

  try {
    const ctx = state.audio.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;

    let freq = 440;
    let duration = 0.12;
    let type = "sine";

    if (kind === "roll") {
      freq = 220;
      duration = 0.08;
      type = "square";
    } else if (kind === "hit") {
      freq = 520;
      duration = 0.14;
      type = "sawtooth";
    } else if (kind === "critical") {
      freq = 880;
      duration = 0.22;
      type = "sawtooth";
    } else if (kind === "warning") {
      freq = 160;
      duration = 0.35;
      type = "square";
    } else if (kind === "result") {
      freq = 660;
      duration = 0.5;
      type = "triangle";
    } else if (kind === "turn") {
      freq = 360;
      duration = 0.1;
      type = "triangle";
    } else if (kind === "test") {
      freq = 300;
      duration = 0.08;
      type = "sine";
    }

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18 * audio.soundVolume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(state.audio.master);
    osc.start(now);
    osc.stop(now + duration + 0.03);
  } catch {}
}

function speakMessage(text) {
  const audio = state.settings.audio;

  if (!audio.speechEnabled || !("speechSynthesis" in window)) {
    return;
  }

  const value = String(text || "").replace(/\n/g, "。");

  if (!value || value === state.audio.lastSpeech) {
    return;
  }

  state.audio.lastSpeech = value;

  try {
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(value);
    utterance.lang = "ja-JP";
    utterance.rate = audio.speechRate;
    utterance.pitch = audio.speechPitch;
    utterance.volume = audio.speechVolume;

    if (audio.voiceName) {
      const voice = state.ui.voices.find((v) => v.name === audio.voiceName);

      if (voice) {
        utterance.voice = voice;
      }
    }

    window.speechSynthesis.speak(utterance);
  } catch {}
}

function testSpeech() {
  speakMessage("HPクラッシュバトル、音声テストです。");
}

function updateAudioValueLabel(key, value) {
  setText(`#audio-value-${CSS.escape(key)}`, formatAudioValue(key, value));
}

function formatAudioValue(key, value) {
  const n = Number(value || 0);

  if (key.includes("Volume")) {
    return `${Math.round(n * 100)}%`;
  }

  return n.toFixed(1);
}

function toast(message) {
  if (!toastRoot) {
    return;
  }

  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  toastRoot.appendChild(item);

  setTimeout(() => {
    item.classList.add("hide");
  }, 2200);

  setTimeout(() => {
    item.remove();
  }, 2800);
}

function log(message) {
  if (!message) {
    return;
  }

  const time = new Date().toLocaleTimeString("ja-JP", { hour12: false });
  state.log.push(`${time} ${message}`);
  state.log = state.log.slice(-100);

  const box = document.querySelector(".log-box");

  if (box) {
    box.innerHTML = state.log.map(escape).join("<br>");
  }
}

function scrollTopSoon() {
  requestAnimationFrame(() => {
    try {
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch {
      window.scrollTo(0, 0);
    }
  });
}

function randDice() {
  return Math.floor(Math.random() * 6) + 1;
}

function percent(value, max) {
  return clamp((Number(value || 0) / Math.max(1, Number(max || 1))) * 100, 0, 100);
}

function formatPercent(value) {
  const n = Number(value || 0);

  if (Math.abs(n - Math.round(n)) < 0.05) {
    return `${Math.round(n)}%`;
  }

  return `${n.toFixed(1)}%`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function intClamp(value, min, max) {
  return Math.round(clamp(value, min, max));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
