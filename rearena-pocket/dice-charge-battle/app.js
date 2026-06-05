"use strict";

/*
  SHOCKiG REARENA POCKET
  DICE CHARGE BATTLE
  Static Web / PWA / Web Bluetooth Edition

  初期販売版方針:
  - Service Workerなし
  - Socket.IOなし
  - Pythonサーバーなし
  - Web Bluetooth直結
  - 確認モードあり
  - UI内では特定デバイス名を出さず「低周波デバイス」と表記
*/

const VERSION = "20260605-01";
const PRODUCT_FAMILY = "SHOCKiG REARENA POCKET";
const PRODUCT_NAME = "DICE CHARGE BATTLE";
const ACCESS_CODE = "DCB-MFLABO-202606";
const DEVICE_NAME_PREFIX = "ID:47L";

const BLE_SERVICE_UUID = "0000180c-0000-1000-8000-00805f9b34fb";
const BLE_CHAR_UUID = "0000150a-0000-1000-8000-00805f9b34fb";

const STORAGE_KEYS = {
  access: "dcb_access_granted_v1",
  disclaimer: "dcb_disclaimer_accepted_v1",
  settings: "dcb_settings_v1"
};

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

const GAME_STATUS = {
  IDLE: "IDLE",
  WAIT_P1: "WAIT_P1",
  ROLLING_P1: "ROLLING_P1",
  WAIT_P2: "WAIT_P2",
  ROLLING_P2: "ROLLING_P2",
  REVEAL: "REVEAL",
  SETTLEMENT_COUNTDOWN: "SETTLEMENT_COUNTDOWN",
  SETTLEMENT_PULSE: "SETTLEMENT_PULSE",
  ROUND_END: "ROUND_END",
  FINAL_COUNTDOWN: "FINAL_COUNTDOWN",
  FINAL_PULSE: "FINAL_PULSE",
  RESULT: "RESULT"
};

const UI_TIMING = {
  normalMessageHoldMs: 3600,
  stimMessageHoldMs: 4200,
  criticalMessageHoldMs: 4700,
  releaseMessageHoldMs: 5200,
  resultMessageHoldMs: 5200,
  messageIntroMs: 700,
  diceAnimationMs: 720,
  diceAnimationIntervalMs: 55,
  gaugeAnimationMs: 520
};

const DICE_UNICODE = {
  1: "⚀",
  2: "⚁",
  3: "⚂",
  4: "⚃",
  5: "⚄",
  6: "⚅"
};

const DEFAULT_SETTINGS = {
  players: {
    p1: { id: "p1", name: "P1", channel: "A", colorIndex: 1 },
    p2: { id: "p2", name: "P2", channel: "B", colorIndex: 2 }
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
    speechEnabled: true,
    speechRate: 1.0,
    speechPitch: 1.0,
    speechVolume: 1.0
  }
};

const view = document.getElementById("view");
const appShell = document.getElementById("app");
const toastRoot = document.getElementById("toast-root");

const state = {
  phase: PHASE.ACCESS,
  previousPhase: PHASE.ACCESS,
  accessGranted: false,
  disclaimerAccepted: false,
  paused: false,
  safeReason: "",
  device: {
    mode: "none",
    connected: false,
    name: "",
    bluetoothDevice: null,
    server: null,
    characteristic: null,
    sending: false,
    lastSendAt: 0,
    lastPacketKey: ""
  },
  settings: loadSettings(),
  game: null,
  outputs: {
    A: 0,
    B: 0,
    requestedA: 0,
    requestedB: 0,
    testHold: null,
    eventPulse: null,
    lastZeroAt: 0
  },
  ui: {
    screenRotated: false,
    diceAnimation: false,
    rollFaces: { p1: 1, p2: 1 },
    message: "",
    messageTone: "normal",
    lastRenderAt: 0
  },
  timers: {
    render: null,
    dice: null,
    auto: null,
    output: null,
    countdown: null
  },
  audio: {
    ctx: null,
    master: null,
    lastSpeech: "",
    unlocked: false
  },
  log: []
};

boot();

function boot() {
  state.accessGranted = localStorage.getItem(STORAGE_KEYS.access) === "yes";
  state.disclaimerAccepted = localStorage.getItem(STORAGE_KEYS.disclaimer) === "yes";

  if (!state.accessGranted) {
    state.phase = PHASE.ACCESS;
  } else if (!state.disclaimerAccepted) {
    state.phase = PHASE.DISCLAIMER;
  } else {
    state.phase = PHASE.CONNECT;
  }

  bindGlobalSafety();
  startOutputLoop();
  render();
  scrollTopSoon();
  logLocal("起動しました");
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || "null");
    return deepMerge(structuredClone(DEFAULT_SETTINGS), saved || {});
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
}

function deepMerge(base, patch) {
  for (const key of Object.keys(patch || {})) {
    if (patch[key] && typeof patch[key] === "object" && !Array.isArray(patch[key])) {
      if (!base[key]) {
        base[key] = {};
      }
      deepMerge(base[key], patch[key]);
    } else {
      base[key] = patch[key];
    }
  }

  return base;
}

function bindGlobalSafety() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      safeStop("画面が非表示になりました");
    }
  });

  window.addEventListener("pagehide", () => {
    emergencyZeroOnly();
  });

  window.addEventListener("beforeunload", () => {
    emergencyZeroOnly();
  });
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

function nowMs() {
  return Date.now();
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

function logLocal(message) {
  if (!message) {
    return;
  }

  const stamp = new Date().toLocaleTimeString("ja-JP", { hour12: false });
  state.log.unshift(`${stamp} ${message}`);
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

function setPhase(phase) {
  const oldPhase = state.phase;

  state.previousPhase = state.phase;
  state.phase = phase;

  if (phase !== PHASE.PLAYING) {
    state.ui.screenRotated = false;
    applyRotation();
  }

  render();

  if (oldPhase !== phase) {
    scrollTopSoon();
  }
}

function scrollTopSoon() {
  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });

    if (document.scrollingElement) {
      document.scrollingElement.scrollTop = 0;
      document.scrollingElement.scrollLeft = 0;
    }

    if (appShell) {
      appShell.scrollTop = 0;
      appShell.scrollLeft = 0;
    }

    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });

      if (document.scrollingElement) {
        document.scrollingElement.scrollTop = 0;
        document.scrollingElement.scrollLeft = 0;
      }

      if (appShell) {
        appShell.scrollTop = 0;
        appShell.scrollLeft = 0;
      }
    });
  });
}

