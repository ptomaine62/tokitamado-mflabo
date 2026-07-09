const SAFETY = {
  consentAccepted: false,
  localTestPassed: false,
  panicActive: false,
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
    SAFETY.heartbeatOk &&
    SAFETY.pageVisible
  );
}

function forceLocalStop(reason) {
  SAFETY.panicActive = true;
  const event = new CustomEvent("safety-stop", { detail: { reason: reason || "unknown" } });
  window.dispatchEvent(event);
  return { stopped: true, reason: reason || "unknown", outputPercent: 0 };
}

function markConsentAccepted() {
  SAFETY.consentAccepted = true;
  window.dispatchEvent(new CustomEvent("safety-change", { detail: { type: "consent" } }));
}

function markLocalTestPassed() {
  SAFETY.localTestPassed = true;
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
  if (document.hidden) forceLocalStop("visibilitychange");
});

window.addEventListener("load", () => startSafetyHeartbeatMonitor());
