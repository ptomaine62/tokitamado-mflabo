"use strict";

const VERSION = "20260605-06";
const PRODUCT_FAMILY = "SHOCKiG REARENA POCKET";
const PRODUCT_NAME = "DICE CHARGE BATTLE";
const ACCESS_CODE = "DCB-MFLABO-202606";
const DEVICE_NAME_PREFIX = "ID:47L";

const BLE_SERVICE_UUID = "0000180c-0000-1000-8000-00805f9b34fb";
const BLE_WRITE_CHAR_UUID = "0000150a-0000-1000-8000-00805f9b34fb";
const BLE_NOTIFY_CHAR_UUID = "0000150b-0000-1000-8000-00805f9b34fb";

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
  WAIT_P1: "WAIT_P1",
  ROLLING_P1: "ROLLING_P1",
  WAIT_P2: "WAIT_P2",
  ROLLING_P2: "ROLLING_P2",
  REVEAL: "REVEAL",
  SETTLEMENT_COUNTDOWN: "SETTLEMENT_COUNTDOWN",
  SETTLEMENT_PULSE: "SETTLEMENT_PULSE",
  FINAL_COUNTDOWN: "FINAL_COUNTDOWN",
  FINAL_PULSE: "FINAL_PULSE",
  RESULT: "RESULT"
};