function setMessage(message, tone = "normal", speech = true) {
  state.ui.message = message;
  state.ui.messageTone = tone;
  logLocal(message);

  if (speech) {
    speak(message);
  }
}

function applyRotation() {
  appShell.classList.toggle("screen-rotated", state.ui.screenRotated && state.phase === PHASE.PLAYING);
}

function render() {
  state.ui.lastRenderAt = nowMs();
  applyRotation();

  if (state.phase === PHASE.ACCESS) {
    return renderAccess();
  }

  if (state.phase === PHASE.DISCLAIMER) {
    return renderDisclaimer();
  }

  if (state.phase === PHASE.CONNECT) {
    return renderConnect();
  }

  if (state.phase === PHASE.CHANNEL_TEST) {
    return renderChannelTest();
  }

  if (state.phase === PHASE.RULE_SETUP) {
    return renderRuleSetup();
  }

  if (state.phase === PHASE.PLAYING) {
    return renderPlaying();
  }

  if (state.phase === PHASE.RESULT) {
    return renderResult();
  }

  if (state.phase === PHASE.SAFE_LOCKED) {
    return renderSafeLocked();
  }

  return renderAccess();
}

function header(title, subtitle = "", options = {}) {
  const rotate = options.rotate === true;
  const menu = options.menu === true;

  return `
    <header class="header">
      <div class="header-main">
        <div class="brand-kicker-mini">${escapeHtml(PRODUCT_FAMILY)}</div>
        <h1 class="header-title">${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="header-sub">${escapeHtml(subtitle)}</p>` : ""}
      </div>

      <div class="header-actions">
        <div class="status-strip">
          <div class="pill">${deviceStatusText()}</div>
          <div class="pill">v${VERSION}</div>
        </div>

        ${
          rotate
            ? `<button class="rotate-fab header-chip" data-action="rotate" aria-label="180度回転">↻</button>`
            : ""
        }

        ${
          menu
            ? `<button class="btn icon ghost" data-action="pause" aria-label="一時停止">⏸</button>`
            : ""
        }
      </div>
    </header>
  `;
}

function deviceStatusText() {
  if (state.device.mode === "simulation") {
    return `<span class="dot connected">●</span>確認モード`;
  }

  if (state.device.connected) {
    return `<span class="dot connected">●</span>低周波デバイス接続`;
  }

  return `<span class="dot disconnected">●</span>未接続`;
}

function renderAccess() {
  view.innerHTML = `
    <section class="hero">
      <div class="hero-card">
        <div class="brand-kicker">${PRODUCT_FAMILY}</div>
        <h1 class="brand-title">DICE<br>CHARGE<br>BATTLE</h1>
        <div class="brand-ja">アクセスコード</div>

        <p class="notice">
          BOOTH購入者向けのAccess Codeを入力してください。<br>
          認証前は安全ロック解除・ゲーム開始・接続画面への遷移はできません。
        </p>

        <div class="form-stack">
          <label class="field-label">Access Code</label>
          <input id="access-code" class="input big-input" autocomplete="off" inputmode="latin" placeholder="DCB-..." />
          <button class="btn primary wide" data-action="check-access">認証して開始</button>
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

        <button class="btn danger wide" data-action="accept-disclaimer">同意して接続へ</button>
      </div>
    </section>
  `;
}

function renderConnect() {
  view.innerHTML = `
    <section class="screen">
      ${header(PRODUCT_NAME, "低周波デバイス接続")}

      <div class="grid two connect-grid">
        <div class="card game-card">
          <h2>接続</h2>
          <p class="muted">Web Bluetoothで低周波デバイスへ直接接続します。HTTPS環境と対応ブラウザが必要です。</p>

          <div class="button-stack">
            <button class="btn primary wide" data-action="connect-known">かんたん接続</button>
            <button class="btn cyan wide" data-action="connect-preferred">推奨IDから探す</button>
            <button class="btn ghost wide" data-action="connect-manual">手動で探す</button>
            <button class="btn danger wide" data-action="disconnect">切断</button>
          </div>
        </div>

        <div class="card game-card">
          <h2>確認モード</h2>
          <p class="muted">実機へBLE送信せず、画面・音・進行・出力ゲージだけ確認できます。</p>
          <button class="btn orange wide" data-action="connect-simulation">低周波デバイスなし確認モード</button>
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
        <p class="muted">テストボタンは押している間だけ出力します。指を離す、キャンセル、画面外へ出ると0%になります。</p>

        <button class="btn primary wide" data-action="go-rule-setup" ${A.tested && B.tested ? "" : "disabled"}>
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
      <h2>${escapeHtml(title)}</h2>

      <div class="form-grid">
        ${rangeInput(`limit-${ch}`, "出力リミット", cfg.limit, 0, 100, 1, "%")}
        ${rangeInput(`test-${ch}`, "テストの強さ", cfg.testPercent, 0, 100, 1, "%")}
        ${rangeInput(`width-${ch}`, "パルス幅", cfg.pulseWidth, 1, 60, 1, "μs")}
        ${rangeInput(`freq-${ch}`, "周波数", cfg.frequency, 1, 200, 1, "Hz")}
      </div>

      <button
        class="btn big ${cfg.tested ? "safe" : "primary"} test-hold"
        data-test-channel="${ch}">
        ${cfg.tested ? "✓ テスト済み" : "押してテスト"}
      </button>

      <div class="mini-meter">
        <div class="mini-meter-fill" style="width:${escapeHtml(state.outputs[ch])}%"></div>
      </div>
    </div>
  `;
}

function rangeInput(id, label, value, min, max, step, unit) {
  return `
    <label class="range-row">
      <span>${escapeHtml(label)}</span>
      <input id="${escapeHtml(id)}" type="range" min="${min}" max="${max}" step="${step}" value="${escapeHtml(value)}" data-range="${escapeHtml(id)}" />
      <b id="${escapeHtml(id)}-value">${escapeHtml(value)}${escapeHtml(unit)}</b>
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
          <label class="field-label">
            P1名前
            <input class="input" id="p1-name" value="${escapeHtml(p.p1.name)}">
          </label>

          <label class="field-label">
            P2名前
            <input class="input" id="p2-name" value="${escapeHtml(p.p2.name)}">
          </label>
        </div>
      </div>

      <div class="card">
        <h2>ルール</h2>

        <div class="form-grid setup-grid">
          ${numberField("rounds", "ラウンド数", r.rounds, 3, 30, 1)}
          ${numberField("chargeMultiplier", "出目差チャージ", r.chargeMultiplier, 1, 20, 1)}
          ${numberField("drawCharge", "あいこチャージ", r.drawCharge, 0, 20, 1)}
          ${checkField("continuousStim", "継続出力", r.continuousStim)}
          ${numberField("continuousOnMs", "継続ON時間ms", r.continuousOnMs, 100, 5000, 100)}
          ${numberField("continuousOffMs", "継続OFF時間ms", r.continuousOffMs, 100, 10000, 100)}
          ${checkField("settlementStim", "精算イベント", r.settlementStim)}
          ${numberField("settlementCountdownMs", "精算カウントms", r.settlementCountdownMs, 0, 10000, 500)}
          ${numberField("settlementBonusPercent", "精算ボーナス%", r.settlementBonusPercent, 0, 50, 1)}
          ${numberField("settlementDurationMs", "精算時間ms", r.settlementDurationMs, 100, 10000, 100)}
          ${numberField("finalSettlementCountdownMs", "最終精算カウントms", r.finalSettlementCountdownMs, 0, 10000, 500)}
          ${numberField("finalSettlementBonusPercent", "最終精算ボーナス%", r.finalSettlementBonusPercent, 0, 50, 1)}
          ${numberField("finalSettlementDurationMs", "最終精算時間ms", r.finalSettlementDurationMs, 100, 15000, 100)}
          ${checkField("soundEnabled", "効果音", audio.soundEnabled, "audio")}
          ${checkField("speechEnabled", "音声読み上げ", audio.speechEnabled, "audio")}
        </div>
      </div>

      <div class="footer-safe">
        <button class="btn ghost" data-action="back-channel-test">A/B設定</button>
        <button class="btn primary" data-action="start-game">ゲーム開始</button>
        <button class="btn danger" data-action="emergency-stop">緊急停止</button>
      </div>
    </section>
  `;
}

function numberField(key, label, value, min, max, step) {
  return `
    <label class="field-label">
      ${escapeHtml(label)}
      <input class="input" type="number" id="rule-${escapeHtml(key)}" value="${escapeHtml(value)}" min="${min}" max="${max}" step="${step}" data-rule="${escapeHtml(key)}">
    </label>
  `;
}

function checkField(key, label, checked, section = "rules") {
  return `
    <label class="check-row setup-check">
      <input type="checkbox" id="${section}-${escapeHtml(key)}" data-check="${escapeHtml(key)}" data-section="${escapeHtml(section)}" ${checked ? "checked" : ""}>
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function renderPlaying() {
  const g = state.game;

  if (!g) {
    setPhase(PHASE.RULE_SETUP);
    return;
  }

  const disabled = !canRoll();

  view.innerHTML = `
    <section class="screen playing-screen">
      ${header("DICE CHARGE BATTLE", g.message || "", { rotate: true, menu: true })}

      <div class="battle-main">
        <div class="desktop-hud play-layout">
          ${renderBattlePlayerCard("p1")}
          ${renderBattlePlayerCard("p2")}
        </div>

        <div class="mobile-hud">
          ${renderMiniHud("p1")}
          ${renderMiniHud("p2")}
        </div>

        <section class="card game-center ${isMessageAdvanceReady() ? "message-hold-clickable" : ""} tone-${escapeHtml(state.ui.messageTone)}" data-action="advance-message">
          <div class="round-label">
            ${renderRoundLabel()}
          </div>

          ${renderMessageBox(state.ui.message || g.message || "", state.ui.messageTone || "normal")}

          ${state.paused ? `<div class="pause-banner">PAUSED：再開するまで進行しません</div>` : ""}

          ${renderPhaseHint()}
          ${renderMessageAdvanceHint()}

          <div class="dice-area">
            ${renderDiceBox("p1")}
            ${renderDiceBox("p2")}
          </div>

          <div class="battle-actions">
            <button class="btn primary big" data-action="roll-dice" ${disabled ? "disabled" : ""}>
              🎲 ふる
            </button>
          </div>
        </section>

        <div class="log-section-desktop">
          ${renderLog()}
        </div>
      </div>

      ${renderGameFooter()}
    </section>
  `;
}

