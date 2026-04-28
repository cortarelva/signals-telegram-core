# Mac Superset Sync Notes

Data: 2026-04-28

## Hotspots alterados

- `runtime/torus-ai-trading.js`
- `runtime/dashboard-server.js`
- `runtime/config/load-runtime-config.js`
- `runtime/btc-regime-context.js`
- `runtime/btc-context-gate.js`
- `research/mine-opportunity-events.js`
- `research/analyze-btc-factor-context.js`
- `research/compare-btc-gated-breakdown.js`
- `research/monte-carlo-trade-list.js`
- `research/build-promotion-gate-report.js`
- `research/run-tradfi-promotion-gates.js`
- `scripts/build-repo-manifest.js`
- `scripts/compare-repo-manifests.js`
- `package.json`

## Testes corridos

### Syntax / checks

- `node --check scripts/build-repo-manifest.js`
- `node --check scripts/compare-repo-manifests.js`
- `node --check runtime/torus-ai-trading.js`
- `node --check runtime/dashboard-server.js`
- `node --check runtime/btc-regime-context.js`
- `node --check runtime/btc-context-gate.js`
- `node --check runtime/config/load-runtime-config.js`
- `node --check research/analyze-btc-factor-context.js`
- `node --check research/compare-btc-gated-breakdown.js`
- `node --check research/monte-carlo-trade-list.js`
- `node --check research/build-promotion-gate-report.js`
- `node --check research/run-tradfi-promotion-gates.js`
- `node --check research/mine-opportunity-events.js`

### Node test

- `node --test tests/load-runtime-config.test.js tests/analyze-btc-factor-context.test.js tests/btc-context-gate.test.js tests/btc-regime-context.test.js tests/build-promotion-gate-report.test.js tests/compare-btc-gated-breakdown.test.js tests/monte-carlo-trade-list.test.js tests/run-tradfi-promotion-gates.test.js tests/mine-opportunity-events.test.js`

## Resultado

- bateria focada verde: `38/38` testes a passar
- manifesto do Mac gerado em `runtime/mac-repo-manifest.json`
- sem merge
- sem deploy