const STORE = {
  access: "dcb_access_granted_v3",
  disclaimer: "dcb_disclaimer_accepted_v3",
  settings: "dcb_settings_v3"
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
    A: { limit: 30, testPercent: 5, pulseWidth: 10, frequency: 100, tested: false },
    B: { limit: 30, testPercent: 5, pulseWidth: 10, frequency: 100, tested: false }
  },
  rules: {
    rounds: 10,
    diceSides: 6,
    chargeMultiplier: 5,
    drawCharge: 3,
    continuousStim: true,
    continuousOnMs: 500,
    continuousOffMs: 1500,
    settlementStim: true,
    settlementCountdownMs: 3000,
    settlementBonusPercent: 5,
    settlementDurationMs: 900,
    finalSettlementCountdownMs: 3000,
    finalSettlementBonusPercent: 8,
    finalSettlementDurationMs: 2000
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
    writeCharacteristic: null,
    notifyCharacteristic: null,
    sending: false,
    lastSendAt: 0,
    lastPacket: "",
    sequence: 1,
    lastActualA: 0,
    lastActualB: 0
  },
  ui: {
    rotated: false,
    message: "",
    tone: "normal",
    diceRolling: false,
    rollFaces: { p1: 1, p2: 1 },
    countdownEnd: 0,
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

  bindDocumentEvents();
  bindSafetyEvents();
  loadVoices();
  startOutputLoop();
  startLiveDomLoop();
  render();
  scrollTopSoon();
  log("起動しました");
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

  if (action === "roll") {
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
  else if (action === "roll") rollCurrentDice();
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

  if (el.dataset.rule) {
    const min = Number(el.min);
    const max = Number(el.max);
    state.settings.rules[el.dataset.rule] = intClamp(el.value, min, max);
    saveSettings();
    return;
  }

  if (el.dataset.ruleSec) {
    const min = Number(el.min);
    const max = Number(el.max);
    const seconds = clamp(el.value, min, max);
    state.settings.rules[el.dataset.ruleSec] = Math.round(seconds * 1000);
    saveSettings();
    return;
  }

  if (el.dataset.check) {
    const section = el.dataset.section || "rules";
    state.settings[section][el.dataset.check] = el.checked;
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
    return `<span class="dot connected">●</span>低周波デバイス接続`;
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
        <h1 class="brand-title">DICE<br>CHARGE<br>BATTLE</h1>
        <div class="brand-ja">アクセスコード</div>
        <p class="notice">
          BOOTH購入者向けAccess Codeを入力してください。<br>
          認証前はゲーム・接続・安全ロック解除へ進めません。
        </p>
        <div class="form-stack">
          <label class="field-label">Access Code</label>
          <input id="access-code" class="input big-input" autocomplete="off" inputmode="latin" placeholder="DCB-..." />
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
        <p>本アプリは低周波BLEデバイスを制御します。必ず低い出力から開始してください。</p>
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
      ${header(PRODUCT_NAME, "低周波デバイス接続")}
      <div class="grid two">
        <div class="card">
          <h2>接続</h2>
          <p class="muted">Web Bluetoothで低周波デバイスへ直接接続します。HTTPS環境と対応ブラウザが必要です。</p>
          <div class="button-stack">
            <button class="btn primary wide stable-btn" data-action="connect-known">かんたん接続</button>
            <button class="btn cyan wide stable-btn" data-action="connect-preferred">推奨IDから探す</button>
            <button class="btn ghost wide stable-btn" data-action="connect-manual">手動で探す</button>
            <button class="btn danger wide stable-btn" data-action="disconnect">切断</button>
          </div>
        </div>
        <div class="card">
          <h2>確認モード</h2>
          <p class="muted">BLE送信なしで、画面・音・進行・出力ゲージだけ確認できます。</p>
          <button class="btn orange wide stable-btn" data-action="connect-simulation">低周波デバイスなし確認モード</button>
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
        ${rangeInput(`width-${ch}`, "パルス幅", cfg.pulseWidth, 1, 60, 1, "μs")}
        ${rangeInput(`freq-${ch}`, "周波数", cfg.frequency, 1, 200, 1, "Hz")}
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
  const r = state.settings.rules;
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
        <h2>ルール</h2>
        <div class="setup-grid">
          ${numberField("rounds", "ラウンド数", r.rounds, 3, 30, 1)}
          ${numberField("chargeMultiplier", "出目差チャージ", r.chargeMultiplier, 1, 20, 1)}
          ${numberField("drawCharge", "あいこチャージ", r.drawCharge, 0, 20, 1)}
          ${checkField("continuousStim", "継続出力", r.continuousStim)}
          ${secondField("continuousOnMs", "継続ON時間（秒）", r.continuousOnMs, 0.1, 5, 0.1)}
          ${secondField("continuousOffMs", "継続OFF時間（秒）", r.continuousOffMs, 0.1, 10, 0.1)}
          ${checkField("settlementStim", "精算イベント", r.settlementStim)}
          ${secondField("settlementCountdownMs", "精算カウント（秒）", r.settlementCountdownMs, 0, 10, 0.5)}
          ${numberField("settlementBonusPercent", "精算ボーナス%", r.settlementBonusPercent, 0, 50, 1)}
          ${secondField("settlementDurationMs", "精算時間（秒）", r.settlementDurationMs, 0.1, 10, 0.1)}
          ${secondField("finalSettlementCountdownMs", "最終精算カウント（秒）", r.finalSettlementCountdownMs, 0, 10, 0.5)}
          ${numberField("finalSettlementBonusPercent", "最終精算ボーナス%", r.finalSettlementBonusPercent, 0, 50, 1)}
          ${secondField("finalSettlementDurationMs", "最終精算時間（秒）", r.finalSettlementDurationMs, 0.1, 15, 0.1)}
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

function numberField(key, label, value, min, max, step) {
  return `
    <label class="field-label">
      ${escape(label)}
      <input class="input" type="number" id="rule-${escape(key)}" value="${escape(value)}" min="${min}" max="${max}" step="${step}" data-rule="${escape(key)}">
    </label>
  `;
}

function secondField(key, label, valueMs, min, max, step) {
  const valueSec = Number((Number(valueMs || 0) / 1000).toFixed(2));

  return `
    <label class="field-label">
      ${escape(label)}
      <input class="input" type="number" id="rule-sec-${escape(key)}" value="${escape(valueSec)}" min="${min}" max="${max}" step="${step}" data-rule-sec="${escape(key)}">
    </label>
  `;
}

function checkField(key, label, checked, section = "rules") {
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
      ${header("DICE CHARGE BATTLE", g.message, { rotate: true, menu: true })}

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
          <div class="round-label">${renderRoundLabel()}</div>
          ${renderMessageBox(state.ui.message || g.message, state.ui.tone)}
          ${state.paused ? `<div class="pause-banner">PAUSED：再開するまで進行しません</div>` : ""}
          <div class="phase-hint" id="phase-hint">${escape(phaseHintText())}</div>
          <div class="countdown-line" id="countdown-line">${countdownText()}</div>
          <div class="message-advance-hint" id="advance-hint">${canAdvance() ? "タップでスキップ" : "自動進行します"}</div>

          <div class="dice-area">
            ${renderDiceBox("p1")}
            ${renderDiceBox("p2")}
          </div>

          <div class="battle-actions">
            <button class="btn primary big stable-btn" id="btn-roll" data-action="roll" ${canRoll() ? "" : "disabled"}>
              🎲 ふる
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

function renderRoundLabel() {
  const g = state.game;

  if (g.suddenDeath) {
    return `<span class="round-main sudden">SUDDEN DEATH</span>`;
  }

  return `
    <span class="round-main">ROUND ${escape(g.round)} / ${escape(g.maxRounds)}</span>
    <span class="round-sub">CHARGE BATTLE</span>
  `;
}

function renderBattlePlayerCard(id) {
  const p = state.game.players[id];
  const ch = p.channel;
  const maxCharge = maxChargeValue();
  const active = state.game.currentRoller === id;
  const loser = state.game.lastLoser === id;
  const winner = state.game.lastWinner === id;

  return `
    <section class="battle-player-card card player-tone-${p.colorIndex} ${active ? "is-active" : ""} ${loser ? "is-loser" : ""} ${winner ? "is-winner" : ""}">
      <div class="battle-player-top">
        <div>
          <div class="player-id">${escape(id.toUpperCase())} / CH ${escape(ch)}</div>
          <h2 class="battle-player-name">${escape(p.name)}</h2>
        </div>
        <div class="battle-charge-number" data-charge-number="${id}">${Math.round(p.charge)}</div>
      </div>

      <div class="battle-gauge-stack">
        ${gauge("HP", p.hp, 100, "hp", id)}
        ${gauge("Charge", p.charge, maxCharge, "charge", id)}
        ${gauge("OUTPUT", outputOf(id), 100, "output", id)}
      </div>

      <div class="battle-player-meta">
        <span>LIMIT ${escape(state.settings.channels[ch].limit)}%</span>
        <span>DICE <b data-dice-value="${id}">${p.lastRoll || "-"}</b></span>
      </div>
    </section>
  `;
}

function renderMiniHud(id) {
  const p = state.game.players[id];
  const maxCharge = maxChargeValue();

  return `
    <section class="mini-hud-card player-tone-${p.colorIndex}">
      <div class="mini-hud-head">
        <b>${escape(p.name)}</b>
        <span>CH ${escape(p.channel)}</span>
      </div>
      <div class="mini-hud-gauges">
        ${miniGauge("HP", p.hp, 100, "hp", id)}
        ${miniGauge("Charge", p.charge, maxCharge, "charge", id)}
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
  const face = state.ui.diceRolling && state.game.currentRoller === id ? state.ui.rollFaces[id] : p.lastRoll || 1;
  const active = state.game.currentRoller === id;

  return `
    <div class="dice-box player-tone-${p.colorIndex} ${active ? "active" : ""}">
      <div class="dice-owner">${escape(p.name)}</div>
      <div class="dice-face ${state.ui.diceRolling && active ? "rolling" : ""}" data-dice-face="${id}">${DICE[face]}</div>
      <div class="dice-value" data-dice-result="${id}">${p.lastRoll || "-"}</div>
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
  const p1 = g?.players?.p1 || { name: "P1", charge: 0 };
  const p2 = g?.players?.p2 || { name: "P2", charge: 0 };

  view.innerHTML = `
    <section class="screen">
      ${header(PRODUCT_NAME, "RESULT")}
      <div class="card result-card">
        <h1 class="result-title">RESULT</h1>
        <p class="result-reason">${escape(g?.resultReason || "")}</p>
        <div class="grid two">
          <div class="score-card player-tone-1">
            <h2>${escape(p1.name)}</h2>
            <div class="score-number">${Math.round(p1.charge)}</div>
            <p>Charge</p>
          </div>
          <div class="score-card player-tone-2">
            <h2>${escape(p2.name)}</h2>
            <div class="score-number">${Math.round(p2.charge)}</div>
            <p>Charge</p>
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
      toast("過去に許可した低周波デバイスがありません");
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
      handleConnectError(`推奨ID接続失敗: ${error.message}`);
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
  state.device.name = device.name || "低周波デバイス";

  device.addEventListener("gattserverdisconnected", () => {
    handleDeviceDisconnected();
  });

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(BLE_SERVICE_UUID);

  state.device.writeCharacteristic = await service.getCharacteristic(BLE_WRITE_CHAR_UUID);

  try {
    state.device.notifyCharacteristic = await service.getCharacteristic(BLE_NOTIFY_CHAR_UUID);
    await state.device.notifyCharacteristic.startNotifications();
    state.device.notifyCharacteristic.addEventListener("characteristicvaluechanged", handleCoyoteNotify);
    log("Notifyを開始しました");
  } catch (error) {
    state.device.notifyCharacteristic = null;
    log(`Notify開始失敗: ${error.message}`);
  }

  state.device.mode = "ble";
  state.device.connected = true;
  state.device.sequence = 1;
  state.device.lastActualA = 0;
  state.device.lastActualB = 0;

  await sendCoyoteInit();
  await sendZeroRepeated();

  log(`低周波デバイス接続: ${state.device.name}`);
  setPhase(PHASE.CHANNEL_TEST);
}

function handleCoyoteNotify(event) {
  const value = event.target?.value;

  if (!value || value.byteLength < 1) {
    return;
  }

  const bytes = [];

  for (let i = 0; i < value.byteLength; i++) {
    bytes.push(value.getUint8(i));
  }

  if (bytes[0] === 0xB1 && bytes.length >= 4) {
    state.device.lastActualA = bytes[2];
    state.device.lastActualB = bytes[3];
    return;
  }

  log(`BLE Notify: ${bytesToHex(bytes)}`);
}

function handleDeviceDisconnected() {
  state.device.mode = "none";
  state.device.connected = false;
  state.device.name = "";
  state.device.bluetoothDevice = null;
  state.device.writeCharacteristic = null;
  state.device.notifyCharacteristic = null;
  stopAllOutputLocal();

  if (state.phase === PHASE.PLAYING) {
    safeStop("低周波デバイスが切断されました");
  } else {
    log("低周波デバイスが切断されました");
    toast("低周波デバイスが切断されました");
    render();
  }
}

function connectSimulation() {
  if (!guardAccess()) {
    return;
  }

  state.device.mode = "simulation";
  state.device.connected = true;
  state.device.name = "低周波デバイスなし確認モード";
  log("確認モードで開始");
  setPhase(PHASE.CHANNEL_TEST);
}

async function disconnectDevice(goConnect) {
  await sendZeroRepeated();

  try {
    if (state.device.notifyCharacteristic) {
      state.device.notifyCharacteristic.removeEventListener("characteristicvaluechanged", handleCoyoteNotify);
      await state.device.notifyCharacteristic.stopNotifications();
    }
  } catch {}

  try {
    if (state.device.bluetoothDevice?.gatt?.connected) {
      state.device.bluetoothDevice.gatt.disconnect();
    }
  } catch {}

  state.device.mode = "none";
  state.device.connected = false;
  state.device.name = "";
  state.device.bluetoothDevice = null;
  state.device.writeCharacteristic = null;
  state.device.notifyCharacteristic = null;
  log("切断しました");

  if (goConnect) {
    setPhase(PHASE.CONNECT);
  }
}

function startChannelTest(ch) {
  if (!state.device.connected) {
    toast("先に接続または確認モードを選んでください");
    return;
  }

  const cfg = state.settings.channels[ch];
  state.output.testHold = {
    channel: ch,
    percent: clamp(cfg.testPercent, 0, cfg.limit)
  };

  setMessage(`チャンネル${ch} テスト中`, "normal", false);
}

function stopChannelTest() {
  const hold = state.output.testHold;

  if (!hold) {
    return;
  }

  state.settings.channels[hold.channel].tested = true;
  state.output.testHold = null;
  state.output.A = 0;
  state.output.B = 0;
  saveSettings();
  sendZeroRepeated();
  render();
}

function startGame() {
  if (!guardAccess()) {
    return;
  }

  if (!state.disclaimerAccepted) {
    setPhase(PHASE.DISCLAIMER);
    return;
  }

  if (!state.device.connected) {
    toast("先に接続または確認モードを選んでください");
    setPhase(PHASE.CONNECT);
    return;
  }

  if (!state.settings.channels.A.tested || !state.settings.channels.B.tested) {
    toast("A/B両方のテスト完了が必要です");
    setPhase(PHASE.CHANNEL_TEST);
    return;
  }

  const p1Name = state.settings.players.p1.name || "P1";
  const p2Name = state.settings.players.p2.name || "P2";

  state.paused = false;
  state.output.testHold = null;
  state.output.eventPulse = null;
  state.ui.rotated = false;
  state.ui.countdownEnd = 0;
  state.ui.skipHandler = null;

  state.game = {
    status: STATUS.WAIT_P1,
    round: 1,
    maxRounds: intClamp(state.settings.rules.rounds, 3, 30),
    suddenDeath: false,
    currentRoller: "p1",
    lastLoser: null,
    lastWinner: null,
    pendingContinuousPlayers: [],
    message: `${p1Name} のターンです。\nダイスを振ってください。`,
    resultReason: "",
    players: {
      p1: { name: p1Name, channel: "A", colorIndex: 1, hp: 100, charge: 0, lastRoll: null, continuousActive: false },
      p2: { name: p2Name, channel: "B", colorIndex: 2, hp: 100, charge: 0, lastRoll: null, continuousActive: false }
    }
  };

  setMessage(state.game.message, "normal");
  setPhase(PHASE.PLAYING);
}

function rollCurrentDice() {
  if (!canRoll()) {
    return;
  }

  clearAutoTimer();

  const g = state.game;
  const roller = g.status === STATUS.WAIT_P1 ? "p1" : "p2";

  g.status = roller === "p1" ? STATUS.ROLLING_P1 : STATUS.ROLLING_P2;
  g.currentRoller = roller;
  state.ui.diceRolling = true;
  state.ui.skipHandler = null;
  state.ui.countdownEnd = 0;

  setMessage(`${g.players[roller].name} がダイスを振った！`, "normal");
  playSound("roll");
  startDiceAnimation(roller);
  render();

  setAutoTimer(() => {
    const roll = randomDice();

    g.players[roller].lastRoll = roll;
    state.ui.rollFaces[roller] = roll;
    state.ui.diceRolling = false;
    playSound("decide");

    if (roller === "p1") {
      g.status = STATUS.WAIT_P2;
      g.currentRoller = "p2";
      g.message = `${g.players.p1.name} は ${roll}。\n${g.players.p2.name} のターンです。`;
      setMessage(g.message, "normal");
      render();
    } else {
      g.status = STATUS.REVEAL;
      g.currentRoller = null;
      revealRound();
    }
  }, TIMING.diceMs);
}

function revealRound() {
  const g = state.game;
  const r = state.settings.rules;
  const p1 = g.players.p1;
  const p2 = g.players.p2;
  const diff = Math.abs(p1.lastRoll - p2.lastRoll);

  let loser = null;
  let winner = null;
  let added = 0;

  g.pendingContinuousPlayers = [];

  if (p1.lastRoll === p2.lastRoll) {
    added = intClamp(r.drawCharge, 0, 1000);
    p1.charge += added;
    p2.charge += added;
    g.pendingContinuousPlayers = ["p1", "p2"];
    g.message = `あいこ！ ${p1.lastRoll} - ${p2.lastRoll}\n両者にCharge +${added}`;
  } else {
    loser = p1.lastRoll < p2.lastRoll ? "p1" : "p2";
    winner = loser === "p1" ? "p2" : "p1";
    added = diff * intClamp(r.chargeMultiplier, 1, 100);
    g.players[loser].charge += added;
    g.players[loser].hp = clamp(g.players[loser].hp - diff * 3, 0, 100);
    g.pendingContinuousPlayers = [loser];
    g.message = `${g.players[winner].name} の勝ち！ ${p1.lastRoll} - ${p2.lastRoll}\n${g.players[loser].name} にCharge +${added}`;
  }

  g.status = STATUS.REVEAL;
  g.lastLoser = loser;
  g.lastWinner = winner;

  setMessage(g.message, loser ? "stim" : "normal");
  render();

  state.ui.skipHandler = () => {
    if (r.settlementStim && loser) {
      beginSettlementCountdown(loser);
    } else {
      activatePendingContinuous();
      endRound();
    }
  };

  setAutoTimer(state.ui.skipHandler, loser ? TIMING.stimHoldMs : TIMING.normalHoldMs);
}

function beginSettlementCountdown(loser) {
  const g = state.game;
  const ms = intClamp(state.settings.rules.settlementCountdownMs, 0, 10000);

  clearAutoTimer();
  g.status = STATUS.SETTLEMENT_COUNTDOWN;
  g.message = `${g.players[loser].name} 精算カウントダウン`;
  state.ui.countdownEnd = Date.now() + ms;

  setMessage(g.message, "warning");
  render();

  state.ui.skipHandler = () => startSettlementPulse(loser);
  setAutoTimer(state.ui.skipHandler, ms);
}

function startSettlementPulse(loser) {
  const g = state.game;
  const r = state.settings.rules;

  clearAutoTimer();
  g.status = STATUS.SETTLEMENT_PULSE;
  g.message = `${g.players[loser].name} 精算！`;
  state.ui.countdownEnd = 0;
  state.ui.skipHandler = null;

  startPulse(g.players[loser].channel, r.settlementBonusPercent, r.settlementDurationMs, "精算");
  setMessage(g.message, "stim");
  playSound("settlement");
  render();

  setAutoTimer(() => {
    activatePendingContinuous();
    endRound();
  }, intClamp(r.settlementDurationMs, 100, 10000) + 250);
}

function activatePendingContinuous() {
  if (!state.game || !Array.isArray(state.game.pendingContinuousPlayers)) {
    return;
  }

  for (const id of state.game.pendingContinuousPlayers) {
    if (state.game.players[id]) {
      state.game.players[id].continuousActive = true;
    }
  }

  state.game.pendingContinuousPlayers = [];
}

function endRound() {
  const g = state.game;

  clearAutoTimer();
  g.players.p1.lastRoll = null;
  g.players.p2.lastRoll = null;
  g.lastLoser = null;
  g.lastWinner = null;
  state.ui.countdownEnd = 0;
  state.ui.skipHandler = null;

  if (!g.suddenDeath && g.round >= g.maxRounds) {
    if (g.players.p1.charge === g.players.p2.charge) {
      g.suddenDeath = true;
      g.round += 1;
      g.status = STATUS.WAIT_P1;
      g.currentRoller = "p1";
      g.message = `同点！ サドンデスへ。\n${g.players.p1.name} から振ってください。`;
      setMessage(g.message, "warning");
      render();
      return;
    }

    beginFinalCountdown();
    return;
  }

  if (g.suddenDeath && g.players.p1.charge !== g.players.p2.charge) {
    beginFinalCountdown();
    return;
  }

  g.round += 1;
  g.status = STATUS.WAIT_P1;
  g.currentRoller = "p1";
  g.message = `ROUND ${g.round} 開始。\n${g.players.p1.name} のターンです。`;

  setMessage(g.message, "normal");
  render();
}

function beginFinalCountdown() {
  const g = state.game;
  const loser = g.players.p1.charge > g.players.p2.charge ? "p1" : "p2";
  const winner = loser === "p1" ? "p2" : "p1";
  const ms = intClamp(state.settings.rules.finalSettlementCountdownMs, 0, 10000);

  clearAutoTimer();
  g.status = STATUS.FINAL_COUNTDOWN;
  g.lastLoser = loser;
  g.lastWinner = winner;
  g.message = `勝者 ${g.players[winner].name}。\n最終精算カウントダウン`;
  state.ui.countdownEnd = Date.now() + ms;

  setMessage(g.message, "warning");
  render();

  state.ui.skipHandler = () => startFinalPulse(loser);
  setAutoTimer(state.ui.skipHandler, ms);
}

function startFinalPulse(loser) {
  const g = state.game;
  const r = state.settings.rules;

  clearAutoTimer();
  g.status = STATUS.FINAL_PULSE;
  g.message = `${g.players[loser].name} 最終精算！`;
  state.ui.countdownEnd = 0;
  state.ui.skipHandler = null;

  startPulse(g.players[loser].channel, r.finalSettlementBonusPercent, r.finalSettlementDurationMs, "最終精算");
  setMessage(g.message, "critical");
  playSound("settlement");
  render();

  setAutoTimer(showResult, intClamp(r.finalSettlementDurationMs, 100, 15000) + 350);
}

function showResult() {
  const g = state.game;
  const p1 = g.players.p1;
  const p2 = g.players.p2;
  const winner = p1.charge <= p2.charge ? p1 : p2;
  const loser = winner === p1 ? p2 : p1;

  stopAllOutputLocal();
  state.ui.rotated = false;
  applyRotation();

  g.status = STATUS.RESULT;
  g.resultReason = `${winner.name} の勝利！\n${winner.name}: Charge ${Math.round(winner.charge)} / ${loser.name}: Charge ${Math.round(loser.charge)}`;

  setMessage(`${winner.name} の勝利です`, "result");
  playSound("victory");
  setPhase(PHASE.RESULT);
}

function advanceMessage() {
  if (!canAdvance()) {
    return;
  }

  const fn = state.ui.skipHandler;

  if (fn) {
    clearAutoTimer();
    fn();
  }
}

function canAdvance() {
  if (!state.game || state.paused) {
    return false;
  }

  return Boolean(state.ui.skipHandler);
}

function canRoll() {
  if (!state.game || state.paused) {
    return false;
  }

  return state.game.status === STATUS.WAIT_P1 || state.game.status === STATUS.WAIT_P2;
}

function phaseHintText() {
  const g = state.game;

  if (!g) {
    return "";
  }

  if (g.status === STATUS.WAIT_P1) return `${g.players.p1.name} のロール待ち`;
  if (g.status === STATUS.WAIT_P2) return `${g.players.p2.name} のロール待ち`;
  if (g.status === STATUS.ROLLING_P1 || g.status === STATUS.ROLLING_P2) return "ダイスロール中";
  if (g.status === STATUS.REVEAL) return "結果表示中";
  if (g.status === STATUS.SETTLEMENT_COUNTDOWN) return "精算カウントダウン";
  if (g.status === STATUS.SETTLEMENT_PULSE) return "精算出力中";
  if (g.status === STATUS.FINAL_COUNTDOWN) return "最終精算カウントダウン";
  if (g.status === STATUS.FINAL_PULSE) return "最終精算出力中";
  return "進行中";
}

function countdownText() {
  if (!state.ui.countdownEnd) {
    return "";
  }

  const remain = Math.max(0, state.ui.countdownEnd - Date.now());
  return `${(remain / 1000).toFixed(1)} 秒`;
}

function startDiceAnimation(roller) {
  clearInterval(state.timers.dice);

  state.timers.dice = setInterval(() => {
    state.ui.rollFaces[roller] = randomDice();
    const face = document.querySelector(`[data-dice-face="${roller}"]`);

    if (face) {
      face.textContent = DICE[state.ui.rollFaces[roller]];
    }
  }, TIMING.diceTickMs);

  setTimeout(() => {
    clearInterval(state.timers.dice);
    state.timers.dice = null;
  }, TIMING.diceMs);
}

function startPulse(channel, bonusPercent, durationMs, reason) {
  state.output.eventPulse = {
    channel,
    bonusPercent: clamp(bonusPercent, 0, 100),
    until: Date.now() + intClamp(durationMs, 100, 15000),
    reason
  };
}

function startOutputLoop() {
  clearInterval(state.timers.output);
  state.timers.output = setInterval(updateOutput, TIMING.outputTickMs);
}

function startLiveDomLoop() {
  clearInterval(state.timers.live);
  state.timers.live = setInterval(updateLiveDom, TIMING.gaugeTickMs);
}

function updateOutput() {
  let A = 0;
  let B = 0;

  if (state.phase === PHASE.SAFE_LOCKED || state.paused) {
    A = 0;
    B = 0;
  } else if (state.output.testHold) {
    if (state.output.testHold.channel === "A") A = state.output.testHold.percent;
    if (state.output.testHold.channel === "B") B = state.output.testHold.percent;
  } else if (state.phase === PHASE.PLAYING && state.game) {
    const r = state.settings.rules;

    if (r.continuousStim) {
      const onMs = intClamp(r.continuousOnMs, 100, 10000);
      const offMs = intClamp(r.continuousOffMs, 100, 10000);
      const active = Date.now() % (onMs + offMs) < onMs;

      if (active) {
        if (state.game.players.p1.continuousActive) {
          A += chargeToOutput(state.game.players.p1.charge);
        }

        if (state.game.players.p2.continuousActive) {
          B += chargeToOutput(state.game.players.p2.charge);
        }
      }
    }

    const pulse = state.output.eventPulse;

    if (pulse) {
      if (Date.now() <= pulse.until) {
        if (pulse.channel === "A") A += pulse.bonusPercent;
        if (pulse.channel === "B") B += pulse.bonusPercent;
      } else {
        state.output.eventPulse = null;
      }
    }
  }

  state.output.A = limitChannel("A", A);
  state.output.B = limitChannel("B", B);
  sendOutputThrottled(state.output.A, state.output.B);
}

function updateLiveDom() {
  if (state.phase !== PHASE.PLAYING && state.phase !== PHASE.CHANNEL_TEST) {
    return;
  }

  if (state.phase === PHASE.CHANNEL_TEST) {
    setWidth(`[data-out-bar="A"]`, state.output.A);
    setWidth(`[data-out-bar="B"]`, state.output.B);
    return;
  }

  if (!state.game) {
    return;
  }

  const maxCharge = maxChargeValue();

  updatePlayerLive("p1", maxCharge);
  updatePlayerLive("p2", maxCharge);

  const countdown = document.getElementById("countdown-line");

  if (countdown) {
    countdown.textContent = countdownText();
  }

  const phaseHint = document.getElementById("phase-hint");

  if (phaseHint) {
    phaseHint.textContent = phaseHintText();
  }

  const advanceHint = document.getElementById("advance-hint");

  if (advanceHint) {
    advanceHint.textContent = canAdvance() ? "タップでスキップ" : "自動進行します";
    advanceHint.classList.toggle("muted-hint", !canAdvance());
  }
}

function updatePlayerLive(id, maxCharge) {
  const p = state.game.players[id];
  const out = outputOf(id);

  setText(`[data-charge-number="${id}"]`, Math.round(p.charge));
  setText(`[data-dice-value="${id}"]`, p.lastRoll || "-");
  setText(`[data-dice-result="${id}"]`, p.lastRoll || "-");

  setGauge(`hp-${id}`, p.hp, 100, Math.round(p.hp));
  setGauge(`charge-${id}`, p.charge, maxCharge, Math.round(p.charge));
  setGauge(`output-${id}`, out, 100, formatPercent(out));

  setMiniGauge(`hp-${id}`, p.hp, 100, Math.round(p.hp));
  setMiniGauge(`charge-${id}`, p.charge, maxCharge, Math.round(p.charge));
  setMiniGauge(`output-${id}`, out, 100, formatPercent(out));
}

function setGauge(key, value, max, label) {
  setWidth(`[data-gauge="${key}"]`, percent(value, max));
  setText(`[data-gauge-text="${key}"]`, label);
}

function setMiniGauge(key, value, max, label) {
  setWidth(`[data-mini-gauge="${key}"]`, percent(value, max));
  setText(`[data-mini-gauge-text="${key}"]`, label);
}

function setWidth(selector, pct) {
  const el = document.querySelector(selector);

  if (el) {
    el.style.width = `${clamp(pct, 0, 100)}%`;
  }
}

function setText(selector, text) {
  const el = document.querySelector(selector);

  if (el) {
    el.textContent = text;
  }
}

function updateChannelSetting(el) {
  const [kind, ch] = el.dataset.range.split("-");
  const cfg = state.settings.channels[ch];

  if (!cfg) {
    return;
  }

  if (kind === "limit") cfg.limit = intClamp(el.value, 0, 100);
  if (kind === "test") cfg.testPercent = intClamp(el.value, 0, 100);
  if (kind === "width") cfg.pulseWidth = intClamp(el.value, 1, 60);
  if (kind === "freq") cfg.frequency = intClamp(el.value, 1, 200);

  cfg.tested = false;
  saveSettings();

  const suffix = kind === "freq" ? "Hz" : kind === "width" ? "μs" : "%";
  setText(`#${CSS.escape(el.dataset.range)}-value`, `${el.value}${suffix}`);
}

function chargeToOutput(charge) {
  return clamp(Number(charge || 0) * 0.5, 0, 100);
}

function outputOf(id) {
  return id === "p1" ? state.output.A : state.output.B;
}

function limitChannel(ch, value) {
  return clamp(Math.min(value, state.settings.channels[ch].limit), 0, 100);
}

async function sendOutputThrottled(A, B) {
  const now = Date.now();

  if (now - state.device.lastSendAt < 100) {
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
    return;
  }

  if (state.device.mode !== "ble" || !state.device.writeCharacteristic || state.device.sending) {
    return;
  }

  state.device.sending = true;

  try {
    await writeBle(buildB0PacketV3(A, B));
  } catch (error) {
    state.device.sending = false;
    safeStop(`BLE送信エラー: ${error.message}`);
    return;
  }

  state.device.sending = false;
}

async function sendCoyoteInit() {
  if (state.device.mode !== "ble" || !state.device.writeCharacteristic) {
    return;
  }

  await writeBle(buildBfPacket());
  await sleep(80);
  await writeBle(buildB0PacketV3(0, 0));
  await sleep(80);
  await writeBle(buildB0PacketV3(0, 0));
  log("COYOTE初期化BF/B0を送信しました");
}

function buildBfPacket() {
  const aLimit = percentToCoyoteStrength(state.settings.channels.A.limit);
  const bLimit = percentToCoyoteStrength(state.settings.channels.B.limit);
  const freqBalanceA = 100;
  const freqBalanceB = 100;
  const strengthBalanceA = 100;
  const strengthBalanceB = 100;

  return new Uint8Array([
    0xBF,
    aLimit,
    bLimit,
    freqBalanceA,
    freqBalanceB,
    strengthBalanceA,
    strengthBalanceB
  ]);
}

function buildB0PacketV3(A, B) {
  const safeA = clamp(A, 0, 100);
  const safeB = clamp(B, 0, 100);
  const strengthA = percentToCoyoteStrength(safeA);
  const strengthB = percentToCoyoteStrength(safeB);
  const sequence = nextCoyoteSequence();
  const modeAbsoluteBoth = 0x0F;
  const sequenceAndMode = ((sequence & 0x0F) << 4) | modeAbsoluteBoth;

  const aFreq = buildFrequencyFrame(state.settings.channels.A.frequency, safeA);
  const aWave = buildWaveStrengthFrame(safeA);
  const bFreq = buildFrequencyFrame(state.settings.channels.B.frequency, safeB);
  const bWave = buildWaveStrengthFrame(safeB);

  return new Uint8Array([
    0xB0,
    sequenceAndMode,
    strengthA,
    strengthB,
    ...aFreq,
    ...aWave,
    ...bFreq,
    ...bWave
  ]);
}

function buildFrequencyFrame(frequency, percentValue) {
  if (percentValue <= 0) {
    return [10, 10, 10, 10];
  }

  const encoded = encodeCoyoteFrequency(frequency);
  return [encoded, encoded, encoded, encoded];
}

function buildWaveStrengthFrame(percentValue) {
  if (percentValue <= 0) {
    return [0, 0, 0, 0];
  }

  const peak = clamp(Math.round(percentValue), 1, 100);
  const v1 = clamp(Math.round(peak * 0.55), 1, 100);
  const v2 = clamp(Math.round(peak * 0.75), 1, 100);
  const v3 = clamp(Math.round(peak * 0.9), 1, 100);
  const v4 = clamp(Math.round(peak), 1, 100);

  return [v1, v2, v3, v4];
}

function percentToCoyoteStrength(percentValue) {
  return intClamp((clamp(percentValue, 0, 100) / 100) * 200, 0, 200);
}

function encodeCoyoteFrequency(inputFrequency) {
  const value = intClamp(inputFrequency, 10, 1000);

  if (value <= 100) {
    return value;
  }

  if (value <= 600) {
    return intClamp((value - 100) / 5 + 100, 101, 200);
  }

  return intClamp((value - 600) / 10 + 200, 201, 240);
}

function nextCoyoteSequence() {
  const seq = state.device.sequence;

  state.device.sequence += 1;

  if (state.device.sequence > 15) {
    state.device.sequence = 1;
  }

  return seq;
}

async function writeBle(packet) {
  if (!state.device.writeCharacteristic) {
    return;
  }

  try {
    if (typeof state.device.writeCharacteristic.writeValueWithoutResponse === "function") {
      await state.device.writeCharacteristic.writeValueWithoutResponse(packet);
      return;
    }
  } catch (error) {
    log(`writeValueWithoutResponse失敗: ${error.message}`);
  }

  if (typeof state.device.writeCharacteristic.writeValue === "function") {
    await state.device.writeCharacteristic.writeValue(packet);
    return;
  }

  throw new Error("BLE書き込みAPIが利用できません");
}

async function sendZeroRepeated() {
  stopAllOutputLocal();

  for (let i = 0; i < 5; i++) {
    await sendOutputPacket(0, 0);
    await sleep(45);
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
}

function clearTimers() {
  clearAutoTimer();
  clearInterval(state.timers.dice);
  state.timers.dice = null;
  state.ui.skipHandler = null;
  state.ui.countdownEnd = 0;
}

function clearAutoTimer() {
  clearTimeout(state.timers.auto);
  state.timers.auto = null;
}

function setAutoTimer(fn, ms) {
  clearAutoTimer();

  state.timers.auto = setTimeout(() => {
    if (!state.paused && state.phase !== PHASE.SAFE_LOCKED) {
      fn();
    }
  }, Math.max(0, ms));
}

function togglePause() {
  state.paused = !state.paused;

  if (state.paused) {
    stopAllOutputLocal();
    setMessage("一時停止しました", "normal");
  } else {
    setMessage("再開しました", "normal");
  }

  render();
}

function giveUp(playerId) {
  if (!state.game) {
    return;
  }

  const loser = state.game.players[playerId];
  const winner = playerId === "p1" ? state.game.players.p2 : state.game.players.p1;

  loser.charge += 50;
  state.game.resultReason = `${loser.name} がギブアップ。\n${winner.name} の勝利です。`;

  stopAllOutputLocal();
  state.ui.rotated = false;
  setPhase(PHASE.RESULT);
}

function toggleRotate() {
  if (state.phase !== PHASE.PLAYING) {
    return;
  }

  state.ui.rotated = !state.ui.rotated;
  applyRotation();
}

function applyRotation() {
  appShell.classList.toggle("screen-rotated", state.ui.rotated && state.phase === PHASE.PLAYING);
}

function safeReturnPrevious() {
  if (!state.accessGranted) {
    setPhase(PHASE.ACCESS);
    return;
  }

  if (!state.disclaimerAccepted) {
    setPhase(PHASE.DISCLAIMER);
    return;
  }

  const phase = state.safeReturnPhase || PHASE.CONNECT;

  if (phase === PHASE.PLAYING) {
    setPhase(PHASE.RULE_SETUP);
    return;
  }

  setPhase(phase);
}

function safeReturnChannel() {
  if (!state.accessGranted) {
    setPhase(PHASE.ACCESS);
    return;
  }

  if (!state.disclaimerAccepted) {
    setPhase(PHASE.DISCLAIMER);
    return;
  }

  if (!state.device.connected) {
    toast("先に接続または確認モードを選んでください");
    setPhase(PHASE.CONNECT);
    return;
  }

  setPhase(PHASE.CHANNEL_TEST);
}

function resetAccess() {
  localStorage.removeItem(STORE.access);
  localStorage.removeItem(STORE.disclaimer);

  state.accessGranted = false;
  state.disclaimerAccepted = false;
  stopAllOutputLocal();
  setPhase(PHASE.ACCESS);
}

function guardAccess() {
  if (!state.accessGranted) {
    safeStop("Access Code未認証のため停止しました");
    return false;
  }

  return true;
}

function setMessage(message, tone = "normal", speech = true) {
  state.ui.message = message;
  state.ui.tone = tone;

  if (state.game) {
    state.game.message = message;
  }

  log(message);

  if (speech) {
    speak(message);
  }
}

function colorPlayerNames(text) {
  if (!state.game) {
    return escape(text);
  }

  let html = escape(text);
  const p1 = escape(state.game.players.p1.name);
  const p2 = escape(state.game.players.p2.name);

  html = html.split(p1).join(`<span class="player-name-inline tone-text-1">${p1}</span>`);
  html = html.split(p2).join(`<span class="player-name-inline tone-text-2">${p2}</span>`);

  return html;
}

function maxChargeValue() {
  if (!state.game) {
    return 100;
  }

  return Math.max(100, state.game.players.p1.charge, state.game.players.p2.charge);
}

function randomDice() {
  return Math.floor(Math.random() * state.settings.rules.diceSides) + 1;
}

function percent(value, max) {
  return clamp((Number(value || 0) / Math.max(1, Number(max || 1))) * 100, 0, 100);
}

function clamp(value, min, max) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return min;
  }

  return Math.max(min, Math.min(max, n));
}

function intClamp(value, min, max) {
  return Math.round(clamp(value, min, max));
}

function formatPercent(value) {
  const n = Number(value || 0);

  if (Math.abs(n - Math.round(n)) < 0.05) {
    return `${Math.round(n)}%`;
  }

  return `${n.toFixed(1)}%`;
}

function formatAudioValue(key, value) {
  if (key === "soundVolume" || key === "speechVolume") {
    return `${Math.round(Number(value || 0) * 100)}%`;
  }

  return `${Number(value || 0).toFixed(1)}x`;
}

function updateAudioValueLabel(key, value) {
  setText(`#audio-value-${CSS.escape(key)}`, formatAudioValue(key, value));
}

function escape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function log(message) {
  if (!message) {
    return;
  }

  const time = new Date().toLocaleTimeString("ja-JP", { hour12: false });
  state.log.unshift(`${time} ${message}`);
  state.log = state.log.slice(0, 80);
}

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  toastRoot.appendChild(el);

  setTimeout(() => {
    el.remove();
  }, 2400);
}

function scrollTopSoon() {
  requestAnimationFrame(() => {
    window.scrollTo(0, 0);

    if (document.scrollingElement) {
      document.scrollingElement.scrollTop = 0;
    }

    if (appShell) {
      appShell.scrollTop = 0;
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadVoices() {
  if (!window.speechSynthesis) {
    state.ui.voices = [];
    return;
  }

  state.ui.voices = window.speechSynthesis
    .getVoices()
    .filter((voice) => voice.lang.toLowerCase().startsWith("ja") || voice.lang.toLowerCase().includes("jp"));
}

async function unlockAudio() {
  if (state.audio.unlocked) {
    return;
  }

  try {
    const ctx = getAudioContext();

    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    state.audio.unlocked = true;
  } catch {}
}

function getAudioContext() {
  if (!state.audio.ctx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audio.ctx = new AudioContextClass();
    state.audio.master = state.audio.ctx.createGain();
    state.audio.master.gain.value = state.settings.audio.soundVolume;
    state.audio.master.connect(state.audio.ctx.destination);
  }

  state.audio.master.gain.value = clamp(state.settings.audio.soundVolume, 0, 1);
  return state.audio.ctx;
}

function playSound(type) {
  if (!state.settings.audio.soundEnabled) {
    return;
  }

  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const freq = { roll: 180, decide: 520, settlement: 90, warning: 70, victory: 660 }[type] || 300;

    osc.type = type === "warning" ? "square" : "sawtooth";
    osc.frequency.value = freq;

    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);

    osc.connect(gain);
    gain.connect(state.audio.master);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch {}
}

function speak(text) {
  if (!state.settings.audio.speechEnabled || !window.speechSynthesis) {
    return;
  }

  const normalized = String(text || "").replace(/\n/g, "。");

  if (!normalized || normalized === state.audio.lastSpeech) {
    return;
  }

  state.audio.lastSpeech = normalized;

  try {
    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(normalized);
    utter.lang = "ja-JP";
    utter.rate = clamp(state.settings.audio.speechRate, 0.5, 1.8);
    utter.pitch = clamp(state.settings.audio.speechPitch, 0.5, 1.8);
    utter.volume = clamp(state.settings.audio.speechVolume, 0, 1);

    const voiceName = state.settings.audio.voiceName;
    const voice = state.ui.voices.find((candidate) => candidate.name === voiceName);

    if (voice) {
      utter.voice = voice;
    }

    window.speechSynthesis.speak(utter);
  } catch {}
}

function testSpeech() {
  speak("DICE CHARGE BATTLE 音声テストです。");
}

function bytesToHex(bytes) {
  return bytes
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}