function renderRoundLabel() {
  const g = state.game;

  if (!g) {
    return "";
  }

  if (g.suddenDeath) {
    return `<span class="round-main sudden">SUDDEN DEATH</span>`;
  }

  return `
    <span class="round-main">ROUND ${escapeHtml(g.round)} / ${escapeHtml(g.maxRounds)}</span>
    <span class="round-sub">CHARGE BATTLE</span>
  `;
}

function renderPhaseHint() {
  const g = state.game;

  if (!g) {
    return "";
  }

  let text = "";

  if (g.status === GAME_STATUS.WAIT_P1) {
    text = `${g.players.p1.name} のロール待ち`;
  } else if (g.status === GAME_STATUS.WAIT_P2) {
    text = `${g.players.p2.name} のロール待ち`;
  } else if (g.status === GAME_STATUS.ROLLING_P1 || g.status === GAME_STATUS.ROLLING_P2) {
    text = "ダイスロール中";
  } else if (g.status === GAME_STATUS.REVEAL) {
    text = "結果表示中";
  } else if (g.status === GAME_STATUS.SETTLEMENT_COUNTDOWN) {
    text = "精算カウントダウン";
  } else if (g.status === GAME_STATUS.SETTLEMENT_PULSE) {
    text = "精算出力中";
  } else if (g.status === GAME_STATUS.FINAL_COUNTDOWN) {
    text = "最終精算カウントダウン";
  } else if (g.status === GAME_STATUS.FINAL_PULSE) {
    text = "最終精算出力中";
  } else {
    text = "進行中";
  }

  return `<div class="phase-hint">${escapeHtml(text)}</div>`;
}

function isMessageAdvanceReady() {
  if (!state.game || state.paused) {
    return false;
  }

  return (
    state.game.status === GAME_STATUS.REVEAL ||
    state.game.status === GAME_STATUS.SETTLEMENT_COUNTDOWN ||
    state.game.status === GAME_STATUS.ROUND_END ||
    state.game.status === GAME_STATUS.FINAL_COUNTDOWN
  );
}

function renderMessageAdvanceHint() {
  if (!isMessageAdvanceReady()) {
    return `<div class="message-advance-hint muted-hint">自動進行します</div>`;
  }

  return `<div class="message-advance-hint">タップでスキップ</div>`;
}

function renderGameFooter() {
  return `
    <footer class="game-footer">
      <button class="btn ghost footer-btn" data-action="give-up">ギブアップ</button>
      <button class="btn ghost footer-btn" data-action="pause">${state.paused ? "再開" : "一時停止"}</button>
      <button class="btn danger footer-btn emergency" data-action="emergency-stop">緊急停止</button>
    </footer>
  `;
}

