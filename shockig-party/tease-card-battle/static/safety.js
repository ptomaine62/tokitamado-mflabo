const SAFETY = {
  consentAccepted: false,
  localTestPassed: false,
  panicActive: false,
  localStopActive: false,
  lastStopReason: "",
  maxOutputPercent: 30,
  heartbeatOk: true,
  pageVisible: true
};

let safetyHeartbeatTimer = null;
let lastHeartbeatAt = Date.now();

function clampNumber(value, low, high) {
  const n = Number(value);
  if (!Number.isFinite(n)) return low;
  return Math.max(low, Math.min(high, n));
}

function clampOutputPercent(value) {
  SAFETY.maxOutputPercent = clampNumber(SAFETY.maxOutputPercent, 0, 100);
  return clampNumber(value, 0, SAFETY.maxOutputPercent);
}

function canAcceptExternalControl() {
  return Boolean(
    SAFETY.consentAccepted &&
    SAFETY.localTestPassed &&
    !SAFETY.panicActive &&
    !SAFETY.localStopActive &&
    SAFETY.heartbeatOk &&
    SAFETY.pageVisible
  );
}

function forceLocalStop(reason) {
  const stopReason = reason || "unknown";
  const roomPanic = stopReason === "panic";
  if (roomPanic) {
    SAFETY.panicActive = true;
  }
  SAFETY.localStopActive = true;
  SAFETY.lastStopReason = stopReason;
  const event = new CustomEvent("safety-stop", { detail: { reason: stopReason, roomPanic } });
  window.dispatchEvent(event);
  window.dispatchEvent(new CustomEvent("safety-change", { detail: { type: "local_stop", reason: stopReason, roomPanic } }));
  return { stopped: true, reason: stopReason, roomPanic, outputPercent: 0 };
}

function clearLocalStop() {
  if (!SAFETY.panicActive) {
    SAFETY.localStopActive = false;
    SAFETY.lastStopReason = "";
    SAFETY.heartbeatOk = true;
    lastHeartbeatAt = Date.now();
    window.dispatchEvent(new CustomEvent("safety-change", { detail: { type: "clear_local_stop" } }));
  }
}

function markConsentAccepted() {
  SAFETY.consentAccepted = true;
  window.dispatchEvent(new CustomEvent("safety-change", { detail: { type: "consent" } }));
}

function markLocalTestPassed() {
  SAFETY.localTestPassed = true;
  clearLocalStop();
  window.dispatchEvent(new CustomEvent("safety-change", { detail: { type: "local_test" } }));
}

function updateHeartbeatStatus(ok) {
  SAFETY.heartbeatOk = Boolean(ok);
  if (ok) {
    lastHeartbeatAt = Date.now();
  } else {
    forceLocalStop("heartbeat_timeout");
  }
  window.dispatchEvent(new CustomEvent("safety-change", { detail: { type: "heartbeat", ok: SAFETY.heartbeatOk } }));
}

function startSafetyHeartbeatMonitor(timeoutMs = 15000) {
  if (safetyHeartbeatTimer) window.clearInterval(safetyHeartbeatTimer);
  safetyHeartbeatTimer = window.setInterval(() => {
    if (Date.now() - lastHeartbeatAt > timeoutMs) updateHeartbeatStatus(false);
  }, 1000);
}

document.addEventListener("visibilitychange", () => {
  SAFETY.pageVisible = !document.hidden;
  if (document.hidden) {
    forceLocalStop("visibilitychange");
  } else {
    window.dispatchEvent(new CustomEvent("safety-change", { detail: { type: "visible_again" } }));
  }
});

window.addEventListener("load", () => startSafetyHeartbeatMonitor());
