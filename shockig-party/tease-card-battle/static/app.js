const socket = io();
let myRole = "spectator";
let requestedRole = "spectator";
let latestState = null;
let latestHand = [];
let giveUpActive = false;
let localLogs = [];

const $ = (id) => document.getElementById(id);

const PHASE_HELP = {
  WAITING: "P1/P2の参加とReadyを待っています",
  READY: "両者READY / Start Gameを押してください",
  ATTACK_SELECT: "攻撃カードを選んでください",
  DEFENSE_SELECT: "受けカードを選んでください",
  REVEAL: "カード公開中",
  RESOLVE: "効果処理中",
  COUNTDOWN: "カウントダウン中",
  CONTINUOUS: "継続状態中",
  GAME_OVER: "ゲーム終了",
  PANIC: "Panic / Stop発動。Resetで再開してください"
};

function joinRoom() {
  socket.emit("join_room", { room_id: $("roomId").value, display_name: $("displayName").value });
}

function selectRole(role) {
  requestedRole = role;
  socket.emit("select_role", { role });
  $("assignedRole").textContent = `割り当て確認中: ${role}`;
}

function appendLocalLog(message) {
  const text = `[LOCAL] ${message}`;
  localLogs.push(text);
  if (localLogs.length > 30) localLogs.shift();
  renderLogs();
}

function renderLogs() {
  const serverLogs = latestState && latestState.logs ? latestState.logs : [];
  const combined = serverLogs.concat(localLogs);
  $("logArea").innerHTML = combined.slice().reverse().map((x) => `<div>${escapeHtml(x)}</div>`).join("");
}

function phaseHelpFor(state) {
  if (!state) return PHASE_HELP.WAITING;
  if (state.phase === "WAITING") {
    const p1 = state.players.p1;
    const p2 = state.players.p2;
    if (!p1.connected && !p2.connected) return "P1/P2の参加を待っています";
    if (!p1.connected) return "P1の参加を待っています";
    if (!p2.connected) return "P2の参加を待っています";
    if (!p1.ready) return "P1のReadyを待っています";
    if (!p2.ready) return "P2のReadyを待っています";
  }
  return PHASE_HELP[state.phase] || state.phase;
}

function renderPlayer(p, activeRole) {
  if (!p) return "";
  const active = activeRole === p.player_id ? "active" : "";
  return `
    <h2>${escapeHtml(p.display_name)} <span class="mini">${p.player_id.toUpperCase()}</span></h2>
    <div class="bars ${active}">
      <div class="hp">🟥 HP ${p.hp}/${p.max_hp}</div>
      <div class="tp">🟣 TP ${p.tp}/${p.max_tp}</div>
      <div class="charge">⚡ 帯電 ${p.charge}/${p.max_charge}</div>
      <div>次の攻撃 +${p.next_attack_bonus}</div>
      <div class="lock-badge ${p.locked ? "on" : ""}">${p.locked ? "LOCKED" : "UNLOCKED"}</div>
      <div>${p.connected ? "接続中" : "未接続"} / ${p.ready ? "READY" : "NOT READY"}</div>
    </div>`;
}

function renderState(state) {
  if (!state || !state.players) return;
  latestState = state;
  updateHeartbeatStatus(true);
  $("phaseLabel").textContent = `Turn ${state.turn_no} / ${state.phase}`;
  $("phaseHelp").textContent = phaseHelpFor(state);
  $("p1Status").innerHTML = renderPlayer(state.players.p1, state.attacker_id);
  $("p2Status").innerHTML = renderPlayer(state.players.p2, state.attacker_id);
  const roleText = myRole === state.attacker_id ? "攻撃側" : myRole === state.defender_id ? "受け側" : "観戦";
  $("myRole").textContent = `現在の役割: ${myRole} / ${roleText}`;
  if (state.phase === "PANIC") {
    appendPanicNoticeOnce();
  }
  renderLogs();
  if (state.last_result) renderReveal(state.last_result);
  if (state.continuous_state) renderContinuous(state.continuous_state);
  renderSafety();
  renderHand(latestHand);
}

function appendPanicNoticeOnce() {
  const msg = "Panic / Stop発動中です。Resetで再開してください。";
  if (!localLogs.includes(`[LOCAL] ${msg}`)) appendLocalLog(msg);
}

function renderReveal(result) {
  $("revealArea").innerHTML = `
    <div class="reveal-card attack">攻撃: ${escapeHtml(result.attack_card.name)}</div>
    <div class="reveal-card defense">受け: ${escapeHtml(result.defense_card.name)}</div>
    <div>ダメージ ${result.hp_damage} / カウンター ${result.counter_damage}</div>
    <div>${(result.logs || []).map(escapeHtml).join("<br>")}</div>`;
}

function renderContinuous(c) {
  $("continuousArea").className = `continuous ${c.pattern}`;
  $("continuousArea").textContent = `${c.label} / pattern=${c.pattern} / intensity_hint=${clampOutputPercent(c.intensity_hint)} / target=${c.target}`;
}

function waitingHandMessage() {
  if (!latestState) return "ゲーム開始後にカードが配られます";
  if (latestState.phase === "PANIC") return "Panic / Stop中です。Resetで再開してください";
  if (latestState.phase === "WAITING" || latestState.phase === "READY") return "ゲーム開始後にカードが配られます";
  if (myRole === "spectator") return "観戦者はカード操作できません";
  if (SAFETY.localStopActive) return `LOCAL STOP: ${SAFETY.lastStopReason} / ローカルテストをやり直してください`;
  if (!canAcceptExternalControl()) return "安全LOCK中です。同意チェックとローカルテストを完了してください";
  return "現在選択できるカードはありません。";
}