function renderBattlePlayerCard(id) {
  const p = getPlayer(id);
  const out = getPlayerOutput(id);
  const chargeMax = Math.max(100, state.game.players.p1.charge, state.game.players.p2.charge);
  const isActive = state.game.currentRoller === id;
  const isLoser = state.game.lastLoser === id;
  const isWinner = state.game.lastWinner === id;

  return `
    <section class="battle-player-card card player-tone-${p.colorIndex} ${isActive ? "is-active" : ""} ${isLoser ? "is-loser" : ""} ${isWinner ? "is-winner" : ""}">
      <div class="battle-player-top">
        <div>
          <div class="player-id">${p.id.toUpperCase()} / CH ${p.channel}</div>
          <h2 class="battle-player-name">${escapeHtml(p.name)}</h2>
        </div>

        <div class="battle-charge-number">${Math.round(p.charge)}</div>
      </div>

      <div class="battle-gauge-stack">
        ${gauge("Charge", p.charge, chargeMax, "charge")}
        ${gauge("OUT", out, 100, "out")}
      </div>

      <div class="battle-player-meta">
        <span>LIMIT ${escapeHtml(state.settings.channels[p.channel].limit)}%</span>
        <span>DICE ${p.lastRoll || "-"}</span>
      </div>
    </section>
  `;
}

function renderMiniHud(id) {
  const p = getPlayer(id);
  const out = getPlayerOutput(id);

  return `
    <div class="mini-hud player-tone-${p.colorIndex}">
      <b>${escapeHtml(p.name)}</b>
      <span>Charge ${Math.round(p.charge)}</span>
      <span>OUT ${formatPercent(out)}</span>
    </div>
  `;
}

function getPlayer(id) {
  return state.game.players[id];
}

function getPlayerOutput(id) {
  return id === "p1" ? state.outputs.A : state.outputs.B;
}

function gauge(label, value, max, cls) {
  const pct = clamp((Number(value || 0) / Math.max(1, Number(max || 1))) * 100, 0, 100);

  return `
    <div class="gauge-row">
      <div class="gauge-label">
        <span>${escapeHtml(label)}</span>
        <b>${formatPercent(value)}</b>
      </div>

      <div class="bar ${escapeHtml(cls)}">
        <div class="bar-fill" style="width:${pct}%"></div>
      </div>
    </div>
  `;
}

function renderMessageBox(message, tone = "normal") {
  const lines = String(message || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-3);

  while (lines.length < 1) {
    lines.push("");
  }

  return `
    <div class="game-message-box tone-${escapeHtml(tone)}">
      ${lines
        .map((line, index) => {
          const cls = index === 0 ? "" : index === 1 ? "sub" : "detail";
          return `<div class="game-message-line ${cls}">${colorizePlayerNames(line)}</div>`;
        })
        .join("")}
    </div>
  `;
}

function colorizePlayerNames(text) {
  let html = escapeHtml(text);

  if (!state.game) {
    return html;
  }

  const p1Name = escapeHtml(state.game.players.p1.name);
  const p2Name = escapeHtml(state.game.players.p2.name);

  html = html.split(p1Name).join(`<span class="player-name-inline tone-text-1">${p1Name}</span>`);
  html = html.split(p2Name).join(`<span class="player-name-inline tone-text-2">${p2Name}</span>`);

  return html;
}

function renderDiceBox(id) {
  const p = getPlayer(id);
  const face = state.ui.diceAnimation ? state.ui.rollFaces[id] : p.lastRoll || 1;
  const active = state.game.currentRoller === id;

  return `
    <div class="dice-box ${active ? "active" : ""} player-tone-${p.colorIndex}">
      <div class="dice-owner">${escapeHtml(p.name)}</div>
      <div class="dice-face ${state.ui.diceAnimation && active ? "rolling" : ""}">${DICE_UNICODE[face] || "?"}</div>
      <div class="dice-value">${p.lastRoll || "-"}</div>
    </div>
  `;
}

function renderFooterSafe(showGameControls) {
  return `
    <div class="footer-safe">
      ${
        showGameControls
          ? `<button class="btn ghost" data-action="give-up">ギブアップ</button>`
          : `<button class="btn ghost" data-action="back-connect">接続へ</button>`
      }

      ${
        showGameControls
          ? `<button class="btn ghost" data-action="pause">${state.paused ? "再開" : "一時停止"}</button>`
          : `<button class="btn ghost" data-action="zero-output">出力0%</button>`
      }

      <button class="btn danger" data-action="emergency-stop">緊急停止</button>
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
        <p class="result-reason">${escapeHtml(g?.resultReason || "")}</p>

        <div class="grid two">
          <div class="score-card player-tone-1">
            <h2>${escapeHtml(p1.name)}</h2>
            <div class="score-number">${Math.round(p1.charge)}</div>
            <p>Charge</p>
          </div>

          <div class="score-card player-tone-2">
            <h2>${escapeHtml(p2.name)}</h2>
            <div class="score-number">${Math.round(p2.charge)}</div>
            <p>Charge</p>
          </div>
        </div>

        <div class="button-row">
          <button class="btn primary" data-action="rematch">もう一度遊ぶ</button>
          <button class="btn ghost" data-action="result-settings">設定へ戻る</button>
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
        <p class="safe-reason">${escapeHtml(state.safeReason || "安全停止しました")}</p>
        <p class="muted">A/B出力は0%にリセットされました。Access Code未認証の場合は解除できません。</p>

        <div class="button-stack">
          <button class="btn danger wide" data-action="zero-output">出力0%を再送信</button>
          <button class="btn primary wide" data-action="unlock-safe">安全確認して復帰</button>
          <button class="btn ghost wide" data-action="reset-access">Access Codeからやり直す</button>
        </div>
      </div>
    </section>
  `;
}

