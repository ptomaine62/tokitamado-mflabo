"use strict";

const PRODUCT_MODE = "full";
const PRODUCT_NAME = "DICE CHARGE BATTLE";
const SERIES_NAME = "SHOCKiG REARENA POCKET";
const ACCESS_CODE = "DCB-MFLABO-202606";

const DEVICE_NAME_PREFIX = "ID:47L";
const DEVICE_SERVICE_UUID = "0000180c-0000-1000-8000-00805f9b34fb";
const DEVICE_CHAR_UUID = "0000150a-0000-1000-8000-00805f9b34fb";

const STORAGE_KEYS = {
  access: "dcb_full_access_v1",
  settings: "dcb_full_settings_v1",
  disclaimerSession: "dcb_disclaimer_session_v1",
};

const DICE_UNICODE = {
  1: "⚀",
  2: "⚁",
  3: "⚂",
  4: "⚃",
  5: "⚄",
  6: "⚅",
};

const PHASE = {
  ACCESS: "ACCESS",
  DISCLAIMER: "DISCLAIMER",
  CONNECT: "CONNECT",
  CHANNEL_TEST: "CHANNEL_TEST",
  RULE_SETUP: "RULE_SETUP",
  PLAYING: "PLAYING",
  RESULT: "RESULT",
  SAFE_LOCKED: "SAFE_LOCKED",
};

const GAME_STATUS = {
  READY: "READY",
  WAIT_P1: "WAIT_P1",
  ROLLING_P1: "ROLLING_P1",
  WAIT_P2: "WAIT_P2",
  ROLLING_P2: "ROLLING_P2",
  ROUND_REVEAL: "ROUND_REVEAL",
  SETTLEMENT_COUNTDOWN: "SETTLEMENT_COUNTDOWN",
  SETTLEMENT_PULSE: "SETTLEMENT_PULSE",
  ROUND_END: "ROUND_END",
  FINAL_COUNTDOWN: "FINAL_COUNTDOWN",
  FINAL_PULSE: "FINAL_PULSE",
  FINISHED: "FINISHED",
};

const DEFAULT_SETTINGS = {
  players: {
    p1: {
      id: "p1",
      name: "P1",
      channel: "A",
      charge: 0,
      output: 0,
      gaveUp: false,
    },
    p2: {
      id: "p2",
      name: "P2",
      channel: "B",
      charge: 0,
      output: 0,
      gaveUp: false,
    },
  },
  channels: {
    A: {
      label: "チャンネルA",
      limit: 10,
      testPercent: 3,
      pulseWidth: 10,
      frequency: 100,
      tested: false,
    },
    B: {
      label: "チャンネルB",
      limit: 10,
      testPercent: 3,
      pulseWidth: 10,
      frequency: 100,
      tested: false,
    },
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
    finalSettlementDurationMs: 2000,
  },
  audio: {
    soundEnabled: true,
    speechEnabled: true,
    masterVolume: 0.8,
    speechRate: 1.0,
    speechPitch: 1.0,
  },
  ui: {
    diceAnimationMs: 720,
    diceAnimationIntervalMs: 55,
    gaugeAnimationMs: 520,
  },
  safety: {
    outputClampHz: 20,
    visibilityStop: true,
    zeroSendRepeat: 4,
  },
};

const appShell = document.getElementById("app");
const view = document.getElementById("view");
const modalRoot = document.getElementById("modal-root");

let state = null;
let deviceClient = null;
let audioManager = null;
let outputTimer = null;
let diceAnimationTimer = null;
let renderTimer = null;
let localLog = [];
let activeTestChannel = null;
let safeLockReason = "";

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return min;
  }
  return Math.max(min, Math.min(max, n));
}

function clampInt(value, min, max) {
  return Math.round(clamp(value, min, max));
}

function nowMs() {
  return Date.now();
}

function nowText() {
  return new Date().toLocaleTimeString("ja-JP", { hour12: false });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatPercent(value) {
  const n = Number(value || 0);
  if (Math.abs(n - Math.round(n)) < 0.05) {
    return `${Math.round(n)}%`;
  }
  return `${n.toFixed(1)}%`;
}

function formatMs(value) {
  return `${Math.round(Number(value || 0))}ms`;
}

function logLocal(message) {
  if (!message) {
    return;
  }
  localLog.push(`${nowText()} ${message}`);
  localLog = localLog.slice(-120);
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    if (!raw) {
      return deepClone(DEFAULT_SETTINGS);
    }

    const loaded = JSON.parse(raw);
    return mergeSettings(deepClone(DEFAULT_SETTINGS), loaded);
  } catch (error) {
    return deepClone(DEFAULT_SETTINGS);
  }
}

function mergeSettings(base, loaded) {
  for (const [key, value] of Object.entries(loaded || {})) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      base[key] = mergeSettings(base[key], value);
    } else {
      base[key] = value;
    }
  }
  return base;
}

function saveSettings() {
  if (!state) {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
  } catch (error) {
    console.warn(error);
  }
}

function hasAccess() {
  return localStorage.getItem(STORAGE_KEYS.access) === ACCESS_CODE;
}

function setAccessGranted() {
  localStorage.setItem(STORAGE_KEYS.access, ACCESS_CODE);
}

function clearAccessGranted() {
  localStorage.removeItem(STORAGE_KEYS.access);
}

function makeInitialState() {
  const settings = loadSettings();

  return {
    phase: hasAccess() ? PHASE.DISCLAIMER : PHASE.ACCESS,
    settings,
    device: {
      status: "disconnected",
      label: "未接続",
      safeState: "DISCONNECTED",
      lastError: "",
    },
    game: makeFreshGame(settings),
    outputs: {
      A: 0,
      B: 0,
      lastSentA: 0,
      lastSentB: 0,
    },
  };
}

function makeFreshGame(settings) {
  return {
    status: GAME_STATUS.READY,
    round: 1,
    maxRounds: clampInt(settings.rules.rounds, 3, 30),
    suddenDeath: false,
    message: "ゲーム設定を確認してください",
    speechText: "",
    messageTone: "normal",
    dice: {
      p1: null,
      p2: null,
    },
    diceFaces: {
      p1: [],
      p2: [],
    },
    lastDiceOwnerId: null,
    lastLoserId: null,
    lastWinnerId: null,
    lastChargeDelta: 0,
    lastDiff: 0,
    pendingResult: null,
    countdownUntilMs: null,
    settlementUntilMs: null,
    eventPulse: null,
    winnerId: null,
    reason: "",
    startedAtMs: null,
    finishedAtMs: null,
  };
}

function resetPlayersForGame() {
  for (const player of Object.values(state.settings.players)) {
    player.charge = 0;
    player.output = 0;
    player.gaveUp = false;
  }

  state.outputs.A = 0;
  state.outputs.B = 0;
}

function getPlayer(playerId) {
  return state.settings.players[playerId] || null;
}

function getOtherPlayer(playerId) {
  return playerId === "p1" ? getPlayer("p2") : getPlayer("p1");
}

function getPlayerByChannel(channel) {
  return Object.values(state.settings.players).find((player) => player.channel === channel) || null;
}

function getChannelForPlayer(playerId) {
  const player = getPlayer(playerId);
  if (!player) {
    return "A";
  }
  return player.channel === "B" ? "B" : "A";
}

function getChannelSettings(channel) {
  return state.settings.channels[channel === "B" ? "B" : "A"];
}

function getPlayerLimit(playerId) {
  const channel = getChannelForPlayer(playerId);
  return clamp(getChannelSettings(channel).limit, 0, 100);
}

function calculateOutputFromCharge(playerId) {
  const player = getPlayer(playerId);
  if (!player) {
    return 0;
  }

  const charge = clamp(player.charge, 0, 100);
  const limit = getPlayerLimit(playerId);
  return clamp(charge * limit / 100, 0, limit);
}

function calculateEventOutput(playerId, bonusPercent, minimumPercent) {
  const base = calculateOutputFromCharge(playerId);
  const limit = getPlayerLimit(playerId);
  const value = Math.max(base + Number(bonusPercent || 0), Number(minimumPercent || 0));
  return clamp(value, 0, limit);
}

