const socket = io();
const $ = (id) => document.getElementById(id);

const PHASE_HELP = {
  WAITING: "P1/P2待機中",
  READY: "両者READY / Start待ち",
  ATTACK_SELECT: "攻撃カード選択中",
  DEFENSE_SELECT: "受けカード選択中",
  REVEAL: "カード公開中",
  RESOLVE: "効果処理中",
  COUNTDOWN: "カウントダウン中",
  CONTINUOUS: "継続状態中",
  GAME_OVER: "ゲーム終了",
  PANIC: "Panic / Stop発動中。Reset待ち"
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
}

function joinRoom() {
  socket.emit("join_room", { room_id: $("roomId").value, display_name: $("displayName").value });
  socket.emit("select_role", { role: "spectator" });
}

function renderPlayer(p, activeRole, defenderRole) {
  const role = activeRole === p.player_id ? "攻撃側" : defenderRole === p.player_id ? "受け側" : "待機";
  return `
    <h2>${escapeHtml(p.display_name)} <span>${role}</span></h2>
    <div class="mega hp">🟥 ${p.hp}/${p.max_hp}</div>
    <div class="mega tp">🟣 ${p.tp}/${p.max_tp}</div>
    <div class="mega charge">⚡ ${p.charge}/${p.max_charge}</div>
    <div>次の攻撃 +${p.next_attack_bonus}</div>
    <div class="lock-badge ${p.locked ? "on" : ""}">${p.locked ? "LOCKED" : "UNLOCKED"}</div>
    <div>${p.ready ? "READY" : "NOT READY"} / ${p.connected ? "ONLINE" : "OFFLINE"}</div>`;
}

function phaseHelpFor(state) {
  if (!state) return PHASE_HELP.WAITING;
  if (state.phase === "WAITING") {
    if (!state.players.p1.connected || !state.players.p2.connected) return "P1/P2待機中";
    return "Ready待ち";
  }
  return PHASE_HELP[state.phase] || state.phase;
}

function renderState(state) {
  if (!state || !state.players) return;
  $("phaseLabel").textContent = `Turn ${state.turn_no} / ${state.phase}`;
  $("phaseHelp").textContent = phaseHelpFor(state);
  $("p1Status").innerHTML = renderPlayer(state.players.p1, state.attacker_id, state.defender_id);
  $("p2Status").innerHTML = renderPlayer(state.players.p2, state.attacker_id, state.defender_id);
  $("lockStatus").innerHTML = `P1 ${state.players.p1.locked ? "LOCK" : "OPEN"} / P2 ${state.players.p2.locked ? "LOCK" : "OPEN"} / GiveUp P1:${state.give_up.p1} P2:${state.give_up.p2} / Panic:${state.panic_reason || "none"}`;
  $("logArea").innerHTML = (state.logs || []).slice().reverse().map((x) => `<div>${escapeHtml(x)}</div>`).join("");
  if (state.last_result) renderReveal(state.last_result);
  if (state.continuous_state) renderContinuous(state.continuous_state);
}

function renderReveal(result) {
  $("revealArea").innerHTML = `
    <div class="reveal-card attack">攻撃: ${escapeHtml(result.attack_card.name)}</div>
    <div class="reveal-card defense">受け: ${escapeHtml(result.defense_card.name)}</div>
    <div>HPダメージ ${result.hp_damage} / カウンター ${result.counter_damage}</div>`;
}

function renderContinuous(c) {
  $("continuousArea").className = `continuous ${c.pattern}`;
  $("continuousArea").textContent = `${c.label} / ${c.pattern} / intensity_hint=${c.intensity_hint} / target=${c.target}`;
}

$("joinBtn").onclick = joinRoom;
socket.on("connect", () => {
  $("connectionStatus").textContent = "接続済み";
  joinRoom();
});
socket.on("server_hello", (payload) => {
  $("connectionStatus").textContent = `接続済み: ${payload.sid}`;
});
socket.on("role_assigned", () => {});
socket.on("room_state", renderState);
socket.on("game_state", renderState);
socket.on("reveal_result", renderReveal);
socket.on("countdown_start", () => {});
socket.on("continuous_state", renderContinuous);
socket.on("panic_stop_sync", (payload) => renderContinuous(payload.continuous_state));