function renderLog() {
  return `
    <div class="card log-card">
      <h3>LOG</h3>
      <div class="log-box">${state.log.map(escapeHtml).join("<br>") || "ログはまだありません"}</div>
    </div>
  `;
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");

  if (!button) {
    return;
  }

  const action = button.dataset.action;

  await unlockAudio();

  if (action === "check-access") {
    return checkAccess();
  }

  if (action === "accept-disclaimer") {
    return acceptDisclaimer();
  }

  if (action === "connect-known") {
    return connectKnown();
  }

  if (action === "connect-preferred") {
    return connectPreferred();
  }

  if (action === "connect-manual") {
    return connectManual();
  }

  if (action === "connect-simulation") {
    return connectSimulation();
  }

  if (action === "disconnect") {
    return disconnectDevice(true);
  }

  if (action === "go-rule-setup") {
    return setPhase(PHASE.RULE_SETUP);
  }

  if (action === "back-channel-test") {
    return setPhase(PHASE.CHANNEL_TEST);
  }

  if (action === "back-connect") {
    return setPhase(PHASE.CONNECT);
  }

  if (action === "start-game") {
    return startGame();
  }

  if (action === "roll-dice") {
    event.stopPropagation();
    return rollCurrentDice();
  }

  if (action === "advance-message") {
    return advanceMessage();
  }

  if (action === "pause") {
    return togglePause();
  }

  if (action === "give-up") {
    return giveUp();
  }

  if (action === "rotate") {
    return toggleRotate();
  }

  if (action === "emergency-stop") {
    return safeStop("緊急停止ボタンが押されました");
  }

  if (action === "zero-output") {
    return sendZeroRepeated();
  }

  if (action === "unlock-safe") {
    return unlockSafe();
  }

  if (action === "reset-access") {
    return resetAccess();
  }

  if (action === "rematch") {
    return startGame();
  }

  if (action === "result-settings") {
    return setPhase(PHASE.RULE_SETUP);
  }

  return undefined;
});

document.addEventListener("input", (event) => {
  const el = event.target;

  if (el.dataset.range) {
    const [kind, ch] = el.dataset.range.split("-");
    const cfg = state.settings.channels[ch];

    if (!cfg) {
      return;
    }

    if (kind === "limit") {
      cfg.limit = intClamp(el.value, 0, 100);
    }

    if (kind === "test") {
      cfg.testPercent = intClamp(el.value, 0, 100);
    }

    if (kind === "width") {
      cfg.pulseWidth = intClamp(el.value, 1, 60);
    }

    if (kind === "freq") {
      cfg.frequency = intClamp(el.value, 1, 200);
    }

    cfg.tested = false;
    saveSettings();

    const valueEl = document.getElementById(`${el.dataset.range}-value`);

    if (valueEl) {
      valueEl.textContent = el.value + (kind === "freq" ? "Hz" : kind === "width" ? "μs" : "%");
    }
  }

  if (el.dataset.rule) {
    const key = el.dataset.rule;
    const min = Number(el.min);
    const max = Number(el.max);

    state.settings.rules[key] = intClamp(el.value, min, max);
    saveSettings();
  }

  if (el.dataset.check) {
    const section = el.dataset.section || "rules";
    state.settings[section][el.dataset.check] = el.checked;
    saveSettings();
  }

  if (el.id === "p1-name") {
    state.settings.players.p1.name = el.value || "P1";
    saveSettings();
  }

  if (el.id === "p2-name") {
    state.settings.players.p2.name = el.value || "P2";
    saveSettings();
  }
});

document.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("[data-test-channel]");

  if (!button) {
    return;
  }

  event.preventDefault();
  startChannelTest(button.dataset.testChannel);
});

document.addEventListener("pointerup", stopChannelTest);
document.addEventListener("pointercancel", stopChannelTest);

document.addEventListener("pointerleave", (event) => {
  if (event.target.closest?.("[data-test-channel]")) {
    stopChannelTest();
  }
});

function checkAccess() {
  const input = document.getElementById("access-code");
  const code = (input?.value || "").trim();

  if (code !== ACCESS_CODE) {
    toast("Access Codeが違います");
    logLocal("Access Code認証失敗");
    return;
  }

  state.accessGranted = true;
  localStorage.setItem(STORAGE_KEYS.access, "yes");
  logLocal("Access Code認証完了");
  setPhase(state.disclaimerAccepted ? PHASE.CONNECT : PHASE.DISCLAIMER);
}

function acceptDisclaimer() {
  const checked = document.getElementById("disclaimer-check")?.checked;

  if (!checked) {
    toast("同意チェックが必要です");
    return;
  }

  state.disclaimerAccepted = true;
  localStorage.setItem(STORAGE_KEYS.disclaimer, "yes");
  logLocal("Disclaimer同意完了");
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
    const preferred = devices.find((d) => (d.name || "").startsWith(DEVICE_NAME_PREFIX)) || devices[0];

    if (!preferred) {
      toast("過去に許可した低周波デバイスがありません");
      return;
    }

    await attachBluetoothDevice(preferred);
  } catch (error) {
    safeStop(`かんたん接続に失敗しました: ${error.message}`);
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

    await attachBluetoothDevice(device);
  } catch (error) {
    if (String(error.message || "").includes("User cancelled")) {
      return;
    }

    safeStop(`推奨ID接続に失敗しました: ${error.message}`);
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

    await attachBluetoothDevice(device);
  } catch (error) {
    if (String(error.message || "").includes("User cancelled")) {
      return;
    }

    safeStop(`手動接続に失敗しました: ${error.message}`);
  }
}

async function attachBluetoothDevice(device) {
  await disconnectDevice(false);

  state.device.bluetoothDevice = device;
  state.device.name = device.name || "低周波デバイス";

  device.addEventListener("gattserverdisconnected", () => {
    safeStop("低周波デバイスが切断されました");
  });

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(BLE_SERVICE_UUID);
  const characteristic = await service.getCharacteristic(BLE_CHAR_UUID);

  state.device.server = server;
  state.device.characteristic = characteristic;
  state.device.mode = "ble";
  state.device.connected = true;

  logLocal(`低周波デバイス接続: ${state.device.name}`);
  toast("接続しました");
  await sendZeroRepeated();
  setPhase(PHASE.CHANNEL_TEST);
}

function connectSimulation() {
  if (!guardAccess()) {
    return;
  }

  state.device.mode = "simulation";
  state.device.connected = true;
  state.device.name = "低周波デバイスなし確認モード";
  logLocal("確認モードで開始");
  setPhase(PHASE.CHANNEL_TEST);
}

async function disconnectDevice(goConnect) {
  await sendZeroRepeated();

  try {
    if (state.device.bluetoothDevice?.gatt?.connected) {
      state.device.bluetoothDevice.gatt.disconnect();
    }
  } catch {}

  state.device.mode = "none";
  state.device.connected = false;
  state.device.name = "";
  state.device.bluetoothDevice = null;
  state.device.server = null;
  state.device.characteristic = null;

  logLocal("切断しました");

  if (goConnect) {
    setPhase(PHASE.CONNECT);
  }
}

function guardAccess() {
  if (!state.accessGranted) {
    safeStop("Access Code未認証のため停止しました");
    return false;
  }

  return true;
}