function renderHand(hand) {
  latestHand = hand || [];
  const phase = latestState ? latestState.phase : "WAITING";
  if (["WAITING", "READY", "PANIC", "GAME_OVER", "COUNTDOWN", "CONTINUOUS", "REVEAL", "RESOLVE"].includes(phase) || myRole === "spectator" || latestHand.length === 0) {
    $("handArea").className = "hand-area waiting-message";
    $("handArea").innerHTML = escapeHtml(waitingHandMessage());
    return;
  }
  const locked = latestState && latestState.players[myRole] && latestState.players[myRole].locked;
  const disabled = !canAcceptExternalControl() || locked;
  $("handArea").className = "hand-area";
  $("handArea").innerHTML = latestHand.map((card) => `
    <button class="card ${card.card_type}" ${disabled || !card.playable ? "disabled" : ""} data-card="${card.card_id}">
      <strong>${escapeHtml(card.name)}</strong>
      <span>${escapeHtml(card.self_effect)}</span>
      <span>${escapeHtml(card.opponent_effect)}</span>
      <span>条件: ${escapeHtml(card.condition)}</span>
      <span>反動: ${escapeHtml(card.recoil)}</span>
      ${card.playable ? "" : `<em>${escapeHtml(card.disabled_reason)}</em>`}
    </button>`).join("");
  document.querySelectorAll("[data-card]").forEach((btn) => {
    btn.addEventListener("click", () => socket.emit("choose_card", { card_id: btn.dataset.card }));
  });
}

function renderSafety() {
  const ok = canAcceptExternalControl();
  $("safetyStatus").textContent = ok ? "UNLOCK" : "LOCK";
  $("safetyStatus").className = `lock-badge ${ok ? "on" : ""}`;
  if (SAFETY.localStopActive) {
    $("localStopStatus").textContent = `LOCAL STOP: ${SAFETY.lastStopReason}`;
    $("localStopStatus").className = "local-stop active";
  } else {
    $("localStopStatus").textContent = "LOCAL STOPなし";
    $("localStopStatus").className = "local-stop";
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
}

$("joinBtn").onclick = joinRoom;
document.querySelectorAll("[data-role]").forEach((b) => { b.onclick = () => selectRole(b.dataset.role); });
$("readyBtn").onclick = () => socket.emit("player_ready", { ready: true });
$("startBtn").onclick = () => socket.emit("start_game", {});
$("skipCountdownBtn").onclick = () => socket.emit("skip_countdown", {});
$("resetBtn").onclick = () => {
  socket.emit("reset_game", {});
  appendLocalLog("Resetしました。安全確認をやり直してください。");
};
$("consentCheck").onchange = () => {
  if ($("consentCheck").checked) markConsentAccepted();
  renderSafety();
  renderHand(latestHand);
};
$("localTestBtn").onclick = () => {
  markLocalTestPassed();
  appendLocalLog("ローカルテスト完了。Local Stopを解除しました。Panic後はページ再読み込みまたは安全確認のやり直しを推奨します。");
  renderSafety();
  renderHand(latestHand);
};
$("panicBtn").onclick = () => {
  forceLocalStop("panic");
};
$("giveUpBtn").onclick = () => {
  giveUpActive = !giveUpActive;
  socket.emit(giveUpActive ? "give_up_start" : "give_up_end", {});
  $("giveUpBtn").textContent = giveUpActive ? "Give Up解除" : "Give Up";
};

window.addEventListener("safety-stop", (e) => {
  const reason = e.detail.reason;
  appendLocalLog(`LOCAL STOP: ${reason}`);
  if (e.detail.roomPanic) {
    socket.emit("panic_stop", { reason });
  }
  renderSafety();
  renderHand(latestHand);
});
window.addEventListener("safety-change", () => {
  renderSafety();
  renderHand(latestHand);
});

socket.on("connect", () => {
  $("connectionStatus").textContent = "接続済み";
  joinRoom();
});
socket.on("server_hello", (payload) => {
  $("connectionStatus").textContent = `接続済み: ${payload.sid}`;
});
socket.on("role_assigned", (payload) => {
  myRole = payload.assigned_role;
  const reason = payload.reason ? ` / ${payload.reason}` : "";
  $("assignedRole").textContent = `割り当て役割: ${payload.assigned_role}（希望: ${payload.requested_role}）${reason}`;
  appendLocalLog(`role assigned: ${payload.assigned_role}${reason}`);
  renderHand(latestHand);
});
socket.on("room_state", renderState);
socket.on("game_state", renderState);
socket.on("hand_update", (payload) => renderHand(payload.hand));
socket.on("reveal_result", renderReveal);
socket.on("countdown_start", (payload) => appendLocalLog(`カウントダウン開始: ${payload.duration_sec}秒`));
socket.on("continuous_state", renderContinuous);
socket.on("panic_stop_sync", (payload) => {
  appendLocalLog(`Room Panic: ${payload.reason}. Resetで再開してください。`);
  renderContinuous(payload.continuous_state);
});
socket.on("give_up_sync", (payload) => appendLocalLog(`${payload.player_id} Give Up: ${payload.active}`));
socket.on("start_game_failed", (payload) => appendLocalLog(payload.message));
socket.on("error_message", (payload) => appendLocalLog(payload.message));
