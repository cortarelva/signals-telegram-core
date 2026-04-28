const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeGateStates,
  passesBtcContextGate,
} = require("../runtime/btc-context-gate");

test("normalizeGateStates keeps unique non-empty values", () => {
  assert.deepEqual(
    normalizeGateStates(["risk_off_selloff", " risk_off_selloff ", "", "mixed"]),
    ["risk_off_selloff", "mixed"]
  );

  assert.deepEqual(
    normalizeGateStates("risk_off_selloff, mixed, risk_off_selloff"),
    ["risk_off_selloff", "mixed"]
  );
});

test("passesBtcContextGate enforces bearish BTC breadth and follow-through", () => {
  assert.deepEqual(
    passesBtcContextGate({
      state: "risk_off_selloff",
      btc: { direction: "down" },
      alts: { negativeBreadth: 0.8, followRate: 0.75 },
    }),
    { allowed: true, reason: "btc_gate:passed" }
  );

  assert.equal(
    passesBtcContextGate({
      state: "mixed",
      btc: { direction: "down" },
      alts: { negativeBreadth: 0.8, followRate: 0.75 },
    }).allowed,
    false
  );

  assert.equal(
    passesBtcContextGate({
      state: "risk_off_selloff",
      btc: { direction: "flat" },
      alts: { negativeBreadth: 0.8, followRate: 0.75 },
    }).reason,
    "btc_gate:btc_direction_flat"
  );

  assert.equal(
    passesBtcContextGate({
      state: "risk_off_selloff",
      btc: { direction: "down" },
      alts: { negativeBreadth: 0.4, followRate: 0.75 },
    }).reason,
    "btc_gate:negative_breadth_too_low"
  );
});