function startChannelTest(ch) {
  if (!state.device.connected) {
    toast("先に接続または確認モードを選んでください");
    return;
  }

  const cfg = state.settings.channels[ch];

  state.outputs.testHold = {
    channel: ch,
    percent: clamp(cfg.testPercent, 0, cfg.limit),
    startedAt: nowMs()
  };

  setMessage(`チャンネル${ch} テスト中`, "notice", false);
}

function stopChannelTest() {
  const hold = state.outputs.testHold;

  if (!hold) {
    return;
  }

  state.settings.channels[hold.channel].tested = true;
  saveSettings();

  state.outputs.testHold = null;
  state.outputs.A = 0;
  state.outputs.B = 0;

  sendZeroRepeated();
  render();
}

function startGame() {
  if (!guardAccess()) {
    return;
  }

  const A = state.settings.channels.A;
  const B = state.settings.channels.B;

  if (!state.disclaimerAccepted) {
    setPhase(PHASE.DISCLAIMER);
    return;
  }

  if (!state.device.connected) {
    toast("先に接続または確認モードを選んでください");
    setPhase(PHASE.CONNECT);
    return;
  }

  if (!A.tested || !B.tested) {
    toast("A/B両方のテスト完了が必要です");
    setPhase(PHASE.CHANNEL_TEST);
    return;
  }

  state.paused = false;
  state.outputs.eventPulse = null;
  state.outputs.testHold = null;
  state.ui.screenRotated = false;

  const p1Name = state.settings.players.p1.name || "P1";
  const p2Name = state.settings.players.p2.name || "P2";

  state.game = {
    status: GAME_STATUS.WAIT_P1,
    round: 1,
    maxRounds: intClamp(state.settings.rules.rounds, 3, 30),
    suddenDeath: false,
    currentRoller: "p1",
    message: `${p1Name} のターンです。\nダイスを振ってください。`,
    players: {
      p1: { id: "p1", name: p1Name, channel: "A", colorIndex: 1, charge: 0, lastRoll: null },
      p2: { id: "p2", name: p2Name, channel: "B", colorIndex: 2, charge: 0, lastRoll: null }
    },
    lastLoser: null,
    lastWinner: null,
    resultReason: ""
  };

  setPhase(PHASE.PLAYING);
  setMessage(state.game.message, "normal");
}

function rollCurrentDice() {
  if (!canRoll()) {
    return;
  }

  clearAutoTimer();

  const g = state.game;
  const roller = g.status === GAME_STATUS.WAIT_P1 ? "p1" : "p2";
  const rollingStatus = roller === "p1" ? GAME_STATUS.ROLLING_P1 : GAME_STATUS.ROLLING_P2;

  g.currentRoller = roller;
  g.status = rollingStatus;
  state.ui.diceAnimation = true;

  setMessage(`${g.players[roller].name} がダイスを振った！`, "normal");

  playSound("roll");
  startDiceAnimation(roller);

  setAutoTimer(() => {
    const roll = randomDice();

    g.players[roller].lastRoll = roll;
    state.ui.rollFaces[roller] = roll;
    state.ui.diceAnimation = false;

    playSound("decide");

    if (roller === "p1") {
      g.status = GAME_STATUS.WAIT_P2;
      g.currentRoller = "p2";
      g.message = `${g.players.p1.name} は ${roll}。\n${g.players.p2.name} のターンです。`;
      setMessage(g.message, "normal");
    } else {
      g.status = GAME_STATUS.REVEAL;
      g.currentRoller = null;
      revealRound();
    }

    render();
  }, UI_TIMING.diceAnimationMs);

  render();
}

function randomDice() {
  return Math.floor(Math.random() * state.settings.rules.diceSides) + 1;
}

function startDiceAnimation(roller) {
  clearInterval(state.timers.dice);

  state.timers.dice = setInterval(() => {
    state.ui.rollFaces[roller] = randomDice();
    render();
  }, UI_TIMING.diceAnimationIntervalMs);

  setTimeout(() => {
    clearInterval(state.timers.dice);
    state.timers.dice = null;
  }, UI_TIMING.diceAnimationMs);
}

function revealRound() {
  const g = state.game;
  const r = state.settings.rules;
  const p1Roll = g.players.p1.lastRoll;
  const p2Roll = g.players.p2.lastRoll;
  const diff = Math.abs(p1Roll - p2Roll);

  let message = "";
  let loser = null;
  let winner = null;
  let added = 0;

  if (p1Roll === p2Roll) {
    added = intClamp(r.drawCharge, 0, 1000);
    g.players.p1.charge += added;
    g.players.p2.charge += added;
    message = `あいこ！ ${p1Roll} - ${p2Roll}\n両者にCharge +${added}`;
  } else {
    loser = p1Roll < p2Roll ? "p1" : "p2";
    winner = loser === "p1" ? "p2" : "p1";
    added = diff * intClamp(r.chargeMultiplier, 1, 100);
    g.players[loser].charge += added;
    message = `${g.players[winner].name} の勝ち！ ${p1Roll} - ${p2Roll}\n${g.players[loser].name} にCharge +${added}`;
  }

  g.lastLoser = loser;
  g.lastWinner = winner;
  g.status = GAME_STATUS.REVEAL;
  g.message = message;

  setMessage(message, loser ? "stim" : "normal");
  render();

  setAutoTimer(() => {
    if (r.settlementStim && loser) {
      beginSettlement(loser);
    } else {
      endRound();
    }
  }, getMessageHoldMs(loser ? "stim" : "normal"));
}

function getMessageHoldMs(tone = "normal") {
  if (tone === "critical") {
    return UI_TIMING.criticalMessageHoldMs;
  }

  if (tone === "release") {
    return UI_TIMING.releaseMessageHoldMs;
  }

  if (tone === "result") {
    return UI_TIMING.resultMessageHoldMs;
  }

  if (tone === "stim") {
    return UI_TIMING.stimMessageHoldMs;
  }

  return UI_TIMING.normalMessageHoldMs;
}

function beginSettlement(loser) {
  const g = state.game;
  const ms = intClamp(state.settings.rules.settlementCountdownMs, 0, 10000);

  g.status = GAME_STATUS.SETTLEMENT_COUNTDOWN;
  g.message = `${g.players[loser].name} 精算まで ${Math.ceil(ms / 1000)} 秒`;

  setMessage(g.message, "warning");
  render();

  setAutoTimer(() => {
    startEventPulse(
      g.players[loser].channel,
      state.settings.rules.settlementBonusPercent,
      state.settings.rules.settlementDurationMs,
      "精算"
    );

    g.status = GAME_STATUS.SETTLEMENT_PULSE;
    g.message = `${g.players[loser].name} 精算！`;

    setMessage(g.message, "stim");
    playSound("settlement");
    render();

    setAutoTimer(endRound, intClamp(state.settings.rules.settlementDurationMs, 100, 10000) + 250);
  }, ms);
}