class CompatibleDeviceClient {
  constructor() {
    this.device = null;
    this.server = null;
    this.service = null;
    this.characteristic = null;
    this.connected = false;
    this.lastWriteMs = 0;
    this.lastPayload = "";
  }

  isSupported() {
    return Boolean(navigator.bluetooth);
  }

  async connectKnown() {
    if (!this.isSupported()) {
      throw new Error("このブラウザはWeb Bluetoothに対応していません");
    }

    if (typeof navigator.bluetooth.getDevices !== "function") {
      throw new Error("このブラウザでは許可済みデバイスの取得に対応していません");
    }

    const devices = await navigator.bluetooth.getDevices();
    const named = devices.filter((device) => String(device.name || "").startsWith(DEVICE_NAME_PREFIX));

    if (named.length === 0) {
      throw new Error("許可済みの対応デバイスが見つかりません。手動で探してください。");
    }

    await this.connectToDevice(named[0]);
  }

  async requestPreferred() {
    if (!this.isSupported()) {
      throw new Error("このブラウザはWeb Bluetoothに対応していません");
    }

    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: DEVICE_NAME_PREFIX }],
      optionalServices: [DEVICE_SERVICE_UUID],
    });

    await this.connectToDevice(device);
  }

  async requestManual() {
    if (!this.isSupported()) {
      throw new Error("このブラウザはWeb Bluetoothに対応していません");
    }

    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [DEVICE_SERVICE_UUID],
    });

    await this.connectToDevice(device);
  }

  async connectToDevice(device) {
    this.device = device;
    this.device.addEventListener("gattserverdisconnected", () => {
      this.connected = false;
      updateDeviceStatus("disconnected", "切断", "DISCONNECTED");
      safeStop("刺激デバイスが切断されました");
    });

    updateDeviceStatus("reconnecting", "接続中", "RECONNECTING");
    this.server = await this.device.gatt.connect();
    this.service = await this.server.getPrimaryService(DEVICE_SERVICE_UUID);
    this.characteristic = await this.service.getCharacteristic(DEVICE_CHAR_UUID);
    this.connected = true;
    this.lastPayload = "";

    updateDeviceStatus("connected", this.device.name || "接続済み", "CONNECTED");

    await this.sendInit();
    await this.sendZeroRepeated();

    logLocal("刺激デバイスに接続しました");
  }

  async disconnect() {
    await this.sendZeroRepeated();

    try {
      if (this.device && this.device.gatt && this.device.gatt.connected) {
        this.device.gatt.disconnect();
      }
    } catch (error) {
      console.warn(error);
    }

    this.connected = false;
    updateDeviceStatus("disconnected", "未接続", "DISCONNECTED");
  }

  async sendInit() {
    if (!this.connected || !this.characteristic) {
      return;
    }

    const payload = new Uint8Array([0xbf, 200, 200, 128, 128, 128, 128]);
    await this.writePayload(payload, true);
  }

  makePayload(outputA, outputB) {
    const channelA = getChannelSettings("A");
    const channelB = getChannelSettings("B");

    const aByte = clampInt((clamp(outputA, 0, 100) / 100) * 255, 0, 255);
    const bByte = clampInt((clamp(outputB, 0, 100) / 100) * 255, 0, 255);

    const widthA = clampInt(channelA.pulseWidth, 1, 255);
    const freqA = clampInt(channelA.frequency, 1, 255);
    const widthB = clampInt(channelB.pulseWidth, 1, 255);
    const freqB = clampInt(channelB.frequency, 1, 255);

    return new Uint8Array([
      0xb0,
      0x0f,
      aByte,
      bByte,
      widthA,
      widthA,
      widthA,
      widthA,
      freqA,
      freqA,
      freqA,
      freqA,
      widthB,
      widthB,
      widthB,
      widthB,
      freqB,
      freqB,
      freqB,
      freqB,
    ]);
  }

  async sendOutputs(outputA, outputB, force = false) {
    if (!this.connected || !this.characteristic) {
      return;
    }

    const hz = clamp(state.settings.safety.outputClampHz, 1, 60);
    const minInterval = Math.round(1000 / hz);
    const current = nowMs();

    if (!force && current - this.lastWriteMs < minInterval) {
      return;
    }

    const payload = this.makePayload(outputA, outputB);
    await this.writePayload(payload, force);
    this.lastWriteMs = current;
  }

  async writePayload(payload, force = false) {
    if (!this.characteristic) {
      return;
    }

    const payloadKey = Array.from(payload).join(",");

    if (!force && payloadKey === this.lastPayload) {
      return;
    }

    this.lastPayload = payloadKey;

    if (typeof this.characteristic.writeValueWithoutResponse === "function") {
      await this.characteristic.writeValueWithoutResponse(payload);
      return;
    }

    await this.characteristic.writeValue(payload);
  }

  async sendZeroRepeated() {
    const repeat = clampInt(state?.settings?.safety?.zeroSendRepeat || 4, 1, 10);

    for (let i = 0; i < repeat; i += 1) {
      try {
        await this.sendOutputs(0, 0, true);
      } catch (error) {
        console.warn(error);
      }
      await sleep(35);
    }
  }
}

class AudioManager {
  constructor() {
    this.context = null;
    this.unlocked = false;
    this.lastSpeechText = "";
  }

