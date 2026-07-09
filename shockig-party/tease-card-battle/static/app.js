const socket = io();
let myRole = "spectator";
let latestState = null;
let giveUpActive = false;

const $ = (id) => document.getElementById(id);

function joinRoom() { socket.emit("join_room", { room_id: $("roomId").value, display_name: $("displayName").value }); }
function selectRole(role) { myRole = role; socket.emit("select_role", { role }); $("myRole").textContent = `現在の役割: ${role}`; }
function renderPlayer(p, activeRole) {
  if (!p) return "";
  const active = activeRole === p.player_id ? "active" : "";
  return `<h2>${p.display_name} <span class="mini">${p.player_id.toUpperCase()}</span></h2><div class="bars ${active}"><div class="hp">🟥 HP ${p.hp}/${p.max_hp}</div><div class="tp">🟣 TP ${p.tp}/${p.max_tp}</div><div class="charge">⚡ 帯電 ${p.charge}/${p.max_charge}</div><div>次の攻撃 +${p.next_attack_bonus}</div><div class="lock-badge ${p.locked ? 'on' : ''}">${p.locked ? 'LOCKED' : 'UNLOCKED'}</div><div>${p.connected ? '接続中' : '未接続'} / ${p.ready ? 'READY' : 'NOT READY'}</div></div>`;
}
function renderState(state) {
  latestState = state; updateHeartbeatStatus(true);
  $("phaseLabel").textContent = `Turn ${state.turn_no} / ${state.phase}`;
  $("p1Status").innerHTML = renderPlayer(state.players.p1, state.attacker_id);
  $("p2Status").innerHTML = renderPlayer(state.players.p2, state.attacker_id);
  const roleText = myRole === state.attacker_id ? "攻撃側" : myRole === state.defender_id ? "受け側" : "観戦";
  $("myRole").textContent = `現在の役割: ${myRole} / ${roleText}`;
  $("logArea").innerHTML = (state.logs || []).slice().reverse().map(x => `<div>${escapeHtml(x)}</div>`).join("");
  if (state.last_result) renderReveal(state.last_result);
  if (state.continuous_state) renderContinuous(state.continuous_state);
  renderSafety();
}
function renderReveal(result) {
  $("revealArea").innerHTML = `<div class="reveal-card attack">攻撃: ${result.attack_card.name}</div><div class="reveal-card defense">受け: ${result.defense_card.name}</div><div>ダメージ ${result.hp_damage} / カウンター ${result.counter_damage}</div><div>${(result.logs || []).map(escapeHtml).join('<br>')}</div>`;
}
function renderContinuous(c) { $("continuousArea").className = `continuous ${c.pattern}`; $("continuousArea").textContent = `${c.label} / pattern=${c.pattern} / intensity_hint=${clampOutputPercent(c.intensity_hint)} / target=${c.target}`; }
function renderHand(hand) {
  const locked = latestState && latestState.players[myRole] && latestState.players[myRole].locked;
  const disabled = !canAcceptExternalControl() || locked;
  $("handArea").innerHTML = (hand || []).map(card => `<button class="card ${card.card_type}" ${disabled || !card.playable ? 'disabled' : ''} data-card="${card.card_id}"><strong>${card.name}</strong><span>${card.self_effect}</span><span>${card.opponent_effect}</span><span>条件: ${card.condition}</span><span>反動: ${card.recoil}</span>${card.playable ? '' : `<em>${card.disabled_reason}</em>`}</button>`).join("") || "<p class='muted'>現在選択できるカードはありません。</p>";
  document.querySelectorAll("[data-card]").forEach(btn => btn.addEventListener("click", () => socket.emit("choose_card", { card_id: btn.dataset.card })));
}
function renderSafety() { const ok = canAcceptExternalControl(); $("safetyStatus").textContent = ok ? "UNLOCK" : "LOCK"; $("safetyStatus").className = `lock-badge ${ok ? 'on' : ''}`; }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c])); }

$("joinBtn").onclick = joinRoom;
document.querySelectorAll("[data-role]").forEach(b => b.onclick = () => selectRole(b.dataset.role));
$("readyBtn").onclick = () => socket.emit("player_ready", { ready: true });
$("resetBtn").onclick = () => socket.emit("reset_game", {});
$("consentCheck").onchange = () => { if ($("consentCheck").checked) markConsentAccepted(); renderSafety(); };
$("localTestBtn").onclick = () => { markLocalTestPassed(); renderSafety(); };
$("panicBtn").onclick = () => { forceLocalStop("panic"); socket.emit("panic_stop", { reason: "panic" }); };
$("giveUpBtn").onclick = () => { giveUpActive = !giveUpActive; socket.emit(giveUpActive ? "give_up_start" : "give_up_end", {}); $("giveUpBtn").textContent = giveUpActive ? "Give Up解除" : "Give Up"; };
window.addEventListener("safety-stop", e => { socket.emit("panic_stop", { reason: e.detail.reason }); renderSafety(); });
socket.on("connect", () => { $("connectionStatus").textContent = "接続済み"; joinRoom(); });
socket.on("room_state", renderState); socket.on("game_state", renderState); socket.on("hand_update", p => renderHand(p.hand)); socket.on("reveal_result", renderReveal); socket.on("continuous_state", renderContinuous); socket.on("panic_stop_sync", p => renderContinuous(p.continuous_state)); socket.on("error_message", p => alert(p.message));