function endRound() {
  const g = state.game;

  g.players.p1.lastRoll = null;
  g.players.p2.lastRoll = null;
  g.lastLoser = null;
  g.lastWinner = null;

  if (!g.suddenDeath && g.round >= g.maxRounds) {
    if (g.players.p1.charge === g.players.p2.charge) {
      g.suddenDeath = true;
      g.round += 1;
      g.status = GAME_STATUS.WAIT_P1;
      g.currentRoller = "p1";
      g.message = `同点！ サドンデスへ。\n${g.players.p1.name} から振ってください。`;

      setMessage(g.message, "warning");
      render();
      return;
    }

    beginFinalSettlement();
    return;
  }

  if (g.suddenDeath && g.players.p1.charge !== g.players.p2.charge) {
    beginFinalSettlement();
    return;
  }

  g.round += 1;
  g.status = GAME_STATUS.WAIT_P1;
  g.currentRoller = "p1";
  g.message = `ROUND ${g.round} 開始。\n${g.players.p1.name} のターンです。`;

  setMessage(g.message, "normal");
  render();
}

function beginFinalSettlement() {
  const g = state.game;
  const loser = g.players.p1.charge > g.players.p2.charge ? "p1" : "p2";
  const winner = loser === "p1" ? "p2" : "p1";
  const ms = intClamp(state.settings.rules.finalSettlementCountdownMs, 0, 10000);

  g.lastLoser = loser;
  g.lastWinner = winner;
  g.status = GAME_STATUS.FINAL_COUNTDOWN;
  g.message = `勝者 ${g.players[winner].name}。\n最終精算まで ${Math.ceil(ms / 1000)} 秒`;

  setMessage(g.message, "warning");
  render();

  setAutoTimer(() => {
    startEventPulse(
      g.players[loser].channel,
      state.settings.rules.finalSettlementBonusPercent,
      state.settings.rules.finalSettlementDurationMs,
      "最終精算"
    );

    g.status = GAME_STATUS.FINAL_PULSE;
    g.message = `${g.players[loser].name} 最終精算！`;

    setMessage(g.message, "critical");
    playSound("settlement");
    render();

    setAutoTimer(showResult, intClamp(state.settings.rules.finalSettlementDurationMs, 100, 15000) + 350);
  }, ms);
}

function showResult() {
  const g = state.game;
  const p1 = g.players.p1;
  const p2 = g.players.p2;

  stopAllOutputLocal();

  state.ui.screenRotated = false;
  applyRotation();

  let winner;
  let loser;

  if (p1.charge < p2.charge) {
    winner = p1;
    loser = p2;
  } else {
    winner = p2;
    loser = p1;
  }

  g.status = GAME_STATUS.RESULT;
  g.resultReason = `${winner.name} の勝利！\n${winner.name}: Charge ${Math.round(winner.charge)} / ${loser.name}: Charge ${Math.round(loser.charge)}`;

  setPhase(PHASE.RESULT);
  setMessage(`${winner.name} の勝利です`, "result");
  playSound("victory");
}

function advanceMessage() {
  if (!state.game || state.paused) {
    return;
  }

  if (
    state.game.status === GAME_STATUS.REVEAL ||
    state.game.status === GAME_STATUS.SETTLEMENT_COUNTDOWN ||
    state.game.status === GAME_STATUS.ROUND_END
  ) {
    clearAutoTimer();

    if (state.game.status === GAME_STATUS.SETTLEMENT_COUNTDOWN && state.game.lastLoser) {
      beginSettlement(state.game.lastLoser);
    } else {
      endRound();
    }
  }

  if (state.game.status === GAME_STATUS.FINAL_COUNTDOWN) {
    clearAutoTimer();
    beginFinalSettlement();
  }
}

function togglePause() {
  state.paused = !state.paused;

  if (state.paused) {
    stopAllOutputLocal();
    setMessage("一時停止しました", "notice");
  } else {
    setMessage("再開しました", "normal");
  }

  render();
}

function giveUp() {
  if (!state.game) {
    return;
  }

  const p1Charge = state.game.players.p1.charge;
  const p2Charge = state.game.players.p2.charge;
  const loser = p1Charge >= p2Charge ? "p1" : "p2";
  const winner = loser === "p1" ? "p2" : "p1";

  state.game.players[loser].charge += 50;
  state.game.resultReason = `${state.game.players[loser].name} がギブアップ。\n${state.game.players[winner].name} の勝利です。`;

  stopAllOutputLocal();
  state.ui.screenRotated = false;
  setPhase(PHASE.RESULT);
}

function toggleRotate() {
  if (state.phase !== PHASE.PLAYING) {
    return;
  }

  state.ui.screenRotated = !state.ui.screenRotated;
  applyRotation();
}

function startEventPulse(channel, bonusPercent, durationMs, reason) {
  state.outputs.eventPulse = {
    channel,
    bonusPercent: clamp(bonusPercent, 0, 100),
    until: nowMs() + intClamp(durationMs, 100, 15000),
    reason
  };
}

function startOutputLoop() {
  clearInterval(state.timers.output);
  state.timers.output = setInterval(updateOutputs, 50);
}

function updateOutputs() {
  let A = 0;
  let B = 0;

  if (state.phase === PHASE.SAFE_LOCKED || state.paused) {
    A = 0;
    B = 0;
  } else if (state.outputs.testHold) {
    const h = state.outputs.testHold;

    if (h.channel === "A") {
      A = h.percent;
    }

    if (h.channel === "B") {
      B = h.percent;
    }
  } else if (state.phase === PHASE.PLAYING && state.game) {
    const r = state.settings.rules;

    if (r.continuousStim) {
      const cycle = intClamp(r.continuousOnMs, 100, 10000) + intClamp(r.continuousOffMs, 100, 10000);
      const on = nowMs() % cycle < intClamp(r.continuousOnMs, 100, 10000);

      if (on) {
        A += chargeToOutput(state.game.players.p1.charge);
        B += chargeToOutput(state.game.players.p2.charge);
      }
    }

    const pulse = state.outputs.eventPulse;

    if (pulse) {
      if (nowMs() <= pulse.until) {
        if (pulse.channel === "A") {
          A += pulse.bonusPercent;
        }

        if (pulse.channel === "B") {
          B += pulse.bonusPercent;
        }
      } else {
        state.outputs.eventPulse = null;
      }
    }
  }

  A = applyChannelLimit("A", A);
  B = applyChannelLimit("B", B);

  state.outputs.requestedA = A;
  state.outputs.requestedB = B;
  state.outputs.A = A;
  state.outputs.B = B;

  sendOutputsThrottled(A, B);

  if (state.phase === PHASE.PLAYING) {
    const t = nowMs();

    if (t - state.ui.lastRenderAt > 130) {
      render();
    }
  }
}

