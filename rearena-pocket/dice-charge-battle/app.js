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
  DICE_ROLLING_P1: "DICE_ROLLING_P1",
  WAIT_P2: "WAIT_P2",
  DICE_ROLLING_P2: "DICE_ROLLING_P2",
  ROUND_REVEAL_INTRO: "ROUND_REVEAL_INTRO",
  ROUND_REVEAL_FULL: "ROUND_REVEAL_FULL",
  SETTLEMENT_COUNTDOWN: "SETTLEMENT_COUNTDOWN",
  SETTLEMENT_PULSE: "SETTLEMENT_PULSE",
  ROUND_END_HOLD: "ROUND_END_HOLD",
  FINAL_RESULT_COUNTDOWN: "FINAL_RESULT_COUNTDOWN",
  FINAL_RESULT_PULSE: "FINAL_RESULT_PULSE",
  FINISHED: "FINISHED",
};

const ROLLING_STATUSES = new Set([
  GAME_STATUS.DICE_ROLLING_P1,
  GAME_STATUS.DICE_ROLLING_P2,
]);

const MESSAGE_ADVANCE_STATUSES = new Set([
  GAME_STATUS.ROUND_REVEAL_FULL,
  GAME_STATUS.ROUND_END_HOLD,
]);

const DEFAULT_SETTINGS = {
  players: {
    p1: {
      id: "p1",
      name: "P1",
      reading: "プレイヤー1",
      channel: "A",
      charge: 0,
      output: 0,
      gaveUp: false,
      colorIndex: 1,
    },
    p2: {
      id: "p2",
      name: "P2",
      reading: "プレイヤー2",
      channel: "B",
      charge: 0,
      output: 0,
      gaveUp: false,
      colorIndex: 2,
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
    introHoldMs: 900,
    messageHoldMs: 1800,
    stimMessageHoldMs: 1600,
    noticeMessageHoldMs: 1400,
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
let stateMachineTimer = null;
let renderTimer = null;
let diceAnimationTimers = new Map();
let previousGaugeValues = new Map();
let localLog = [];
let activeTestChannel = null;
let safeLockReason = "";
let paused = false;
let lastStateMachineStatus = "";
let lastSpeechKey = "";

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

function isAccessGranted() {
  return hasAccess();
}

function setAccessGranted() {
  localStorage.setItem(STORAGE_KEYS.access, ACCESS_CODE);
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
      simulation: false,
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
    id: "dice_charge_battle",
    title: PRODUCT_NAME,
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
      last: null,
    },
    diceFaces: {
      p1: [],
      p2: [],
      last: [],
    },
    lastDiceOwnerId: null,
    lastLoserId: null,
    lastWinnerId: null,
    lastChargeDelta: 0,
    lastDiff: 0,
    pendingRoundResult: null,
    countdownUntilMs: null,
    settlementUntilMs: null,
    phaseUntilMs: null,
    eventPulse: null,
    winnerId: null,
    winnerName: "",
    reason: "",
    startedAtMs: null,
    finishedAtMs: null,
  };
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

function getPlayerOutput(playerId) {
  const channel = getChannelForPlayer(playerId);
  return channel === "A" ? state.outputs.A : state.outputs.B;
}

function getPlayerCharge(playerId) {
  const player = getPlayer(playerId);
  return clamp(player?.charge || 0, 0, 100);
}

function calculateOutputFromCharge(playerId) {
  const charge = getPlayerCharge(playerId);
  const limit = getPlayerLimit(playerId);
  return clamp(charge * limit / 100, 0, limit);
}

function calculateEventOutput(playerId, bonusPercent, minimumPercent) {
  const base = calculateOutputFromCharge(playerId);
  const limit = getPlayerLimit(playerId);
  const value = Math.max(base + Number(bonusPercent || 0), Number(minimumPercent || 0));
  return clamp(value, 0, limit);
}

function playerToneClass(player) {
  if (!player) {
    return "player-tone-1";
  }
  return `player-tone-${player.colorIndex || (player.id === "p2" ? 2 : 1)}`;
}

function toneTextClass(player) {
  if (!player) {
    return "tone-text-1";
  }
  return `tone-text-${player.colorIndex || (player.id === "p2" ? 2 : 1)}`;
}

function updateDeviceStatus(status, label, safeState) {
  state.device.status = status;
  state.device.label = label;
  state.device.safeState = safeState;
  forceRenderSoon();
}

function statusDot(status, safeState) {
  if (safeState === "SIMULATION") {
    return `<span class="dot safe">●</span>確認モード`;
  }

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

function header(title, subtitle = "", options = {}) {
  return `
    <header class="header">
      <div class="header-main">
        <div class="brand-kicker">${escapeHtml(SERIES_NAME)}</div>
        <h1 class="header-title">${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="header-sub">${escapeHtml(subtitle)}</p>` : ""}
      </div>

      <div class="header-actions">
        <div class="status-strip">
          ${options.showRotateChip ? `<div class="pill rotate-chip">縦画面推奨</div>` : ""}
          <div class="pill">
            低周波デバイス
            ${statusDot(state.device.status, state.device.safeState)}
          </div>
          <div class="pill" data-output-pill>
            A ${formatPercent(state.outputs.A)} / B ${formatPercent(state.outputs.B)}
          </div>
          ${options.showMenuChip ? `<button class="btn chip" data-action="go-rule-setup">設定</button>` : ""}
        </div>
      </div>
    </header>
  `;
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
    renderDiceDebtPlaying();
  } else if (state.phase === PHASE.RESULT) {
    renderResult();
  } else if (state.phase === PHASE.SAFE_LOCKED) {
    renderSafeLocked();
  } else {
    renderAccess();
  }

  updateDynamicLabels();
  applyGaugeAnimation();
  applyDiceRollingClass();
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
          本アプリは対応低周波BLEデバイスのA/Bチャンネル出力を制御します。<br>
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
  const simulation = Boolean(deviceClient && deviceClient.connected && deviceClient.simulation);

  view.innerHTML = `
    <section class="screen">
      ${header(PRODUCT_NAME, "低周波デバイス接続")}

      <section class="card">
        <h2 class="section-title">接続状態 <small>Web Bluetooth</small></h2>
        ${renderMessageBox(
          simulation
            ? `低周波デバイスなし確認モードです\n画面・音声・ゲーム進行のみを確認できます`
            : connected
              ? `低周波デバイスに接続しています\n${state.device.label}`
              : `低周波デバイスを接続してください\n対応状況：${supported}`,
          connected ? "win" : "normal"
        )}

        <div class="grid two" style="margin-top: 16px;">
          <button class="btn primary big" data-action="connect-known">かんたん接続</button>
          <button class="btn ghost big" data-action="connect-preferred">推奨IDから探す</button>
          <button class="btn ghost big" data-action="connect-manual">手動で探す</button>
          <button class="btn danger big" data-action="disconnect-device">切断</button>
        </div>

        <div class="card soft simulation-card">
          <h3 class="section-title mini">実機なし確認 <small>開発・動作確認用</small></h3>
          <p class="help">
            低周波デバイスに接続せず、画面・音声・ゲーム進行のみを確認します。<br>
            A/Bチャンネルの出力値は画面上に表示されますが、実機には送信されません。
          </p>
          <button class="btn ghost compact" data-action="connect-simulation">
            低周波デバイスなし確認モード
          </button>
        </div>

        <p class="help">
          かんたん接続は、過去にこのサイトへ許可した対応デバイスへ再接続します。<br>
          初回または見つからない場合は「推奨IDから探す」または「手動で探す」を使用してください。
        </p>
      </section>

      <section class="card">
        <h2 class="section-title">次の手順</h2>
        <p class="help">
          接続後、チャンネルA/Bの個別テストを行います。テストが終わるまでゲーム開始はロックされます。<br>
          低周波デバイスなし確認モードでも、画面上の出力ゲージとゲーム進行を確認できます。
        </p>
        <button class="btn primary wide" data-action="go-channel-test" ${connected ? "" : "disabled"}>A/Bチャンネル設定へ</button>
      </section>

      ${renderFooterSafeBasic()}
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

      ${renderFooterSafeBasic()}
    </section>
  `;
}

function renderChannelCard(channel) {
  const cfg = getChannelSettings(channel);
  const player = getPlayerByChannel(channel);
  const playerClass = player && player.id === "p2" ? "player-tone-2" : "player-tone-1";

  return `
    <section class="card player-battle-card ${playerClass}">
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
        <section class="card player-battle-card player-tone-1">
          <h2 class="section-title">P1</h2>
          <label class="label" for="p1-name">名前</label>
          <input id="p1-name" class="input" data-player-name="p1" value="${escapeHtml(p1.name)}">
          <p class="help">P1はチャンネルAに割り当てられます。</p>
        </section>

        <section class="card player-battle-card player-tone-2">
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

      ${renderFooterSafeBasic()}
    </section>
  `;
}

function renderDiceDebtPlaying() {
  const game = state.game;
  const p1 = getPlayer("p1");
  const p2 = getPlayer("p2");
  const disabled = paused || !canRoll(game);

  view.innerHTML = `
    <section class="screen">
      ${header(game?.title || "ゲーム中", game?.message || "", { showRotateChip: true, showMenuChip: true })}

      <div class="battle-main">
        <div class="desktop-hud play-layout">
          ${renderBattlePlayerCard(p1, { showHp: false, debtLabel: "Charge" })}
          ${renderBattlePlayerCard(p2, { showHp: false, debtLabel: "Charge" })}
        </div>

        <div class="mobile-hud">
          ${renderMiniHud(p1, { showHp: false, debtLabel: "Charge" })}
          ${renderMiniHud(p2, { showHp: false, debtLabel: "Charge" })}
        </div>

        <section class="card game-center ${isMessageAdvanceReady(game) ? "message-hold-clickable" : ""}">
          <div class="round-label">
            ${renderRoundLabel(game)}
          </div>

          ${renderMessageBox(game?.message || "", game?.messageTone || "normal")}

          ${paused ? `<div class="pause-banner">PAUSED：再開するまで進行しません</div>` : ""}
          ${renderPhaseHint(game)}
          ${renderMessageAdvanceHint(game)}

          <div class="dice-area">
            ${renderDiceBox(p1, game?.dice?.p1, game?.diceFaces?.p1 || [], "p1-dice-value")}
            ${renderDiceBox(p2, game?.dice?.p2, game?.diceFaces?.p2 || [], "p2-dice-value")}
          </div>

          <div class="battle-actions">
            <button class="btn primary big" id="btn-roll" data-action="roll-current" ${disabled ? "disabled" : ""}>
              🎲 ふる
            </button>
          </div>
        </section>

        <div class="log-section-desktop">
          ${renderLogSection()}
        </div>
      </div>

      ${renderGameFooter(p1, p2)}
    </section>
  `;
}

function renderBattlePlayerCard(player, options = {}) {
  if (!player) {
    return "";
  }

  const charge = clamp(player.charge, 0, 100);
  const output = clamp(getPlayerOutput(player.id), 0, 100);
  const channel = getChannelForPlayer(player.id);
  const limit = getPlayerLimit(player.id);
  const active = isPlayerActive(player.id);
  const pulsing = output > 0.01;
  const debtLabel = options.debtLabel || "Charge";

  return `
    <section class="card player-battle-card ${playerToneClass(player)} ${active ? "active-turn" : ""} ${pulsing ? "output-active" : ""}">
      <div class="player-battle-head">
        <div>
          <div class="player-role">${escapeHtml(player.id.toUpperCase())} / ${escapeHtml(channel)}</div>
          <h2 class="player-battle-name ${toneTextClass(player)}">${escapeHtml(player.name)}</h2>
        </div>
        <div class="player-battle-badge">${active ? "TURN" : "WAIT"}</div>
      </div>

      <div class="player-battle-stat">
        <span>${escapeHtml(debtLabel)}</span>
        <strong data-player-charge="${escapeHtml(player.id)}">${Math.round(charge)}</strong>
      </div>

      ${renderGauge(`charge-${player.id}`, charge, "charge", player)}

      <div class="player-battle-stat">
        <span>OUT</span>
        <strong data-player-output="${escapeHtml(player.id)}">${formatPercent(output)}</strong>
      </div>

      ${renderGauge(`output-${player.id}`, output, "output", player)}

      <div class="player-battle-meta">
        <span>Limit ${formatPercent(limit)}</span>
        <span data-output-state="${escapeHtml(player.id)}">${pulsing ? "継続出力 ON" : "継続出力 OFF"}</span>
      </div>
    </section>
  `;
}

function renderMiniHud(player, options = {}) {
  if (!player) {
    return "";
  }

  const charge = clamp(player.charge, 0, 100);
  const output = clamp(getPlayerOutput(player.id), 0, 100);
  const debtLabel = options.debtLabel || "Charge";
  const active = isPlayerActive(player.id);

  return `
    <section class="mini-hud-card ${playerToneClass(player)} ${active ? "active-turn" : ""}">
      <div class="mini-hud-top">
        <span class="mini-name ${toneTextClass(player)}">${escapeHtml(player.name)}</span>
        <span class="mini-turn">${active ? "TURN" : "WAIT"}</span>
      </div>
      <div class="mini-line">
        <span>${escapeHtml(debtLabel)} <strong data-player-charge="${escapeHtml(player.id)}">${Math.round(charge)}</strong></span>
        <span>OUT <strong data-player-output="${escapeHtml(player.id)}">${Math.round(output)}</strong></span>
      </div>
      <div class="mini-gauges">
        ${renderGauge(`mini-charge-${player.id}`, charge, "charge mini", player)}
        ${renderGauge(`mini-output-${player.id}`, output, "output mini", player)}
      </div>
    </section>
  `;
}

function renderGauge(key, value, type, player) {
  const target = clamp(value, 0, 100);
  const previous = previousGaugeValues.has(key) ? previousGaugeValues.get(key) : 0;
  const tone = player ? `gauge-${player.id}` : "";

  return `
    <div class="gauge ${escapeHtml(type)}">
      <div
        class="gauge-fill ${escapeHtml(type)} ${escapeHtml(tone)}"
        data-gauge-key="${escapeHtml(key)}"
        data-gauge-value="${target}"
        style="width:${previous}%"
      ></div>
    </div>
  `;
}

function applyGaugeAnimation() {
  const gaugeTargets = Array.from(document.querySelectorAll("[data-gauge-key]"));

  if (gaugeTargets.length === 0) {
    return;
  }

  requestAnimationFrame(() => {
    gaugeTargets.forEach((el) => {
      const key = el.dataset.gaugeKey;
      const target = clamp(el.dataset.gaugeValue, 0, 100);
      el.style.width = `${target}%`;
      previousGaugeValues.set(key, target);
    });
  });
}

function renderRoundLabel(game) {
  if (!game) {
    return "ROUND";
  }

  if (game.status === GAME_STATUS.FINAL_RESULT_COUNTDOWN || game.status === GAME_STATUS.FINAL_RESULT_PULSE) {
    return "FINAL";
  }

  if (game.suddenDeath) {
    return `ROUND ${escapeHtml(game.round || 1)} / SUDDEN DEATH`;
  }

  return `ROUND ${escapeHtml(game.round || 1)} / ${escapeHtml(game.maxRounds || state.settings.rules.rounds)}`;
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

function renderPhaseHint(game) {
  if (!game) {
    return "";
  }

  if (ROLLING_STATUSES.has(game.status)) {
    return `<div class="message-advance-hint" data-phase-hint>ダイス演出中...</div>`;
  }

  if (game.status === GAME_STATUS.SETTLEMENT_PULSE || game.status === GAME_STATUS.FINAL_RESULT_PULSE) {
    return `<div class="message-advance-hint ready" data-phase-hint>精算中</div>`;
  }

  if (game.status === GAME_STATUS.SETTLEMENT_COUNTDOWN || game.status === GAME_STATUS.FINAL_RESULT_COUNTDOWN) {
    return `<div class="message-advance-hint ready" data-phase-hint>カウントダウン中</div>`;
  }

  return `<div class="message-advance-hint hidden" data-phase-hint></div>`;
}

function renderMessageAdvanceHint(game) {
  if (!isMessageAdvanceReady(game)) {
    return "";
  }

  return `<div class="message-advance-hint ready">自動進行します / タップでスキップ</div>`;
}

function isMessageAdvanceReady(game) {
  return game && MESSAGE_ADVANCE_STATUSES.has(game.status);
}

function renderDiceBox(player, value, faces, elementId) {
  if (!player) {
    return "";
  }

  const shownFaces = getShownDiceFaces(player.id, faces);
  const active = isPlayerActive(player.id);
  const rolling = ROLLING_STATUSES.has(state.game.status) && state.game.lastDiceOwnerId === player.id;

  return `
    <div class="dice-box ${playerToneClass(player)} ${active ? "active" : ""} ${rolling ? "rolling" : ""}">
      <div class="dice-label ${toneTextClass(player)}">${escapeHtml(player.name)}</div>
      <div class="dice-illustration ${toneTextClass(player)}" id="${escapeHtml(elementId)}" data-dice-illustration="${escapeHtml(player.id)}">
        ${renderDiceFaces(shownFaces.length ? shownFaces : value ? [value] : [])}
      </div>
      <div class="dice-total">DICE ${escapeHtml(value ?? "–")}</div>
    </div>
  `;
}

function renderDiceFaces(faces) {
  if (!faces || faces.length === 0) {
    return `<span class="dice-face">–</span>`;
  }

  return faces
    .map((face) => `<span class="dice-face">${escapeHtml(DICE_UNICODE[Number(face)] || String(face))}</span>`)
    .join("");
}

function getRollingOwnerId(game) {
  if (!game || !ROLLING_STATUSES.has(game.status)) {
    return null;
  }

  return game.lastDiceOwnerId || null;
}

function getRandomDiceFaces(count) {
  return Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1);
}

function getShownDiceFaces(playerId, realFaces) {
  const game = state.game;
  const ownerId = getRollingOwnerId(game);

  if (!ownerId || ownerId !== playerId) {
    return realFaces;
  }

  return getRandomDiceFaces(1);
}

function applyDiceRollingClass() {
  document.querySelectorAll("[data-dice-illustration]").forEach((target) => {
    target.classList.remove("rolling");
  });

  const game = state?.game;

  if (!game || !ROLLING_STATUSES.has(game.status)) {
    clearDiceAnimationTimersExcept("");
    return;
  }

  const ownerId = getRollingOwnerId(game);

  if (!ownerId) {
    return;
  }

  const selector = `[data-dice-illustration="${CSS.escape(ownerId)}"]`;

  document.querySelectorAll(selector).forEach((target) => {
    target.classList.add("rolling");
  });

  const key = `${game.id}:${game.status}:${game.lastDiceOwnerId}:${game.phaseUntilMs}`;

  clearDiceAnimationTimersExcept(key);

  if (diceAnimationTimers.has(key)) {
    return;
  }

  const intervalMs = Math.max(30, Number(state.settings.ui.diceAnimationIntervalMs || 55));

  const timer = setInterval(() => {
    const liveGame = state?.game;

    if (!liveGame || !ROLLING_STATUSES.has(liveGame.status)) {
      clearInterval(timer);
      diceAnimationTimers.delete(key);
      forceRenderSoon();
      return;
    }

    document.querySelectorAll(selector).forEach((target) => {
      target.innerHTML = renderDiceFaces(getRandomDiceFaces(1));
    });

    audioManager.playTone("roll");
  }, intervalMs);

  diceAnimationTimers.set(key, timer);
}

function clearDiceAnimationTimersExcept(activeKey) {
  for (const [key, timer] of diceAnimationTimers.entries()) {
    if (key === activeKey) {
      continue;
    }

    clearInterval(timer);
    diceAnimationTimers.delete(key);
  }
}

function renderLogSection() {
  return `
    <section class="card log-card">
      <h2 class="section-title">ログ</h2>
      <div class="log-box">${localLog.slice(-18).map(escapeHtml).join("<br>")}</div>
    </section>
  `;
}

function renderGameFooter(p1, p2) {
  return `
    <div class="footer-safe">
      <button class="btn ${paused ? "resume" : "pause"}" data-action="toggle-pause">
        ${paused ? "再開" : "一時停止"}
      </button>
      <button class="btn danger give-up-button" data-action="give-up-p1">
        ${escapeHtml(p1?.name || "P1")} ギブアップ
      </button>
      <button class="btn danger give-up-button" data-action="give-up-p2">
        ${escapeHtml(p2?.name || "P2")} ギブアップ
      </button>
    </div>
  `;
}

function renderFooterSafeBasic() {
  return `
    <footer class="footer-safe">
      <button class="btn danger" data-action="emergency-stop">緊急停止</button>
      <button class="btn ghost" data-action="go-connect">接続</button>
      <button class="btn ghost" data-action="go-channel-test">A/B設定</button>
    </footer>
  `;
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
  return `
    <section class="card player-battle-card ${playerToneClass(player)}">
      <h2 class="player-battle-name ${toneTextClass(player)}">${escapeHtml(player.name)}</h2>
      <div class="player-battle-stat">
        <span>Charge</span>
        <strong>${Math.round(player.charge)}</strong>
      </div>
      ${renderGauge(`result-charge-${player.id}`, player.charge, "charge", player)}
      <div class="player-battle-stat">
        <span>状態</span>
        <strong>${player.gaveUp ? "GIVE UP" : "OK"}</strong>
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

function areChannelsTested() {
  return Boolean(state.settings.channels.A.tested && state.settings.channels.B.tested);
}

function isPlayerActive(playerId) {
  const game = state.game;

  if (!game) {
    return false;
  }

  if (game.status === GAME_STATUS.WAIT_P1 || game.status === GAME_STATUS.DICE_ROLLING_P1) {
    return playerId === "p1";
  }

  if (game.status === GAME_STATUS.WAIT_P2 || game.status === GAME_STATUS.DICE_ROLLING_P2) {
    return playerId === "p2";
  }

  if (
    game.status === GAME_STATUS.SETTLEMENT_COUNTDOWN ||
    game.status === GAME_STATUS.SETTLEMENT_PULSE ||
    game.status === GAME_STATUS.FINAL_RESULT_COUNTDOWN ||
    game.status === GAME_STATUS.FINAL_RESULT_PULSE
  ) {
    return playerId === game.lastLoserId || playerId === game.pendingRoundResult?.loserId;
  }

  return false;
}

function canRoll(game) {
  if (!game) {
    return false;
  }

  if (paused) {
    return false;
  }

  return game.status === GAME_STATUS.WAIT_P1 || game.status === GAME_STATUS.WAIT_P2;
}

function getCurrentRollPlayerId() {
  if (state.game.status === GAME_STATUS.WAIT_P1) {
    return "p1";
  }

  if (state.game.status === GAME_STATUS.WAIT_P2) {
    return "p2";
  }

  return null;
}

function setPhaseTimer(game, durationMs) {
  game.phaseUntilMs = nowMs() + clampInt(durationMs, 0, 30000);
}

function phaseElapsed(game) {
  if (!game || !game.phaseUntilMs) {
    return true;
  }

  return nowMs() >= Number(game.phaseUntilMs);
}

function getMessageHoldMs(tone) {
  const rules = state.settings.rules;

  if (tone === "stim") {
    return clampInt(rules.stimMessageHoldMs || 1600, 300, 6000);
  }

  if (tone === "notice") {
    return clampInt(rules.noticeMessageHoldMs || 1400, 300, 6000);
  }

  return clampInt(rules.messageHoldMs || 1800, 300, 6000);
}

function uiIntroMs() {
  return clampInt(state.settings.rules.introHoldMs || 900, 300, 4000);
}

class CompatibleDeviceClient {
  constructor() {
    this.device = null;
    this.server = null;
    this.service = null;
    this.characteristic = null;
    this.connected = false;
    this.simulation = false;
    this.lastWriteMs = 0;
    this.lastPayload = "";
  }

  isSupported() {
    return Boolean(navigator.bluetooth);
  }

  async connectKnown() {
    this.simulation = false;

    if (!this.isSupported()) {
      throw new Error("このブラウザはWeb Bluetoothに対応していません");
    }

    if (typeof navigator.bluetooth.getDevices !== "function") {
      throw new Error("このブラウザでは許可済みデバイスの取得に対応していません");
    }

    const devices = await navigator.bluetooth.getDevices();
    const named = devices.filter((device) => String(device.name || "").startsWith(DEVICE_NAME_PREFIX));

    if (named.length === 0) {
      throw new Error("許可済みの対応低周波デバイスが見つかりません。手動で探してください。");
    }

    await this.connectToDevice(named[0]);
  }

  async requestPreferred() {
    this.simulation = false;

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
    this.simulation = false;

    if (!this.isSupported()) {
      throw new Error("このブラウザはWeb Bluetoothに対応していません");
    }

    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [DEVICE_SERVICE_UUID],
    });

    await this.connectToDevice(device);
  }

  async connectSimulation() {
    await this.disconnect();

    this.device = null;
    this.server = null;
    this.service = null;
    this.characteristic = null;
    this.connected = true;
    this.simulation = true;
    this.lastPayload = "";

    state.device.simulation = true;
    updateDeviceStatus("connected", "低周波デバイスなし確認モード", "SIMULATION");

    logLocal("低周波デバイスなし確認モードを開始しました");
  }

  async connectToDevice(device) {
    this.device = device;
    this.simulation = false;

    this.device.addEventListener("gattserverdisconnected", () => {
      this.connected = false;
      this.simulation = false;
      state.device.simulation = false;
      updateDeviceStatus("disconnected", "切断", "DISCONNECTED");
      safeStop("低周波デバイスが切断されました");
    });

    updateDeviceStatus("reconnecting", "接続中", "RECONNECTING");
    this.server = await this.device.gatt.connect();
    this.service = await this.server.getPrimaryService(DEVICE_SERVICE_UUID);
    this.characteristic = await this.service.getCharacteristic(DEVICE_CHAR_UUID);
    this.connected = true;
    this.simulation = false;
    this.lastPayload = "";

    state.device.simulation = false;
    updateDeviceStatus("connected", this.device.name || "接続済み", "CONNECTED");

    await this.sendInit();
    await this.sendZeroRepeated();

    logLocal("低周波デバイスに接続しました");
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
    this.simulation = false;

    if (state && state.device) {
      state.device.simulation = false;
    }

    updateDeviceStatus("disconnected", "未接続", "DISCONNECTED");
  }

  async sendInit() {
    if (this.simulation) {
      return;
    }

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
    if (!this.connected) {
      return;
    }

    const hz = clamp(state.settings.safety.outputClampHz, 1, 60);
    const minInterval = Math.round(1000 / hz);
    const current = nowMs();

    if (!force && current - this.lastWriteMs < minInterval) {
      return;
    }

    if (this.simulation) {
      this.lastWriteMs = current;
      return;
    }

    if (!this.characteristic) {
      return;
    }

    const payload = this.makePayload(outputA, outputB);
    await this.writePayload(payload, force);
    this.lastWriteMs = current;
  }

  async writePayload(payload, force = false) {
    if (this.simulation) {
      return;
    }

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
    if (this.simulation) {
      return;
    }

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

    if (tone === "roll") {
      frequency = 740 + Math.random() * 80;
      duration = 0.045;
      type = "square";
    } else if (tone === "dice-set") {
      frequency = 980;
      duration = 0.12;
      type = "triangle";
    } else if (tone === "stim") {
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
    } else if (tone === "count") {
      frequency = 420;
      duration = 0.08;
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

function resetPlayersForGame() {
  for (const player of Object.values(state.settings.players)) {
    player.charge = 0;
    player.output = 0;
    player.gaveUp = false;
  }

  state.outputs.A = 0;
  state.outputs.B = 0;
}

function startGame() {
  saveSettings();
  paused = false;
  lastStateMachineStatus = "";
  lastSpeechKey = "";
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
  speakGameOnce("start", state.game.speechText, true);
  render();
}

function randomDiceValue() {
  return Math.floor(Math.random() * 6) + 1;
}

function rollCurrentDice() {
  const playerId = getCurrentRollPlayerId();

  if (!playerId) {
    return;
  }

  rollDiceFor(playerId);
}

function rollDiceFor(playerId) {
  const game = state.game;

  if (paused) {
    return;
  }

  if (playerId === "p1" && game.status !== GAME_STATUS.WAIT_P1) {
    return;
  }

  if (playerId === "p2" && game.status !== GAME_STATUS.WAIT_P2) {
    return;
  }

  const player = getPlayer(playerId);
  const status = playerId === "p1" ? GAME_STATUS.DICE_ROLLING_P1 : GAME_STATUS.DICE_ROLLING_P2;

  game.status = status;
  game.lastDiceOwnerId = playerId;
  game.phaseUntilMs = null;
  setPhaseTimer(game, state.settings.ui.diceAnimationMs);
  game.message = `${player.name} ダイスロール！`;
  game.speechText = `${player.name}、ダイスロール。`;
  game.messageTone = "normal";

  audioManager.playTone("roll");
  speakGameOnce(`${status}:${game.round}`, game.speechText);
  render();
}

function createDiceRoundResult() {
  const game = state.game;
  const rules = state.settings.rules;
  const p1 = getPlayer("p1");
  const p2 = getPlayer("p2");
  const p1Value = Number(game.dice.p1 || 0);
  const p2Value = Number(game.dice.p2 || 0);

  if (p1Value === p2Value) {
    const delta = clamp(Number(rules.drawCharge || 0), 0, 100);

    return {
      draw: true,
      winnerId: null,
      loserId: null,
      chargeDelta: delta,
      diff: 0,
      tone: "stim",
      messageIntro: `${p1.name} ${p1Value}　vs　${p2.name} ${p2Value}`,
      speechIntro: `${p1.name}${p1Value}。${p2.name}${p2Value}。`,
      messageFull: `${p1Value} 対 ${p2Value}\nあいこ！\n両者にCharge +${Math.round(delta)}`,
      speechFull: `あいこ。両者にチャージ${Math.round(delta)}。`,
      applied: false,
    };
  }

  const p1Wins = p1Value > p2Value;
  const winner = p1Wins ? p1 : p2;
  const loser = p1Wins ? p2 : p1;
  const diff = Math.abs(p1Value - p2Value);
  const delta = clamp(diff * Number(rules.chargeMultiplier || 5), 0, 100);

  return {
    draw: false,
    winnerId: winner.id,
    loserId: loser.id,
    chargeDelta: delta,
    diff,
    tone: "stim",
    messageIntro: `${p1.name} ${p1Value}　vs　${p2.name} ${p2Value}`,
    speechIntro: `${p1.name}${p1Value}。${p2.name}${p2Value}。`,
    messageFull: `${winner.name} の勝ち！\n差分 ${diff}\n${loser.name}にCharge +${Math.round(delta)}`,
    speechFull: `${winner.name}の勝ち。${loser.name}にチャージ${Math.round(delta)}。`,
    applied: false,
  };
}

function applyPendingDiceRoundResult() {
  const game = state.game;
  const result = game.pendingRoundResult;

  if (!result || result.applied) {
    return;
  }

  if (result.draw) {
    const p1 = getPlayer("p1");
    const p2 = getPlayer("p2");
    p1.charge = clamp(p1.charge + Number(result.chargeDelta || 0), 0, 100);
    p2.charge = clamp(p2.charge + Number(result.chargeDelta || 0), 0, 100);
    logLocal(`あいこ：両者 Charge +${Math.round(result.chargeDelta)}`);
  } else {
    const loser = getPlayer(result.loserId);
    const winner = getPlayer(result.winnerId);
    if (loser) {
      loser.charge = clamp(loser.charge + Number(result.chargeDelta || 0), 0, 100);
    }
    logLocal(`${winner ? winner.name : "勝者"}勝利：${loser ? loser.name : "敗者"} Charge +${Math.round(result.chargeDelta)}`);
  }

  result.applied = true;
  game.lastLoserId = result.loserId;
  game.lastWinnerId = result.winnerId;
  game.lastChargeDelta = result.chargeDelta;
  game.lastDiff = result.diff;
}

function updateDiceDebtStateMachine() {
  if (!state || state.phase !== PHASE.PLAYING) {
    return;
  }

  const game = state.game;

  if (!game || game.status === GAME_STATUS.FINISHED) {
    return;
  }

  if (paused) {
    return;
  }

  if (lastStateMachineStatus !== game.status) {
    lastStateMachineStatus = game.status;
    forceRenderSoon();
  }

  if (game.status === GAME_STATUS.DICE_ROLLING_P1) {
    if (phaseElapsed(game)) {
      const value = randomDiceValue();
      const player = getPlayer("p1");

      game.dice.p1 = value;
      game.dice.last = value;
      game.diceFaces.p1 = [value];
      game.diceFaces.last = [value];
      game.lastDiceOwnerId = null;
      game.status = GAME_STATUS.WAIT_P2;
      game.message = `${player.name} の出目は ${value}！\n${state.settings.players.p2.name}がダイスを振ってください`;
      game.speechText = `${player.name}の出目は${value}。${state.settings.players.p2.name}がダイスを振ってください。`;
      game.messageTone = "normal";
      game.phaseUntilMs = null;

      logLocal(`${player.name} 出目 ${value}`);
      audioManager.playTone("dice-set");
      speakGameOnce(`p1-result:${game.round}`, game.speechText);
      forceRenderSoon();
    }
    return;
  }

  if (game.status === GAME_STATUS.DICE_ROLLING_P2) {
    if (phaseElapsed(game)) {
      const value = randomDiceValue();
      const player = getPlayer("p2");

      game.dice.p2 = value;
      game.dice.last = value;
      game.diceFaces.p2 = [value];
      game.diceFaces.last = [value];
      game.lastDiceOwnerId = null;
      game.pendingRoundResult = createDiceRoundResult();

      const result = game.pendingRoundResult;
      game.status = GAME_STATUS.ROUND_REVEAL_INTRO;
      game.message = result.messageIntro;
      game.speechText = result.speechIntro || result.messageIntro;
      game.messageTone = result.tone || "stim";
      setPhaseTimer(game, uiIntroMs());

      logLocal(`${player.name} 出目 ${value}`);
      audioManager.playTone("dice-set");
      speakGameOnce(`intro:${game.round}`, game.speechText);
      forceRenderSoon();
    }
    return;
  }

  if (game.status === GAME_STATUS.ROUND_REVEAL_INTRO) {
    if (phaseElapsed(game)) {
      applyPendingDiceRoundResult();

      const result = game.pendingRoundResult || {};
      game.status = GAME_STATUS.ROUND_REVEAL_FULL;
      game.message = result.messageFull || "";
      game.speechText = result.speechFull || "";
      game.messageTone = result.tone || "stim";
      setPhaseTimer(game, getMessageHoldMs(result.tone || "stim"));

      audioManager.playTone("stim");
      speakGameOnce(`full:${game.round}`, game.speechText);
      forceRenderSoon();
    }
    return;
  }

  if (game.status === GAME_STATUS.ROUND_REVEAL_FULL) {
    if (phaseElapsed(game)) {
      const result = game.pendingRoundResult || {};

      if (game.suddenDeath && result.winnerId) {
        const winner = getPlayer(result.winnerId);
        finishGame(result.winnerId, winner ? `サドンデス勝利：${winner.name} の勝ち` : "サドンデス勝利");
        return;
      }

      if (result.draw && game.suddenDeath) {
        game.status = GAME_STATUS.WAIT_P1;
        game.dice = { p1: null, p2: null, last: null };
        game.diceFaces = { p1: [], p2: [], last: [] };
        game.lastDiceOwnerId = null;
        game.pendingRoundResult = null;
        game.message = "サドンデスあいこ！\nもう一度振ってください";
        game.speechText = "あいこ。もう一度振ってください。";
        game.messageTone = "notice";
        game.phaseUntilMs = null;
        audioManager.playTone("notice");
        speakGameOnce(`sudden-draw:${game.round}`, game.speechText);
        forceRenderSoon();
        return;
      }

      if (result.loserId && state.settings.rules.settlementStim) {
        startDiceSettlementCountdown();
        return;
      }

      advanceDiceRound();
    }
    return;
  }

  if (game.status === GAME_STATUS.SETTLEMENT_COUNTDOWN) {
    updateDiceSettlementCountdown();
    return;
  }

  if (game.status === GAME_STATUS.SETTLEMENT_PULSE) {
    updateDiceSettlementPulse();
    return;
  }

  if (game.status === GAME_STATUS.ROUND_END_HOLD) {
    if (phaseElapsed(game)) {
      advanceDiceRound();
    }
    return;
  }

  if (game.status === GAME_STATUS.FINAL_RESULT_COUNTDOWN) {
    updateFinalResultCountdown();
    return;
  }

  if (game.status === GAME_STATUS.FINAL_RESULT_PULSE) {
    updateFinalResultPulse();
  }
}

function startDiceSettlementCountdown() {
  const game = state.game;
  const cfg = state.settings.rules;
  const loser = getPlayer(game.lastLoserId);

  game.status = GAME_STATUS.SETTLEMENT_COUNTDOWN;
  game.countdownUntilMs = nowMs() + clampInt(cfg.settlementCountdownMs, 1000, 10000);
  game.settlementUntilMs = null;
  game.phaseUntilMs = null;

  if (loser) {
    game.message = `${loser.name} 精算まで 3\nCharge +${Math.round(game.lastChargeDelta || 0)}`;
    game.speechText = "3";
    game.messageTone = "notice";
  }

  logLocal(`${loser ? loser.name : "敗者"} 精算カウント開始`);
  audioManager.playTone("count");
  speakGameOnce(`settlement-count-start:${game.round}`, game.speechText);
  forceRenderSoon();
}

function updateDiceSettlementCountdown() {
  const game = state.game;
  const currentMs = nowMs();
  const until = Number(game.countdownUntilMs || 0);
  const remainMs = Math.max(0, until - currentMs);
  const sec = Math.ceil(remainMs / 1000);
  const loser = getPlayer(game.lastLoserId);

  if (loser) {
    const nextMessage = `${loser.name} 精算まで ${sec}\nCharge +${Math.round(game.lastChargeDelta || 0)}`;
    const nextSpeech = String(sec);

    if (game.message !== nextMessage) {
      game.message = nextMessage;
      game.speechText = nextSpeech;
      game.messageTone = "notice";
      audioManager.playTone("count");
      speakGameOnce(`settlement-count:${game.round}:${sec}`, nextSpeech);
      forceRenderSoon();
    }
  }

  if (currentMs >= until) {
    game.status = GAME_STATUS.SETTLEMENT_PULSE;
    game.settlementUntilMs = currentMs + clampInt(state.settings.rules.settlementDurationMs, 100, 5000);
    game.phaseUntilMs = null;

    safeZero().catch(() => {});

    if (loser) {
      game.message = `${loser.name} 精算！`;
      game.speechText = "精算";
      game.messageTone = "stim";
    }

    game.eventPulse = {
      playerId: loser ? loser.id : null,
      untilMs: game.settlementUntilMs,
      bonusPercent: clamp(state.settings.rules.settlementBonusPercent, 0, 50),
      minPercent: 0,
      reason: "精算",
    };

    logLocal(`${loser ? loser.name : "敗者"} 精算開始`);
    audioManager.playTone("critical");
    speakGameOnce(`settlement-pulse:${game.round}`, game.speechText);
    forceRenderSoon();
  }
}

function updateDiceSettlementPulse() {
  const game = state.game;
  const loser = getPlayer(game.lastLoserId);
  const until = Number(game.settlementUntilMs || 0);
  const currentMs = nowMs();

  if (loser && currentMs <= until) {
    return;
  }

  if (loser) {
    const channel = getChannelForPlayer(loser.id);
    state.outputs[channel] = 0;
  }

  game.eventPulse = null;
  game.status = GAME_STATUS.ROUND_END_HOLD;
  game.message = "精算完了！";
  game.speechText = "精算完了";
  game.messageTone = "stim";
  setPhaseTimer(game, getMessageHoldMs("stim"));

  logLocal("精算完了");
  audioManager.playTone("stim");
  speakGameOnce(`settlement-end:${game.round}`, game.speechText);
  forceRenderSoon();
}

function advanceDiceRound() {
  const game = state.game;
  const currentRound = Number(game.round || 1);
  const maxRounds = Number(game.maxRounds || state.settings.rules.rounds || 10);

  if (currentRound >= maxRounds) {
    startFinalResultFlow();
    return;
  }

  game.round = currentRound + 1;
  game.status = GAME_STATUS.WAIT_P1;
  game.dice = { p1: null, p2: null, last: null };
  game.diceFaces = { p1: [], p2: [], last: [] };
  game.lastDiceOwnerId = null;
  game.lastLoserId = null;
  game.lastWinnerId = null;
  game.lastChargeDelta = 0;
  game.lastDiff = 0;
  game.pendingRoundResult = null;
  game.countdownUntilMs = null;
  game.settlementUntilMs = null;
  game.phaseUntilMs = null;
  game.eventPulse = null;
  game.message = `ROUND ${game.round}：${state.settings.players.p1.name}がダイスを振ってください`;
  game.speechText = `ラウンド${game.round}。${state.settings.players.p1.name}がダイスを振ってください。`;
  game.messageTone = "normal";

  audioManager.playTone("notice");
  speakGameOnce(`round:${game.round}`, game.speechText);
  forceRenderSoon();
}

function startFinalResultFlow() {
  const game = state.game;
  const p1 = getPlayer("p1");
  const p2 = getPlayer("p2");

  if (p1.charge === p2.charge) {
    game.suddenDeath = true;
    game.round += 1;
    game.status = GAME_STATUS.WAIT_P1;
    game.dice = { p1: null, p2: null, last: null };
    game.diceFaces = { p1: [], p2: [], last: [] };
    game.lastDiceOwnerId = null;
    game.pendingRoundResult = null;
    game.message = `同点！\nサドンデス：${p1.name}がダイスを振ってください`;
    game.speechText = `同点。サドンデス。${p1.name}がダイスを振ってください。`;
    game.messageTone = "critical";
    game.phaseUntilMs = null;

    audioManager.playTone("critical");
    speakGameOnce(`sudden:${game.round}`, game.speechText);
    forceRenderSoon();
    return;
  }

  const winner = p1.charge < p2.charge ? p1 : p2;
  const loser = p1.charge < p2.charge ? p2 : p1;

  startFinalResultCountdown(winner.id, loser.id, `規定ラウンド終了：${winner.name} の勝利`);
}

function startFinalResultCountdown(winnerId, loserId, reason) {
  const game = state.game;

  game.status = GAME_STATUS.FINAL_RESULT_COUNTDOWN;
  game.pendingRoundResult = {
    winnerId,
    loserId,
    reason,
  };
  game.lastLoserId = loserId;
  game.countdownUntilMs = nowMs() + clampInt(state.settings.rules.finalSettlementCountdownMs, 1000, 10000);
  game.settlementUntilMs = null;
  game.phaseUntilMs = null;

  logLocal("最終精算カウント開始");
  updateFinalResultCountdown();
}

function updateFinalResultCountdown() {
  const game = state.game;

  if (game.status !== GAME_STATUS.FINAL_RESULT_COUNTDOWN || paused) {
    return;
  }

  const loser = getPlayer(game.pendingRoundResult.loserId);
  const remain = Math.max(0, Number(game.countdownUntilMs || 0) - nowMs());
  const sec = Math.ceil(remain / 1000);

  const nextMessage = loser ? `${loser.name} 最終精算まで ${sec}` : `最終精算まで ${sec}`;
  const nextSpeech = String(sec);

  if (game.message !== nextMessage) {
    game.message = nextMessage;
    game.speechText = nextSpeech;
    game.messageTone = "notice";

    audioManager.playTone("count");
    speakGameOnce(`final-count:${sec}`, nextSpeech);
    forceRenderSoon();
  }

  if (remain <= 0) {
    startFinalResultPulse();
  }
}

function startFinalResultPulse() {
  const game = state.game;
  const loser = getPlayer(game.pendingRoundResult.loserId);

  game.status = GAME_STATUS.FINAL_RESULT_PULSE;
  game.settlementUntilMs = nowMs() + clampInt(state.settings.rules.finalSettlementDurationMs, 100, 6000);

  if (loser) {
    game.eventPulse = {
      playerId: loser.id,
      untilMs: game.settlementUntilMs,
      bonusPercent: clamp(state.settings.rules.finalSettlementBonusPercent, 0, 60),
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
  speakGameOnce("final-pulse", game.speechText);
  forceRenderSoon();
}

function updateFinalResultPulse() {
  const game = state.game;

  if (game.status !== GAME_STATUS.FINAL_RESULT_PULSE) {
    return;
  }

  if (nowMs() <= Number(game.settlementUntilMs || 0)) {
    return;
  }

  game.eventPulse = null;
  finishGame(game.pendingRoundResult.winnerId, game.pendingRoundResult.reason);
}

function finishGame(winnerId, reason) {
  const game = state.game;
  const winner = getPlayer(winnerId);

  game.status = GAME_STATUS.FINISHED;
  game.winnerId = winnerId;
  game.winnerName = winner ? winner.name : "";
  game.finishedAtMs = nowMs();
  game.reason = reason || (winner ? `${winner.name} の勝利` : "勝敗が決定しました");
  state.phase = PHASE.RESULT;

  safeZero().catch(() => {});
  logLocal(game.reason);
  audioManager.playTone("win", true);
  audioManager.speak(game.reason, true);
  forceRenderSoon();
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

  if (!state || state.phase === PHASE.SAFE_LOCKED || paused) {
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

  if (rules.continuousStim && game.status !== GAME_STATUS.SETTLEMENT_PULSE && game.status !== GAME_STATUS.FINAL_RESULT_PULSE) {
    const period = Math.max(1, Number(rules.continuousOnMs) + Number(rules.continuousOffMs));
    const cycle = nowMs() % period;
    const isOn = cycle < Number(rules.continuousOnMs);

    if (isOn) {
      for (const player of Object.values(state.settings.players)) {
        const charge = getPlayerCharge(player.id);
        const channel = getChannelForPlayer(player.id);

        if (charge > 0.01) {
          outputs[channel] = Math.max(outputs[channel], calculateOutputFromCharge(player.id));
        }
      }
    }
  }

  if (game.eventPulse && nowMs() <= Number(game.eventPulse.untilMs || 0)) {
    const event = game.eventPulse;

    if (event.playerId) {
      const channel = getChannelForPlayer(event.playerId);
      outputs[channel] = Math.max(
        outputs[channel],
        calculateEventOutput(event.playerId, event.bonusPercent, event.minPercent)
      );
    }
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

  updateLiveOutputLabels();

  if (deviceClient && deviceClient.connected) {
    try {
      await deviceClient.sendOutputs(state.outputs.A, state.outputs.B, false);
    } catch (error) {
      console.error(error);
      safeStop("出力送信に失敗しました");
    }
  }
}

function updateLiveOutputLabels() {
  for (const player of Object.values(state.settings.players)) {
    const output = getPlayerOutput(player.id);
    const charge = getPlayerCharge(player.id);

    document.querySelectorAll(`[data-player-output="${CSS.escape(player.id)}"]`).forEach((el) => {
      el.textContent = formatPercent(output);
    });

    document.querySelectorAll(`[data-player-charge="${CSS.escape(player.id)}"]`).forEach((el) => {
      el.textContent = String(Math.round(charge));
    });

    document.querySelectorAll(`[data-output-state="${CSS.escape(player.id)}"]`).forEach((el) => {
      el.textContent = output > 0.01 ? "継続出力 ON" : "継続出力 OFF";
    });
  }

  document.querySelectorAll("[data-output-pill]").forEach((el) => {
    el.textContent = `A ${formatPercent(state.outputs.A)} / B ${formatPercent(state.outputs.B)}`;
  });

  for (const player of Object.values(state.settings.players)) {
    const output = getPlayerOutput(player.id);
    const charge = getPlayerCharge(player.id);

    const outputGauge = document.querySelector(`[data-gauge-key="output-${CSS.escape(player.id)}"]`);
    const miniOutputGauge = document.querySelector(`[data-gauge-key="mini-output-${CSS.escape(player.id)}"]`);
    const chargeGauge = document.querySelector(`[data-gauge-key="charge-${CSS.escape(player.id)}"]`);
    const miniChargeGauge = document.querySelector(`[data-gauge-key="mini-charge-${CSS.escape(player.id)}"]`);

    if (outputGauge) {
      outputGauge.dataset.gaugeValue = String(output);
      outputGauge.style.width = `${output}%`;
    }

    if (miniOutputGauge) {
      miniOutputGauge.dataset.gaugeValue = String(output);
      miniOutputGauge.style.width = `${output}%`;
    }

    if (chargeGauge) {
      chargeGauge.dataset.gaugeValue = String(charge);
      chargeGauge.style.width = `${charge}%`;
    }

    if (miniChargeGauge) {
      miniChargeGauge.dataset.gaugeValue = String(charge);
      miniChargeGauge.style.width = `${charge}%`;
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

  state.outputs.A = 0;
  state.outputs.B = 0;
  activeTestChannel = null;

  if (state.game) {
    state.game.eventPulse = null;
  }

  if (!isAccessGranted()) {
    safeZero().catch(() => {});
    state.phase = PHASE.ACCESS;
    forceRenderSoon();
    return;
  }

  state.phase = PHASE.SAFE_LOCKED;
  updateDeviceStatus(state.device.status, state.device.label, "SAFE_STOP");

  if (audioManager) {
    audioManager.playTone("critical", true);
    audioManager.speak(`安全停止しました。${safeLockReason}`, true);
  }

  safeZero().catch(() => {});
  forceRenderSoon();
}

function returnToAccessScreen() {
  safeLockReason = "";
  activeTestChannel = null;

  if (state) {
    state.phase = PHASE.ACCESS;
    state.outputs.A = 0;
    state.outputs.B = 0;

    if (state.device) {
      state.device.status = "disconnected";
      state.device.label = "未接続";
      state.device.safeState = "DISCONNECTED";
      state.device.simulation = false;
    }
  }

  if (deviceClient) {
    deviceClient.connected = false;
    deviceClient.simulation = false;
  }

  forceRenderSoon();
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

function speakGameOnce(key, text, force = false) {
  if (!text) {
    return;
  }

  if (!force && lastSpeechKey === key) {
    return;
  }

  lastSpeechKey = key;
  audioManager.speak(text, force);
}

function handleClick(event) {
  const actionTarget = event.target.closest("[data-action]");
  const switchTarget = event.target.closest("[data-switch-key]");
  const sessionSwitch = event.target.closest("[data-toggle='sessionDisclaimer']");
  const messageAdvanceTarget = event.target.closest(".message-hold-clickable");

  if (sessionSwitch) {
    sessionSwitch.classList.toggle("on");
    sessionSwitch.dataset.checked = sessionSwitch.classList.contains("on") ? "1" : "0";
    return;
  }

  if (switchTarget) {
    handleSwitch(switchTarget);
    return;
  }

  if (!actionTarget && messageAdvanceTarget) {
    const tagName = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : "";
    if (tagName !== "button" && tagName !== "input" && tagName !== "select") {
      advanceMessageNow();
    }
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

function advanceMessageNow() {
  const game = state.game;

  if (!isMessageAdvanceReady(game) || paused) {
    return;
  }

  game.phaseUntilMs = nowMs() - 1;
  updateDiceDebtStateMachine();
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
      forceRenderSoon();
    } else {
      audioManager.playTone("critical", true);
      showModal("Access Codeが違います", "BOOTH同梱のREADMEに記載されたAccess Codeを入力してください。");
    }
    return;
  }

  if (!isAccessGranted()) {
    await safeZero();
    returnToAccessScreen();
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
    audioManager.speak("安全確認に同意しました。低周波デバイスを接続してください。", true);
    forceRenderSoon();
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

  if (action === "connect-simulation") {
    await connectWithMode("simulation");
    return;
  }

  if (action === "disconnect-device") {
    await safeZero();
    if (deviceClient) {
      await deviceClient.disconnect();
    }
    forceRenderSoon();
    return;
  }

  if (action === "go-channel-test") {
    state.phase = PHASE.CHANNEL_TEST;
    forceRenderSoon();
    return;
  }

  if (action === "go-rule-setup") {
    if (state.phase === PHASE.CHANNEL_TEST && !areChannelsTested()) {
      showModal("テスト未完了", "チャンネルA/Bのテストを完了してください。");
      return;
    }
    await safeZero();
    state.phase = PHASE.RULE_SETUP;
    forceRenderSoon();
    return;
  }

  if (action === "back-channel-test") {
    state.phase = PHASE.CHANNEL_TEST;
    forceRenderSoon();
    return;
  }

  if (action === "mark-channel-tested") {
    const channel = target.dataset.channel;
    state.settings.channels[channel].tested = true;
    saveSettings();
    logLocal(`${state.settings.channels[channel].label} テスト完了`);
    audioManager.playTone("win");
    audioManager.speak(`${state.settings.channels[channel].label}のテストを完了しました。`);
    forceRenderSoon();
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

  if (action === "roll-current") {
    rollCurrentDice();
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

  if (action === "toggle-pause") {
    paused = !paused;
    if (paused) {
      await safeZero();
      logLocal("一時停止");
    } else {
      logLocal("再開");
    }
    forceRenderSoon();
    return;
  }

  if (action === "restart-game") {
    startGame();
    return;
  }

  if (action === "back-rule-setup") {
    await safeZero();
    state.phase = PHASE.RULE_SETUP;
    forceRenderSoon();
    return;
  }

  if (action === "emergency-stop") {
    safeStop("緊急停止ボタンが押されました");
    return;
  }

  if (action === "clear-safe") {
    await safeZero();

    if (!isAccessGranted()) {
      returnToAccessScreen();
      return;
    }

    safeLockReason = "";

    if (deviceClient && deviceClient.simulation) {
      state.device.safeState = "SIMULATION";
    } else if (state.device.status === "connected") {
      state.device.safeState = "CONNECTED";
    } else {
      state.device.safeState = "DISCONNECTED";
    }

    state.phase = deviceClient && deviceClient.connected ? PHASE.CHANNEL_TEST : PHASE.CONNECT;
    forceRenderSoon();
    return;
  }

  if (action === "go-connect") {
    await safeZero();

    if (!isAccessGranted()) {
      returnToAccessScreen();
      return;
    }

    state.phase = PHASE.CONNECT;
    forceRenderSoon();
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
      logLocal("推奨IDの低周波デバイスを検索します");
      await deviceClient.requestPreferred();
    } else if (mode === "manual") {
      await deviceClient.requestManual();
    } else if (mode === "simulation") {
      await deviceClient.connectSimulation();
    }

    audioManager.playTone("win", true);

    if (mode === "simulation") {
      audioManager.speak("低周波デバイスなし確認モードを開始しました。画面と音声のみで確認できます。", true);
    } else {
      audioManager.speak("低周波デバイスに接続しました。チャンネルテストへ進んでください。", true);
    }

    forceRenderSoon();
  } catch (error) {
    updateDeviceStatus("disconnected", "未接続", "DISCONNECTED");
    audioManager.playTone("critical", true);
    showModal("接続できませんでした", error.message || String(error));
    forceRenderSoon();
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
  forceRenderSoon();
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
      player.reading = player.name;
      saveSettings();
      forceRenderSoon();
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
    if (document.visibilityState !== "hidden") {
      return;
    }

    if (!state?.settings?.safety?.visibilityStop) {
      return;
    }

    if (!isAccessGranted()) {
      safeZero().catch(() => {});
      state.phase = PHASE.ACCESS;
      return;
    }

    safeStop("画面が非表示になりました");
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
    const registrations = await navigator.serviceWorker.getRegistrations();

    for (const registration of registrations) {
      await registration.unregister();
    }

    if (window.caches && typeof window.caches.keys === "function") {
      const keys = await window.caches.keys();

      for (const key of keys) {
        await window.caches.delete(key);
      }
    }

    console.info("開発中のためService Workerを解除しました");
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

function startStateMachineLoop() {
  clearInterval(stateMachineTimer);
  stateMachineTimer = setInterval(() => {
    try {
      updateDiceDebtStateMachine();
    } catch (error) {
      console.error(error);
      safeStop("ゲーム進行処理でエラーが発生しました");
    }
  }, 50);
}

function boot() {
  state = makeInitialState();
  deviceClient = new CompatibleDeviceClient();
  audioManager = new AudioManager();

  registerGlobalEvents();
  startOutputLoop();
  startStateMachineLoop();
  registerServiceWorker();

  logLocal(`${PRODUCT_NAME} 起動`);
  render();
}

boot();