  async unlock() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      return;
    }

    if (!this.context) {
      this.context = new AudioContextClass();
    }

    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    this.unlocked = true;
  }

  playTone(tone = "normal", force = false) {
    const audio = state.settings.audio;

    if (!force && !audio.soundEnabled) {
      return;
    }

    if (!this.context || !this.unlocked) {
      return;
    }

    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();

    let frequency = 440;
    let duration = 0.09;
    let type = "sine";

    if (tone === "stim") {
      frequency = 660;
      duration = 0.13;
      type = "triangle";
    } else if (tone === "critical") {
      frequency = 220;
      duration = 0.2;
      type = "sawtooth";
    } else if (tone === "win") {
      frequency = 880;
      duration = 0.16;
      type = "sine";
    } else if (tone === "notice") {
      frequency = 520;
      duration = 0.1;
      type = "square";
    } else if (tone === "roll") {
      frequency = 720;
      duration = 0.055;
      type = "square";
    }

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(80, frequency * 0.7), now + duration);

    const volume = clamp(audio.masterVolume, 0, 1);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.08 * volume), now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(this.context.destination);

    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  speak(text, force = false) {
    const audio = state.settings.audio;

    if (!force && !audio.speechEnabled) {
      return;
    }

    if (!("speechSynthesis" in window)) {
      return;
    }

    const clean = String(text || "").replace(/\s+/g, " ").trim();

    if (!clean) {
      return;
    }

    if (!force && clean === this.lastSpeechText) {
      return;
    }

    this.lastSpeechText = clean;

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = "ja-JP";
      utterance.rate = clamp(audio.speechRate, 0.6, 1.6);
      utterance.pitch = clamp(audio.speechPitch, 0.5, 1.8);
      utterance.volume = clamp(audio.masterVolume, 0, 1);
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.warn(error);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function updateDeviceStatus(status, label, safeState) {
  state.device.status = status;
  state.device.label = label;
  state.device.safeState = safeState;
  forceRenderSoon();
}

function statusDot(status, safeState) {
  if (safeState === "SAFE_STOP") {
    return `<span class="dot safe">●</span>安全停止`;
  }

  if (status === "connected") {
    return `<span class="dot connected">●</span>接続中`;
  }

  if (status === "reconnecting") {
    return `<span class="dot reconnecting">●</span>接続中`;
  }

  return `<span class="dot disconnected">●</span>未接続`;
}

function header(title, subtitle = "") {
  return `
    <header class="header">
      <div class="header-main">
        <h1 class="header-title">${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="header-sub">${escapeHtml(subtitle)}</p>` : ""}
      </div>

      <div class="header-actions">
        <div class="status-strip">
          <div class="pill">
            刺激デバイス
            ${statusDot(state.device.status, state.device.safeState)}
          </div>
          <div class="pill">
            A ${formatPercent(state.outputs.A)} / B ${formatPercent(state.outputs.B)}
          </div>
        </div>
      </div>
    </header>
  `;
}

function renderMessageBox(message, tone = "normal") {
  const lines = String(message || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);

  while (lines.length < 1) {
    lines.push("");
  }

  return `
    <div class="game-message-box tone-${escapeHtml(tone)}">
      ${lines.map((line, index) => {
        const cls = index === 0 ? "" : index === 1 ? "sub" : "detail";
        return `<div class="game-message-line ${cls}">${renderRichLine(line)}</div>`;
      }).join("")}
    </div>
  `;
}

function renderRichLine(line) {
  let html = escapeHtml(line);
  const p1 = state.settings.players.p1.name || "P1";
  const p2 = state.settings.players.p2.name || "P2";

  for (const token of [
    { text: p1, cls: "p1" },
    { text: p2, cls: "p2" },
    { text: "P1", cls: "p1" },
    { text: "P2", cls: "p2" },
  ]) {
    const escaped = escapeHtml(token.text);
    html = html.split(escaped).join(`<span class="player-name-inline ${token.cls}">${escaped}</span>`);
  }

  return html;
}

function render() {
  if (!state) {
    return;
  }

  document.documentElement.style.setProperty(
    "--gauge-ms",
    `${clampInt(state.settings.ui.gaugeAnimationMs, 0, 2000)}ms`
  );

  if (state.phase === PHASE.ACCESS) {
    renderAccess();
  } else if (state.phase === PHASE.DISCLAIMER) {
    renderDisclaimer();
  } else if (state.phase === PHASE.CONNECT) {
    renderConnect();
  } else if (state.phase === PHASE.CHANNEL_TEST) {
    renderChannelTest();
  } else if (state.phase === PHASE.RULE_SETUP) {
    renderRuleSetup();
  } else if (state.phase === PHASE.PLAYING) {
    renderPlaying();
  } else if (state.phase === PHASE.RESULT) {
    renderResult();
  } else if (state.phase === PHASE.SAFE_LOCKED) {
    renderSafeLocked();
  } else {
    renderAccess();
  }

  updateDynamicLabels();
}

function forceRenderSoon() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    renderTimer = null;
    render();
  }, 0);
}

function renderAccess() {
  view.innerHTML = `
    <section class="hero">
      <div class="hero-card">
        <div class="brand-kicker">${escapeHtml(SERIES_NAME)}</div>
        <div class="logo-wrap">
          <img class="logo-img" src="./assets/logo.svg" alt="DICE CHARGE BATTLE">
        </div>
        <div class="brand-ja">製品版アクセス</div>

        <div class="notice">
          製品版のAccess Codeを入力してください。<br>
          Access CodeはBOOTH同梱のREADMEに記載されています。
        </div>

        <label class="label" for="access-code">Access Code</label>
        <input id="access-code" class="input" type="password" autocomplete="off" placeholder="Access Code">

        <div class="btn-row" style="margin-top: 18px;">
          <button class="btn primary wide" data-action="submit-access">起動する</button>
        </div>

        <p class="help">
          対応ブラウザはAndroid Chromeを推奨します。iPhoneではWeb BLE対応ブラウザでの実験対応になります。
        </p>
      </div>
    </section>
  `;
}

function renderDisclaimer() {
  view.innerHTML = `
    <section class="hero">
      <div class="hero-card">
        <div class="brand-kicker">${escapeHtml(SERIES_NAME)}</div>
        <h1 class="brand-title">WARNING</h1>
        <div class="brand-ja">安全確認と同意</div>

        <div class="notice danger">
          本アプリは対応BLEデバイスのA/Bチャンネル出力を制御します。<br>
          必ず低い出力から確認し、体調不良・痛み・違和感・通信不安定がある場合は直ちに使用を中止してください。<br>
          画面が非表示になった場合、通信が切断された場合、または緊急停止が押された場合は出力を0%にします。
        </div>

        <div class="card soft">
          <label class="switch-row">
            <span>
              <strong>上記の注意事項を理解しました</strong><br>
              <span class="small">A/Bチャンネルのテストとリミッター設定が終わるまでゲームは開始できません。</span>
            </span>
            <span class="switch" data-toggle="sessionDisclaimer"></span>
          </label>
        </div>

        <div class="btn-row" style="margin-top: 18px;">
          <button class="btn primary wide" data-action="accept-disclaimer">同意して接続へ進む</button>
        </div>
      </div>
    </section>
  `;
}

function renderConnect() {
  const supported = navigator.bluetooth ? "対応" : "非対応";
  const connected = deviceClient && deviceClient.connected;

  view.innerHTML = `
    <section class="screen">
      ${header(PRODUCT_NAME, "刺激デバイス接続")}

      <section class="card">
        <h2 class="section-title">接続状態 <small>Web Bluetooth</small></h2>
        ${renderMessageBox(
          connected
            ? `刺激デバイスに接続しています\n${state.device.label}`
            : `刺激デバイスを接続してください\n対応状況：${supported}`,
          connected ? "win" : "normal"
        )}

        <div class="grid two" style="margin-top: 16px;">
          <button class="btn primary big" data-action="connect-known">かんたん接続</button>
          <button class="btn ghost big" data-action="connect-preferred">ID:47Lから探す</button>
          <button class="btn ghost big" data-action="connect-manual">手動で探す</button>
          <button class="btn danger big" data-action="disconnect-device">切断</button>
        </div>

        <p class="help">
          かんたん接続は、過去にこのサイトへ許可した対応デバイスへ再接続します。<br>
          初回または見つからない場合は「ID:47Lから探す」または「手動で探す」を使用してください。
        </p>
      </section>

      <section class="card">
        <h2 class="section-title">次の手順</h2>
        <p class="help">
          接続後、チャンネルA/Bの個別テストを行います。テストが終わるまでゲーム開始はロックされます。
        </p>
        <button class="btn primary wide" data-action="go-channel-test" ${connected ? "" : "disabled"}>A/Bチャンネル設定へ</button>
      </section>

      ${renderFooterSafe()}
    </section>
  `;
}

function renderChannelTest() {
  view.innerHTML = `
    <section class="screen">
      ${header(PRODUCT_NAME, "A/Bチャンネル設定と安全テスト")}

      <section class="grid two">
        ${renderChannelCard("A")}
        ${renderChannelCard("B")}
      </section>

      <section class="card">
        <h2 class="section-title">音声と効果音</h2>
        ${renderSwitchRow("効果音", "soundEnabled", state.settings.audio.soundEnabled, "sound")}
        ${renderSwitchRow("音声読み上げ", "speechEnabled", state.settings.audio.speechEnabled, "speech")}
        ${renderRangeRow("音量", "audio.masterVolume", state.settings.audio.masterVolume, 0, 1, 0.01, `${Math.round(state.settings.audio.masterVolume * 100)}%`)}
        <div class="btn-row">
          <button class="btn ghost" data-action="test-sound">効果音テスト</button>
          <button class="btn ghost" data-action="test-speech">音声テスト</button>
        </div>
      </section>

      <section class="card">
        <h2 class="section-title">ゲーム開始前チェック</h2>
        <p class="help">
          チャンネルA/Bそれぞれのテストを完了してください。<br>
          強さ、パルス幅、周波数はこの画面で調整できます。強さは必ず低い値から確認してください。
        </p>
        <button class="btn primary wide" data-action="go-rule-setup" ${areChannelsTested() ? "" : "disabled"}>ゲーム設定へ進む</button>
      </section>

      ${renderFooterSafe()}
    </section>
  `;
}

function renderChannelCard(channel) {
  const cfg = getChannelSettings(channel);
  const player = getPlayerByChannel(channel);
  const playerClass = player && player.id === "p2" ? "p2" : "p1";

  return `
    <section class="card player-card ${playerClass}">
      <h2 class="section-title">${escapeHtml(cfg.label)} <small>${escapeHtml(player ? player.name : "")}</small></h2>

      ${renderRangeRow("出力リミット", `channels.${channel}.limit`, cfg.limit, 0, 100, 1, `${Math.round(cfg.limit)}%`)}
      ${renderRangeRow("テストの強さ", `channels.${channel}.testPercent`, cfg.testPercent, 0, 100, 1, `${Math.round(cfg.testPercent)}%`)}
      ${renderRangeRow("パルス幅", `channels.${channel}.pulseWidth`, cfg.pulseWidth, 1, 100, 1, `${Math.round(cfg.pulseWidth)}`)}
      ${renderRangeRow("周波数", `channels.${channel}.frequency`, cfg.frequency, 10, 250, 1, `${Math.round(cfg.frequency)}Hz`)}

      <div class="btn-row" style="margin-top: 14px;">
        <button class="btn primary test-hold" data-test-channel="${channel}" data-action="test-channel-start">
          押してテスト
        </button>
        <button class="btn ghost" data-action="mark-channel-tested" data-channel="${channel}">
          テスト完了
        </button>
      </div>

      <p class="help">
        現在の設定：強さ ${Math.round(cfg.testPercent)}% / パルス幅 ${Math.round(cfg.pulseWidth)} / 周波数 ${Math.round(cfg.frequency)}Hz<br>
        テスト完了：${cfg.tested ? "済" : "未"}
      </p>
    </section>
  `;
}

function renderRuleSetup() {
  const rules = state.settings.rules;
  const p1 = state.settings.players.p1;
  const p2 = state.settings.players.p2;

  view.innerHTML = `
    <section class="screen">
      ${header(PRODUCT_NAME, "ゲーム設定")}

      <section class="grid two">
        <section class="card player-card p1">
          <h2 class="section-title">P1</h2>
          <label class="label" for="p1-name">名前</label>
          <input id="p1-name" class="input" data-player-name="p1" value="${escapeHtml(p1.name)}">
          <p class="help">P1はチャンネルAに割り当てられます。</p>
        </section>

        <section class="card player-card p2">
          <h2 class="section-title">P2</h2>
          <label class="label" for="p2-name">名前</label>
          <input id="p2-name" class="input" data-player-name="p2" value="${escapeHtml(p2.name)}">
          <p class="help">P2はチャンネルBに割り当てられます。</p>
        </section>
      </section>

      <section class="card">
        <h2 class="section-title">ルール設定 <small>製品版</small></h2>

        ${renderRangeRow("ラウンド数", "rules.rounds", rules.rounds, 3, 30, 1, `${Math.round(rules.rounds)}R`)}
        ${renderRangeRow("出目差チャージ", "rules.chargeMultiplier", rules.chargeMultiplier, 1, 20, 1, `差分×${Math.round(rules.chargeMultiplier)}`)}
        ${renderRangeRow("あいこチャージ", "rules.drawCharge", rules.drawCharge, 0, 20, 1, `+${Math.round(rules.drawCharge)}`)}

        ${renderSwitchRow("継続出力", "continuousStim", rules.continuousStim, "rules")}
        ${renderRangeRow("継続ON時間", "rules.continuousOnMs", rules.continuousOnMs, 100, 3000, 100, formatMs(rules.continuousOnMs))}
        ${renderRangeRow("継続OFF時間", "rules.continuousOffMs", rules.continuousOffMs, 100, 5000, 100, formatMs(rules.continuousOffMs))}

        ${renderSwitchRow("精算イベント", "settlementStim", rules.settlementStim, "rules")}
        ${renderRangeRow("精算カウント", "rules.settlementCountdownMs", rules.settlementCountdownMs, 1000, 10000, 500, formatMs(rules.settlementCountdownMs))}
        ${renderRangeRow("精算ボーナス", "rules.settlementBonusPercent", rules.settlementBonusPercent, 0, 50, 1, `+${Math.round(rules.settlementBonusPercent)}%`)}
        ${renderRangeRow("精算時間", "rules.settlementDurationMs", rules.settlementDurationMs, 100, 5000, 100, formatMs(rules.settlementDurationMs))}
      </section>

      <section class="card">
        <h2 class="section-title">開始</h2>
        <p class="help">
          ゲーム中も緊急停止は常に使用できます。画面を閉じる、非表示にする、通信が切断される、いずれの場合も出力を0%にします。
        </p>
        <div class="btn-row">
          <button class="btn ghost" data-action="back-channel-test">A/B設定へ戻る</button>
          <button class="btn primary wide" data-action="start-game">ゲーム開始</button>
        </div>
      </section>

      ${renderFooterSafe()}
    </section>
  `;
}

function renderPlaying() {
  const game = state.game;

  view.innerHTML = `
    <section class="screen">
      ${header(PRODUCT_NAME, `ROUND ${game.round}${game.suddenDeath ? " / SUDDEN DEATH" : ` / ${game.maxRounds}`}`)}

      <section class="grid two">
        ${renderPlayerPanel("p1")}
        ${renderPlayerPanel("p2")}
      </section>

      <section class="dice-stage">
        ${renderMessageBox(game.message, game.messageTone)}

        <div class="dice-row">
          ${renderDiceBox("p1")}
          <div class="vs">VS</div>
          ${renderDiceBox("p2")}
        </div>

        <div class="btn-row">
          ${renderActionButton()}
          <button class="btn ghost" data-action="give-up-p1">P1 ギブアップ</button>
          <button class="btn ghost" data-action="give-up-p2">P2 ギブアップ</button>
        </div>
      </section>

      <section class="card soft">
        <h2 class="section-title">ログ</h2>
        <div class="log-box">${localLog.slice(-16).map(escapeHtml).join("<br>")}</div>
      </section>

      ${renderFooterSafe()}
    </section>
  `;
}

function renderPlayerPanel(playerId) {
  const player = getPlayer(playerId);
  const channel = getChannelForPlayer(playerId);
  const cfg = getChannelSettings(channel);
  const cls = playerId === "p2" ? "p2" : "p1";
  const output = channel === "A" ? state.outputs.A : state.outputs.B;

  return `
    <section class="card player-card ${cls}">
      <div class="player-head">
        <div>
          <h2 class="player-name ${cls}">${escapeHtml(player.name)}</h2>
          <div class="player-meta">${escapeHtml(cfg.label)} / リミット ${formatPercent(cfg.limit)}</div>
        </div>
        <div class="pill">Charge ${Math.round(player.charge)}</div>
      </div>

      <div class="label">Charge</div>
      <div class="gauge">
        <div class="gauge-fill ${cls}" style="width:${clamp(player.charge, 0, 100)}%"></div>
      </div>

      <div class="label">出力</div>
      <div class="gauge">
        <div class="gauge-fill output" style="width:${clamp(output, 0, 100)}%"></div>
      </div>

      <div class="stat-grid">
        <div class="stat">
          <span class="stat-label">現在出力</span>
          <span class="stat-value">${formatPercent(output)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">ダイス</span>
          <span class="stat-value">${playerId === "p1" ? state.game.dice.p1 ?? "-" : state.game.dice.p2 ?? "-"}</span>
        </div>
      </div>
    </section>
  `;
}

function renderDiceBox(playerId) {
  const game = state.game;
  const player = getPlayer(playerId);
  const value = playerId === "p1" ? game.dice.p1 : game.dice.p2;
  const active =
    (playerId === "p1" && (game.status === GAME_STATUS.WAIT_P1 || game.status === GAME_STATUS.ROLLING_P1)) ||
    (playerId === "p2" && (game.status === GAME_STATUS.WAIT_P2 || game.status === GAME_STATUS.ROLLING_P2));

  const rolling =
    (playerId === "p1" && game.status === GAME_STATUS.ROLLING_P1) ||
    (playerId === "p2" && game.status === GAME_STATUS.ROLLING_P2);

  const face = rolling ? DICE_UNICODE[randomDiceValue()] : value ? DICE_UNICODE[value] : "―";

  return `
    <div class="dice-box ${active ? "active" : ""} ${rolling ? "rolling" : ""}">
      <div class="dice-label">${escapeHtml(player.name)}</div>
      <div class="dice-value">${face}</div>
    </div>
  `;
}

function renderActionButton() {
  const game = state.game;

  if (game.status === GAME_STATUS.WAIT_P1) {
    return `<button class="btn primary big wide" data-action="roll-p1">${escapeHtml(getPlayer("p1").name)} ダイスを振る</button>`;
  }

  if (game.status === GAME_STATUS.WAIT_P2) {
    return `<button class="btn primary big wide" data-action="roll-p2">${escapeHtml(getPlayer("p2").name)} ダイスを振る</button>`;
  }

  return `<button class="btn ghost big wide" disabled>進行中</button>`;
}

function renderResult() {
  const game = state.game;
  const p1 = getPlayer("p1");
  const p2 = getPlayer("p2");

  view.innerHTML = `
    <section class="hero">
      <div class="result-card card">
        <div class="brand-kicker">${escapeHtml(SERIES_NAME)}</div>
        <h1 class="result-title">RESULT</h1>
        <p class="result-reason">${escapeHtml(game.reason || "勝敗が決定しました")}</p>

        <div class="grid two">
          ${renderResultPlayer("p1")}
          ${renderResultPlayer("p2")}
        </div>

        <div class="btn-row" style="margin-top: 24px;">
          <button class="btn primary wide" data-action="restart-game">もう一度遊ぶ</button>
          <button class="btn ghost wide" data-action="back-rule-setup">設定へ戻る</button>
        </div>

        <p class="help">
          ${escapeHtml(p1.name)} Charge ${Math.round(p1.charge)} / ${escapeHtml(p2.name)} Charge ${Math.round(p2.charge)}
        </p>
      </div>
    </section>
  `;
}

function renderResultPlayer(playerId) {
  const player = getPlayer(playerId);
  const cls = playerId === "p2" ? "p2" : "p1";
  return `
    <section class="card player-card ${cls}">
      <h2 class="player-name ${cls}">${escapeHtml(player.name)}</h2>
      <div class="stat-grid">
        <div class="stat">
          <span class="stat-label">Charge</span>
          <span class="stat-value">${Math.round(player.charge)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">状態</span>
          <span class="stat-value">${player.gaveUp ? "GIVE UP" : "OK"}</span>
        </div>
      </div>
    </section>
  `;
}

function renderSafeLocked() {
  view.innerHTML = `
    <section class="safe-screen">
      <div class="safe-card card">
        <h1 class="safe-title">SAFE STOP</h1>
        <p class="safe-reason">${escapeHtml(safeLockReason || "安全停止しました")}</p>
        <div class="btn-row">
          <button class="btn primary wide" data-action="clear-safe">安全停止を解除</button>
          <button class="btn ghost wide" data-action="go-connect">接続画面へ</button>
        </div>
      </div>
    </section>
  `;
}

function renderFooterSafe() {
  return `
    <footer class="footer-safe">
      <button class="btn danger" data-action="emergency-stop">緊急停止</button>
      <button class="btn ghost" data-action="go-connect">接続</button>
      <button class="btn ghost" data-action="go-channel-test">A/B設定</button>
    </footer>
  `;
}

function renderRangeRow(label, path, value, min, max, step, display) {
  return `
    <div class="config-row">
      <label class="label">${escapeHtml(label)}</label>
      <input class="range" type="range"
        min="${escapeHtml(min)}"
        max="${escapeHtml(max)}"
        step="${escapeHtml(step)}"
        value="${escapeHtml(value)}"
        data-setting-path="${escapeHtml(path)}">
      <span class="config-value" data-display-for="${escapeHtml(path)}">${escapeHtml(display)}</span>
    </div>
  `;
}

function renderSwitchRow(label, key, value, group) {
  return `
    <label class="switch-row">
      <span>${escapeHtml(label)}</span>
      <span class="switch ${value ? "on" : ""}" data-switch-group="${escapeHtml(group)}" data-switch-key="${escapeHtml(key)}"></span>
    </label>
  `;
}

function updateDynamicLabels() {
  document.querySelectorAll("[data-setting-path]").forEach((input) => {
    const path = input.dataset.settingPath;
    const display = document.querySelector(`[data-display-for="${CSS.escape(path)}"]`);

    if (!display) {
      return;
    }

    const value = getSettingByPath(path);

    if (path.endsWith("limit") || path.endsWith("testPercent") || path.endsWith("settlementBonusPercent")) {
      display.textContent = `${Math.round(Number(value || 0))}%`;
    } else if (path.endsWith("frequency")) {
      display.textContent = `${Math.round(Number(value || 0))}Hz`;
    } else if (path.endsWith("pulseWidth")) {
      display.textContent = `${Math.round(Number(value || 0))}`;
    } else if (path.endsWith("rounds")) {
      display.textContent = `${Math.round(Number(value || 0))}R`;
    } else if (path.endsWith("chargeMultiplier")) {
      display.textContent = `差分×${Math.round(Number(value || 0))}`;
    } else if (path.endsWith("drawCharge")) {
      display.textContent = `+${Math.round(Number(value || 0))}`;
    } else if (path.endsWith("masterVolume")) {
      display.textContent = `${Math.round(Number(value || 0) * 100)}%`;
    } else if (path.endsWith("Ms")) {
      display.textContent = formatMs(value);
    } else {
      display.textContent = String(value);
    }
  });
}

function areChannelsTested() {
  return Boolean(state.settings.channels.A.tested && state.settings.channels.B.tested);
}

function getSettingByPath(path) {
  const parts = path.split(".");
  let target = state.settings;

  for (const part of parts) {
    if (target == null) {
      return undefined;
    }
    target = target[part];
  }

  return target;
}

function setSettingByPath(path, value) {
  const parts = path.split(".");
  let target = state.settings;

  for (let i = 0; i < parts.length - 1; i += 1) {
    target = target[parts[i]];
  }

  const key = parts[parts.length - 1];
  target[key] = value;
}

function handleClick(event) {
  const actionTarget = event.target.closest("[data-action]");
  const switchTarget = event.target.closest("[data-switch-key]");
  const sessionSwitch = event.target.closest("[data-toggle='sessionDisclaimer']");

  if (sessionSwitch) {
    sessionSwitch.classList.toggle("on");
    sessionSwitch.dataset.checked = sessionSwitch.classList.contains("on") ? "1" : "0";
    return;
  }

  if (switchTarget) {
    handleSwitch(switchTarget);
    return;
  }

  if (!actionTarget) {
    return;
  }

  const action = actionTarget.dataset.action;
  runAction(action, actionTarget).catch((error) => {
    console.error(error);
    showModal("エラー", error.message || String(error));
  });
}

async function runAction(action, target) {
  await audioManager.unlock();

  if (action === "submit-access") {
    const input = document.getElementById("access-code");
    if (String(input?.value || "").trim() === ACCESS_CODE) {
      setAccessGranted();
      state.phase = PHASE.DISCLAIMER;
      logLocal("Access Code認証完了");
      audioManager.playTone("win", true);
      render();
    } else {
      audioManager.playTone("critical", true);
      showModal("Access Codeが違います", "BOOTH同梱のREADMEに記載されたAccess Codeを入力してください。");
    }
    return;
  }

  if (action === "accept-disclaimer") {
    const sw = document.querySelector("[data-toggle='sessionDisclaimer']");
    if (!sw || sw.dataset.checked !== "1") {
      showModal("確認が必要です", "注意事項を確認し、同意スイッチをONにしてください。");
      return;
    }
    state.phase = PHASE.CONNECT;
    logLocal("安全確認に同意しました");
    audioManager.speak("安全確認に同意しました。刺激デバイスを接続してください。", true);
    render();
    return;
  }

  if (action === "connect-known") {
    await connectWithMode("known");
    return;
  }

  if (action === "connect-preferred") {
    await connectWithMode("preferred");
    return;
  }

  if (action === "connect-manual") {
    await connectWithMode("manual");
    return;
  }

  if (action === "disconnect-device") {
    await safeZero();
    if (deviceClient) {
      await deviceClient.disconnect();
    }
    render();
    return;
  }

  if (action === "go-channel-test") {
    state.phase = PHASE.CHANNEL_TEST;
    render();
    return;
  }

  if (action === "go-rule-setup") {
    if (!areChannelsTested()) {
      showModal("テスト未完了", "チャンネルA/Bのテストを完了してください。");
      return;
    }
    state.phase = PHASE.RULE_SETUP;
    render();
    return;
  }

  if (action === "back-channel-test") {
    state.phase = PHASE.CHANNEL_TEST;
    render();
    return;
  }

  if (action === "mark-channel-tested") {
    const channel = target.dataset.channel;
    state.settings.channels[channel].tested = true;
    saveSettings();
    logLocal(`${state.settings.channels[channel].label} テスト完了`);
    audioManager.playTone("win");
    audioManager.speak(`${state.settings.channels[channel].label}のテストを完了しました。`);
    render();
    return;
  }

  if (action === "test-sound") {
    audioManager.playTone("notice", true);
    return;
  }

  if (action === "test-speech") {
    audioManager.speak("音声読み上げテストです。現在の状態を音声で案内します。", true);
    return;
  }

  if (action === "start-game") {
    startGame();
    return;
  }

  if (action === "roll-p1") {
    rollDiceFor("p1");
    return;
  }

  if (action === "roll-p2") {
    rollDiceFor("p2");
    return;
  }

  if (action === "give-up-p1") {
    giveUp("p1");
    return;
  }

  if (action === "give-up-p2") {
    giveUp("p2");
    return;
  }

  if (action === "restart-game") {
    startGame();
    return;
  }

  if (action === "back-rule-setup") {
    await safeZero();
    state.phase = PHASE.RULE_SETUP;
    render();
    return;
  }

  if (action === "emergency-stop") {
    safeStop("緊急停止ボタンが押されました");
    return;
  }

  if (action === "clear-safe") {
    await safeZero();
    safeLockReason = "";
    state.phase = deviceClient && deviceClient.connected ? PHASE.CHANNEL_TEST : PHASE.CONNECT;
    render();
    return;
  }

  if (action === "go-connect") {
    await safeZero();
    state.phase = PHASE.CONNECT;
    render();
    return;
  }
}

async function connectWithMode(mode) {
  if (!deviceClient) {
    deviceClient = new CompatibleDeviceClient();
  }

  try {
    if (mode === "known") {
      await deviceClient.connectKnown();
    } else if (mode === "preferred") {
      await deviceClient.requestPreferred();
    } else {
      await deviceClient.requestManual();
    }

    audioManager.playTone("win", true);
    audioManager.speak("刺激デバイスに接続しました。チャンネルテストへ進んでください。", true);
    render();
  } catch (error) {
    updateDeviceStatus("disconnected", "未接続", "DISCONNECTED");
    audioManager.playTone("critical", true);
    showModal("接続できませんでした", error.message || String(error));
    render();
  }
}

function handleSwitch(target) {
  const group = target.dataset.switchGroup;
  const key = target.dataset.switchKey;
  const next = !target.classList.contains("on");

  if (group === "audio") {
    state.settings.audio[key] = next;
  } else if (group === "sound") {
    state.settings.audio.soundEnabled = next;
  } else if (group === "speech") {
    state.settings.audio.speechEnabled = next;
  } else if (group === "rules") {
    state.settings.rules[key] = next;
  }

  saveSettings();
  render();
}

function handleInput(event) {
  const input = event.target;

  if (input.matches("[data-setting-path]")) {
    const path = input.dataset.settingPath;
    const raw = Number(input.value);
    let value = raw;

    if (path.includes("masterVolume")) {
      value = clamp(raw, 0, 1);
    } else {
      value = clamp(raw, Number(input.min || 0), Number(input.max || 100));
    }

    setSettingByPath(path, value);

    if (path === "rules.rounds") {
      state.settings.rules.rounds = clampInt(value, 3, 30);
    }

    saveSettings();
    updateDynamicLabels();
    return;
  }
}

function handleChange(event) {
  const input = event.target;

  if (input.matches("[data-player-name]")) {
    const playerId = input.dataset.playerName;
    const player = getPlayer(playerId);
    if (player) {
      player.name = String(input.value || playerId.toUpperCase()).trim().slice(0, 18) || playerId.toUpperCase();
      saveSettings();
      render();
    }
  }
}

function handlePointerDown(event) {
  const target = event.target.closest("[data-action='test-channel-start']");

  if (!target) {
    return;
  }

  event.preventDefault();
  audioManager.unlock().catch(() => {});
  const channel = target.dataset.testChannel;

  startChannelTest(channel);
  target.classList.add("active");
}

function handlePointerUp(event) {
  const target = event.target.closest("[data-action='test-channel-start']");

  if (!target) {
    if (activeTestChannel) {
      stopChannelTest();
    }
    return;
  }

  event.preventDefault();
  target.classList.remove("active");
  stopChannelTest();
}

function startChannelTest(channel) {
  activeTestChannel = channel;
  const cfg = getChannelSettings(channel);
  logLocal(`${cfg.label} テスト開始：${Math.round(cfg.testPercent)}% / 幅${Math.round(cfg.pulseWidth)} / ${Math.round(cfg.frequency)}Hz`);
  audioManager.playTone("notice");
  audioManager.speak(`${cfg.label}をテストします。`);
}

function stopChannelTest() {
  if (activeTestChannel) {
    const cfg = getChannelSettings(activeTestChannel);
    logLocal(`${cfg.label} テスト停止`);
  }

  activeTestChannel = null;
  state.outputs.A = 0;
  state.outputs.B = 0;
  safeZero().catch(() => {});
}

function startGame() {
  saveSettings();
  resetPlayersForGame();
  state.game = makeFreshGame(state.settings);
  state.game.status = GAME_STATUS.WAIT_P1;
  state.game.startedAtMs = nowMs();
  state.game.message = `ROUND 1：${state.settings.players.p1.name}がダイスを振ってください`;
  state.game.speechText = `ラウンド1。${state.settings.players.p1.name}がダイスを振ってください。`;
  state.game.messageTone = "normal";
  state.phase = PHASE.PLAYING;

  logLocal("ゲーム開始");
  audioManager.playTone("notice");
  audioManager.speak(state.game.speechText, true);
  render();
}

function randomDiceValue() {
  return Math.floor(Math.random() * 6) + 1;
}

function rollDiceFor(playerId) {
  const game = state.game;

  if (playerId === "p1" && game.status !== GAME_STATUS.WAIT_P1) {
    return;
  }

  if (playerId === "p2" && game.status !== GAME_STATUS.WAIT_P2) {
    return;
  }

  const player = getPlayer(playerId);
  const status = playerId === "p1" ? GAME_STATUS.ROLLING_P1 : GAME_STATUS.ROLLING_P2;

  game.status = status;
  game.lastDiceOwnerId = playerId;
  game.message = `${player.name} ダイスロール！`;
  game.speechText = `${player.name}、ダイスロール。`;
  game.messageTone = "normal";

  audioManager.playTone("roll");
  audioManager.speak(game.speechText);

  clearInterval(diceAnimationTimer);
  diceAnimationTimer = setInterval(() => {
    forceRenderSoon();
    audioManager.playTone("roll");
  }, clampInt(state.settings.ui.diceAnimationIntervalMs, 30, 200));

  render();

  setTimeout(() => {
    clearInterval(diceAnimationTimer);
    diceAnimationTimer = null;

    const value = randomDiceValue();

    if (playerId === "p1") {
      game.dice.p1 = value;
      game.status = GAME_STATUS.WAIT_P2;
      game.message = `${player.name} の出目は ${value}！\n${state.settings.players.p2.name}がダイスを振ってください`;
      game.speechText = `${player.name}の出目は${value}。${state.settings.players.p2.name}がダイスを振ってください。`;
      game.messageTone = "normal";
      logLocal(`${player.name} 出目 ${value}`);
      audioManager.playTone("notice");
      audioManager.speak(game.speechText);
      render();
      return;
    }

    game.dice.p2 = value;
    logLocal(`${player.name} 出目 ${value}`);
    prepareRoundResult();
  }, clampInt(state.settings.ui.diceAnimationMs, 300, 2000));
}

function prepareRoundResult() {
  const game = state.game;
  const rules = state.settings.rules;
  const p1 = getPlayer("p1");
  const p2 = getPlayer("p2");
  const p1Value = Number(game.dice.p1 || 0);
  const p2Value = Number(game.dice.p2 || 0);

  game.status = GAME_STATUS.ROUND_REVEAL;

  if (p1Value === p2Value) {
    const delta = clamp(Number(rules.drawCharge || 0), 0, 100);
    p1.charge = clamp(p1.charge + delta, 0, 100);
    p2.charge = clamp(p2.charge + delta, 0, 100);

    game.lastLoserId = null;
    game.lastWinnerId = null;
    game.lastChargeDelta = delta;
    game.lastDiff = 0;
    game.message = `${p1Value} 対 ${p2Value}\nあいこ！\n両者にCharge +${Math.round(delta)}`;
    game.speechText = `あいこ。両者にチャージ${Math.round(delta)}。`;
    game.messageTone = "stim";
    logLocal(`あいこ：両者 Charge +${Math.round(delta)}`);
    audioManager.playTone("stim");
    audioManager.speak(game.speechText);
    render();

    setTimeout(() => {
      advanceRound();
    }, 2200);

    return;
  }

  const p1Wins = p1Value > p2Value;
  const winner = p1Wins ? p1 : p2;
  const loser = p1Wins ? p2 : p1;
  const diff = Math.abs(p1Value - p2Value);
  const delta = clamp(diff * Number(rules.chargeMultiplier || 5), 0, 100);

  loser.charge = clamp(loser.charge + delta, 0, 100);

  game.lastLoserId = loser.id;
  game.lastWinnerId = winner.id;
  game.lastChargeDelta = delta;
  game.lastDiff = diff;
  game.message = `${winner.name} の勝ち！\n差分 ${diff}\n${loser.name}にCharge +${Math.round(delta)}`;
  game.speechText = `${winner.name}の勝ち。${loser.name}にチャージ${Math.round(delta)}。`;
  game.messageTone = "stim";

  logLocal(`${winner.name}勝利：${loser.name} Charge +${Math.round(delta)}`);
  audioManager.playTone("stim");
  audioManager.speak(game.speechText);
  render();

  setTimeout(() => {
    if (state.settings.rules.settlementStim) {
      startSettlementCountdown();
    } else {
      advanceRound();
    }
  }, 2200);
}

function startSettlementCountdown() {
  const game = state.game;
  const rules = state.settings.rules;
  const loser = getPlayer(game.lastLoserId);

  if (!loser) {
    advanceRound();
    return;
  }

  game.status = GAME_STATUS.SETTLEMENT_COUNTDOWN;
  game.countdownUntilMs = nowMs() + clampInt(rules.settlementCountdownMs, 1000, 10000);
  logLocal(`${loser.name} 精算カウント開始`);

  updateSettlementCountdown();
}

function updateSettlementCountdown() {
  const game = state.game;

  if (game.status !== GAME_STATUS.SETTLEMENT_COUNTDOWN) {
    return;
  }

  const loser = getPlayer(game.lastLoserId);
  const remain = Math.max(0, Number(game.countdownUntilMs || 0) - nowMs());
  const sec = Math.ceil(remain / 1000);

  if (loser) {
    game.message = `${loser.name} 精算まで ${sec}\nCharge +${Math.round(game.lastChargeDelta)}`;
    game.speechText = String(sec);
    game.messageTone = "notice";
  }

  audioManager.playTone("notice");
  audioManager.speak(game.speechText);
  render();

  if (remain <= 0) {
    startSettlementPulse();
    return;
  }

  setTimeout(updateSettlementCountdown, 250);
}

function startSettlementPulse() {
  const game = state.game;
  const rules = state.settings.rules;
  const loser = getPlayer(game.lastLoserId);

  if (!loser) {
    advanceRound();
    return;
  }

  game.status = GAME_STATUS.SETTLEMENT_PULSE;
  game.settlementUntilMs = nowMs() + clampInt(rules.settlementDurationMs, 100, 5000);
  game.eventPulse = {
    playerId: loser.id,
    untilMs: game.settlementUntilMs,
    bonusPercent: clamp(rules.settlementBonusPercent, 0, 50),
    minPercent: 0,
    reason: "精算",
  };
  game.message = `${loser.name} 精算！`;
  game.speechText = "精算";
  game.messageTone = "stim";

  logLocal(`${loser.name} 精算開始`);
  audioManager.playTone("stim");
  audioManager.speak(game.speechText);
  render();

  setTimeout(() => {
    game.eventPulse = null;
    game.status = GAME_STATUS.ROUND_END;
    game.message = "精算完了！";
    game.speechText = "精算完了";
    game.messageTone = "stim";
    audioManager.playTone("stim");
    audioManager.speak(game.speechText);
    render();

    setTimeout(() => {
      advanceRound();
    }, 1200);
  }, clampInt(rules.settlementDurationMs, 100, 5000));
}

function advanceRound() {
  const game = state.game;
  const currentRound = Number(game.round || 1);
  const maxRounds = Number(game.maxRounds || state.settings.rules.rounds || 10);

  if (currentRound >= maxRounds) {
    finishByCharge();
    return;
  }

  game.round = currentRound + 1;
  game.status = GAME_STATUS.WAIT_P1;
  game.dice.p1 = null;
  game.dice.p2 = null;
  game.lastLoserId = null;
  game.lastWinnerId = null;
  game.lastChargeDelta = 0;
  game.lastDiff = 0;
  game.countdownUntilMs = null;
  game.settlementUntilMs = null;
  game.eventPulse = null;
  game.message = `ROUND ${game.round}：${state.settings.players.p1.name}がダイスを振ってください`;
  game.speechText = `ラウンド${game.round}。${state.settings.players.p1.name}がダイスを振ってください。`;
  game.messageTone = "normal";

  audioManager.playTone("notice");
  audioManager.speak(game.speechText);
  render();
}

function finishByCharge() {
  const game = state.game;
  const p1 = getPlayer("p1");
  const p2 = getPlayer("p2");

  if (p1.charge === p2.charge) {
    game.suddenDeath = true;
    game.round += 1;
    game.status = GAME_STATUS.WAIT_P1;
    game.dice.p1 = null;
    game.dice.p2 = null;
    game.message = `同点！\nサドンデス：${p1.name}がダイスを振ってください`;
    game.speechText = `同点。サドンデス。${p1.name}がダイスを振ってください。`;
    game.messageTone = "critical";
    audioManager.playTone("critical");
    audioManager.speak(game.speechText);
    render();
    return;
  }

  const winner = p1.charge < p2.charge ? p1 : p2;
  const loser = p1.charge < p2.charge ? p2 : p1;

  startFinalSettlement(winner.id, loser.id, `規定ラウンド終了：${winner.name} の勝利`);
}

function startFinalSettlement(winnerId, loserId, reason) {
  const game = state.game;
  const loser = getPlayer(loserId);
  const rules = state.settings.rules;

  game.status = GAME_STATUS.FINAL_COUNTDOWN;
  game.pendingResult = {
    winnerId,
    loserId,
    reason,
  };
  game.countdownUntilMs = nowMs() + clampInt(rules.finalSettlementCountdownMs, 1000, 10000);
  logLocal("最終精算カウント開始");

  updateFinalCountdown();
}

function updateFinalCountdown() {
  const game = state.game;

  if (game.status !== GAME_STATUS.FINAL_COUNTDOWN) {
    return;
  }

  const loser = getPlayer(game.pendingResult.loserId);
  const remain = Math.max(0, Number(game.countdownUntilMs || 0) - nowMs());
  const sec = Math.ceil(remain / 1000);

  game.message = loser ? `${loser.name} 最終精算まで ${sec}` : `最終精算まで ${sec}`;
  game.speechText = String(sec);
  game.messageTone = "notice";

  audioManager.playTone("notice");
  audioManager.speak(game.speechText);
  render();

  if (remain <= 0) {
    startFinalPulse();
    return;
  }

  setTimeout(updateFinalCountdown, 250);
}

function startFinalPulse() {
  const game = state.game;
  const rules = state.settings.rules;
  const loser = getPlayer(game.pendingResult.loserId);

  game.status = GAME_STATUS.FINAL_PULSE;
  game.settlementUntilMs = nowMs() + clampInt(rules.finalSettlementDurationMs, 100, 6000);

  if (loser) {
    game.eventPulse = {
      playerId: loser.id,
      untilMs: game.settlementUntilMs,
      bonusPercent: clamp(rules.finalSettlementBonusPercent, 0, 60),
      minPercent: 0,
      reason: "最終精算",
    };
    game.message = `${loser.name} 最終精算！`;
  } else {
    game.message = "最終精算！";
  }

  game.speechText = "最終精算";
  game.messageTone = "critical";
  audioManager.playTone("critical");
  audioManager.speak(game.speechText);
  render();

  setTimeout(() => {
    game.eventPulse = null;
    finishGame(game.pendingResult.winnerId, game.pendingResult.reason);
  }, clampInt(rules.finalSettlementDurationMs, 100, 6000));
}

function finishGame(winnerId, reason) {
  const game = state.game;
  const winner = getPlayer(winnerId);

  game.status = GAME_STATUS.FINISHED;
  game.winnerId = winnerId;
  game.finishedAtMs = nowMs();
  game.reason = reason || (winner ? `${winner.name} の勝利` : "勝敗が決定しました");
  state.phase = PHASE.RESULT;

  safeZero().catch(() => {});
  logLocal(game.reason);
  audioManager.playTone("win", true);
  audioManager.speak(game.reason, true);
  render();
}

function giveUp(playerId) {
  const player = getPlayer(playerId);
  const opponent = getOtherPlayer(playerId);

  if (!player || !opponent) {
    return;
  }

  player.gaveUp = true;
  finishGame(opponent.id, `${player.name} がギブアップ：${opponent.name} の勝利`);
}

function computeRequestedOutputs() {
  const outputs = {
    A: 0,
    B: 0,
  };

  if (!state || state.phase === PHASE.SAFE_LOCKED) {
    return outputs;
  }

  if (activeTestChannel) {
    const cfg = getChannelSettings(activeTestChannel);
    outputs[activeTestChannel] = clamp(cfg.testPercent, 0, getChannelSettings(activeTestChannel).limit);
    return outputs;
  }

  if (state.phase !== PHASE.PLAYING) {
    return outputs;
  }

  const game = state.game;
  const rules = state.settings.rules;

  if (rules.continuousStim) {
    const period = Math.max(1, Number(rules.continuousOnMs) + Number(rules.continuousOffMs));
    const phase = nowMs() % period;
    const isOn = phase < Number(rules.continuousOnMs);

    if (isOn) {
      for (const player of Object.values(state.settings.players)) {
        const channel = getChannelForPlayer(player.id);
        outputs[channel] = Math.max(outputs[channel], calculateOutputFromCharge(player.id));
      }
    }
  }

  if (game.eventPulse && nowMs() <= Number(game.eventPulse.untilMs || 0)) {
    const event = game.eventPulse;
    const channel = getChannelForPlayer(event.playerId);
    outputs[channel] = Math.max(
      outputs[channel],
      calculateEventOutput(event.playerId, event.bonusPercent, event.minPercent)
    );
  }

  outputs.A = clamp(outputs.A, 0, getChannelSettings("A").limit);
  outputs.B = clamp(outputs.B, 0, getChannelSettings("B").limit);

  outputs.A = clamp(outputs.A, 0, 100);
  outputs.B = clamp(outputs.B, 0, 100);

  return outputs;
}

async function outputLoop() {
  const requested = computeRequestedOutputs();

  state.outputs.A = requested.A;
  state.outputs.B = requested.B;

  for (const player of Object.values(state.settings.players)) {
    const channel = getChannelForPlayer(player.id);
    player.output = channel === "A" ? state.outputs.A : state.outputs.B;
  }

  if (deviceClient && deviceClient.connected) {
    try {
      await deviceClient.sendOutputs(state.outputs.A, state.outputs.B, false);
    } catch (error) {
      console.error(error);
      safeStop("出力送信に失敗しました");
    }
  }
}

async function safeZero() {
  state.outputs.A = 0;
  state.outputs.B = 0;

  for (const player of Object.values(state.settings.players)) {
    player.output = 0;
  }

  if (deviceClient && deviceClient.connected) {
    await deviceClient.sendZeroRepeated();
  }
}

function safeStop(reason) {
  safeLockReason = reason || "安全停止しました";
  logLocal(`安全停止：${safeLockReason}`);
  state.phase = PHASE.SAFE_LOCKED;
  activeTestChannel = null;
  state.outputs.A = 0;
  state.outputs.B = 0;

  if (state.game) {
    state.game.eventPulse = null;
  }

  updateDeviceStatus(state.device.status, state.device.label, "SAFE_STOP");

  if (audioManager) {
    audioManager.playTone("critical", true);
    audioManager.speak(`安全停止しました。${safeLockReason}`, true);
  }

  safeZero().catch(() => {});
  render();
}

function showModal(title, message) {
  modalRoot.classList.remove("hidden");
  modalRoot.innerHTML = `
    <div class="modal-card">
      <h2 class="modal-title">${escapeHtml(title)}</h2>
      <p class="help">${escapeHtml(message)}</p>
      <div class="btn-row" style="margin-top: 18px;">
        <button class="btn primary wide" data-modal-close>閉じる</button>
      </div>
    </div>
  `;
}

function closeModal() {
  modalRoot.classList.add("hidden");
  modalRoot.innerHTML = "";
}

function registerGlobalEvents() {
  view.addEventListener("click", handleClick);
  view.addEventListener("input", handleInput);
  view.addEventListener("change", handleChange);
  view.addEventListener("pointerdown", handlePointerDown);
  view.addEventListener("pointerup", handlePointerUp);
  view.addEventListener("pointercancel", handlePointerUp);
  view.addEventListener("pointerleave", handlePointerUp);

  modalRoot.addEventListener("click", (event) => {
    if (event.target.matches("[data-modal-close]") || event.target === modalRoot) {
      closeModal();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && state?.settings?.safety?.visibilityStop) {
      safeStop("画面が非表示になりました");
    }
  });

  window.addEventListener("pagehide", () => {
    if (state) {
      state.outputs.A = 0;
      state.outputs.B = 0;
    }

    if (deviceClient && deviceClient.connected) {
      deviceClient.sendZeroRepeated().catch(() => {});
    }
  });

  window.addEventListener("beforeunload", () => {
    if (state) {
      state.outputs.A = 0;
      state.outputs.B = 0;
    }

    if (deviceClient && deviceClient.connected) {
      deviceClient.sendZeroRepeated().catch(() => {});
    }
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.warn(error);
  }
}

function startOutputLoop() {
  clearInterval(outputTimer);
  const hz = clamp(state.settings.safety.outputClampHz, 1, 60);
  const interval = Math.round(1000 / hz);
  outputTimer = setInterval(() => {
    outputLoop().catch((error) => {
      console.error(error);
    });
  }, interval);
}

function boot() {
  state = makeInitialState();
  deviceClient = new CompatibleDeviceClient();
  audioManager = new AudioManager();

  registerGlobalEvents();
  startOutputLoop();
  registerServiceWorker();

  logLocal(`${PRODUCT_NAME} 起動`);
  render();
}

boot();