function chargeToOutput(charge) {
  return clamp(Number(charge || 0) * 0.5, 0, 100);
}

function applyChannelLimit(ch, value) {
  const cfg = state.settings.channels[ch];
  const limited = Math.min(clamp(value, 0, 100), clamp(cfg.limit, 0, 100));

  return clamp(limited, 0, 100);
}

async function sendOutputsThrottled(A, B) {
  const t = nowMs();

  if (t - state.device.lastSendAt < 50) {
    return;
  }

  const safeA = clamp(A, 0, 100);
  const safeB = clamp(B, 0, 100);
  const key = `${Math.round(safeA)}:${Math.round(safeB)}`;

  if (key === state.device.lastPacketKey && safeA !== 0 && safeB !== 0) {
    return;
  }

  state.device.lastSendAt = t;
  state.device.lastPacketKey = key;

  await sendOutputPacket(safeA, safeB);
}

async function sendOutputPacket(A, B) {
  A = clamp(A, 0, 100);
  B = clamp(B, 0, 100);

  if (state.device.mode === "simulation") {
    return;
  }

  if (state.device.mode !== "ble") {
    return;
  }

  if (!state.device.characteristic) {
    return;
  }

  if (state.device.sending) {
    return;
  }

  state.device.sending = true;

  try {
    const packet = buildPacket(A, B);
    await state.device.characteristic.writeValueWithoutResponse(packet);
  } catch (error) {
    state.device.sending = false;
    safeStop(`BLE送信エラー: ${error.message}`);
    return;
  }

  state.device.sending = false;
}

function buildPacket(A, B) {
  const pA = intClamp((clamp(A, 0, 100) / 100) * 255, 0, 255);
  const pB = intClamp((clamp(B, 0, 100) / 100) * 255, 0, 255);
  const width = intClamp(Math.max(state.settings.channels.A.pulseWidth, state.settings.channels.B.pulseWidth), 1, 60);
  const freq = intClamp(Math.max(state.settings.channels.A.frequency, state.settings.channels.B.frequency), 1, 200);

  const bytes = [0xB0, 0x0F, pA, pB];

  for (let i = 0; i < 4; i++) {
    bytes.push(width);
  }

  for (let i = 0; i < 4; i++) {
    bytes.push(freq);
  }

  for (let i = 0; i < 4; i++) {
    bytes.push(width);
  }

  for (let i = 0; i < 4; i++) {
    bytes.push(freq);
  }

  return new Uint8Array(bytes);
}

async function sendZeroRepeated() {
  state.outputs.A = 0;
  state.outputs.B = 0;
  state.outputs.requestedA = 0;
  state.outputs.requestedB = 0;
  state.outputs.testHold = null;
  state.outputs.eventPulse = null;

  for (let i = 0; i < 5; i++) {
    await sendOutputPacket(0, 0);
    await sleep(35);
  }

  logLocal("ゼロ出力を送信しました");
  render();
}

function emergencyZeroOnly() {
  state.outputs.A = 0;
  state.outputs.B = 0;
  state.outputs.testHold = null;
  state.outputs.eventPulse = null;

  sendOutputPacket(0, 0);
  sendOutputPacket(0, 0);
  sendOutputPacket(0, 0);
}

async function safeStop(reason) {
  state.safeReason = reason || "安全停止しました";

  stopAllOutputLocal();
  clearAllTimers();
  logLocal(`SAFE STOP: ${state.safeReason}`);
  playSound("warning");

  await sendZeroRepeated();

  if (!state.accessGranted) {
    state.phase = PHASE.ACCESS;
  } else {
    state.phase = PHASE.SAFE_LOCKED;
  }

  state.ui.screenRotated = false;
  applyRotation();
  render();
  scrollTopSoon();
}

function stopAllOutputLocal() {
  state.outputs.A = 0;
  state.outputs.B = 0;
  state.outputs.requestedA = 0;
  state.outputs.requestedB = 0;
  state.outputs.testHold = null;
  state.outputs.eventPulse = null;
}

function clearAllTimers() {
  clearAutoTimer();
  clearInterval(state.timers.dice);
  state.timers.dice = null;
}

function clearAutoTimer() {
  clearTimeout(state.timers.auto);
  state.timers.auto = null;
}

function setAutoTimer(fn, ms) {
  clearAutoTimer();

  state.timers.auto = setTimeout(() => {
    if (state.paused || state.phase === PHASE.SAFE_LOCKED) {
      return;
    }

    fn();
  }, Math.max(0, ms));
}

function unlockSafe() {
  if (!state.accessGranted) {
    state.phase = PHASE.ACCESS;
    render();
    scrollTopSoon();
    return;
  }

  stopAllOutputLocal();

  if (!state.disclaimerAccepted) {
    setPhase(PHASE.DISCLAIMER);
    return;
  }

  setPhase(state.device.connected ? PHASE.CHANNEL_TEST : PHASE.CONNECT);
}

function resetAccess() {
  localStorage.removeItem(STORAGE_KEYS.access);
  localStorage.removeItem(STORAGE_KEYS.disclaimer);

  state.accessGranted = false;
  state.disclaimerAccepted = false;

  stopAllOutputLocal();
  setPhase(PHASE.ACCESS);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    state.audio.master.gain.value = 0.16;
    state.audio.master.connect(state.audio.ctx.destination);
  }

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

    const freqMap = {
      roll: 180,
      decide: 520,
      settlement: 90,
      warning: 70,
      victory: 660
    };

    osc.type = type === "warning" ? "square" : "sawtooth";
    osc.frequency.value = freqMap[type] || 300;

    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);

    osc.connect(gain);
    gain.connect(state.audio.master);

    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch {}
}

function speak(text) {
  if (!state.settings.audio.speechEnabled) {
    return;
  }

  if (!window.speechSynthesis) {
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

    window.speechSynthesis.speak(utter);
  } catch {}
}

function canRoll() {
  if (state.paused || !state.game) {
    return false;
  }

  return state.game.status === GAME_STATUS.WAIT_P1 || state.game.status === GAME_STATUS.WAIT_P2;
}
