# Dual Version Reconciliation

Objetivo: gerir duas versões do bot sem substituir uma pela outra às cegas.

Na prática, o caso real aqui deve ser tratado como reconciliação de `3 estados`:

- `live-confirmed baseline`
- `github-clean branch`
- `mac-superset`

Refs atuais de alinhamento:

- `liveConfirmed`
  - branch: `codex/repo-sync-cleanup`
  - head: `9653eb0c0e8b5cde836fbaa4449aa8e18b1b1d13`
- `githubClean`
  - branch: `codex/repo-sync-cleanup`
  - head: `f064048f3a83f06617ab9b19554bf2a6d4689910`
- `tuneCommit`
  - head: `cd940aa36d27c028af46d015f14e53422c8f120d`

## Regra Base

- tratar o estado validado em produção como `baseline operacional`
- tratar o outro computador como `candidate superset`
- comparar primeiro
- só depois mergear hotspot por hotspot

## 1. Gerar Manifesto Em Cada Máquina

No repo local:

```bash
cd /Users/joel/Documents/CoddingStuff/TorusAiTrading
node scripts/build-repo-manifest.js \
  --role github-clean \
  --live-confirmed-branch codex/repo-sync-cleanup \
  --live-confirmed-head 9653eb0c0e8b5cde836fbaa4449aa8e18b1b1d13 \
  --github-clean-branch codex/repo-sync-cleanup \
  --github-clean-head f064048f3a83f06617ab9b19554bf2a6d4689910 \
  --tune-head cd940aa36d27c028af46d015f14e53422c8f120d \
  --output runtime/local-repo-manifest.json
```

Neste Mac superset, correr isto para gerar o manifesto dele:

```bash
cd /Users/joel/Documents/CoddingStuff/TorusAiTrading
node scripts/build-repo-manifest.js \
  --role mac-superset \
  --live-confirmed-branch codex/repo-sync-cleanup \
  --live-confirmed-head 9653eb0c0e8b5cde836fbaa4449aa8e18b1b1d13 \
  --github-clean-branch codex/repo-sync-cleanup \
  --github-clean-head f064048f3a83f06617ab9b19554bf2a6d4689910 \
  --tune-head cd940aa36d27c028af46d015f14e53422c8f120d \
  --output runtime/mac-repo-manifest.json
```

Se quiseres incluir um resumo curto dos testes corridos nesse checkout:

```bash
node scripts/build-repo-manifest.js \
  --role mac-superset \
  --live-confirmed-branch codex/repo-sync-cleanup \
  --live-confirmed-head 9653eb0c0e8b5cde836fbaa4449aa8e18b1b1d13 \
  --github-clean-branch codex/repo-sync-cleanup \
  --github-clean-head f064048f3a83f06617ab9b19554bf2a6d4689910 \
  --tune-head cd940aa36d27c028af46d015f14e53422c8f120d \
  --test-command "node --test tests/strategy-enable.test.js tests/load-runtime-config.test.js tests/live-cycle.test.js" \
  --output runtime/mac-repo-manifest.json
```

## 2. Comparar Manifestos

```bash
cd /Users/joel/Documents/CoddingStuff/TorusAiTrading
node scripts/compare-repo-manifests.js \
  runtime/local-repo-manifest.json \
  /path/para/other-repo-manifest.json
```

Isto mostra diferenças em:

- `env`
- `packageMeta`
- `liveUniverse`
- `hotspots`
- `testSummary`
- `baselineRefs`

## 3. Hotspots A Rever Manualmente

Os ficheiros mais sensíveis são:

- `runtime/torus-ai-trading.js`
- `runtime/dashboard-server.js`
- `runtime/config/load-runtime-config.js`
- `runtime/futures-executor.js`
- `runtime/risk-manager.js`
- `runtime/strategy-config.json`
- `runtime/btc-regime-context.js`
- `strategies/index.js`
- `dashboard/app.js`
- `dashboard/index.html`
- `dashboard/styles.css`

## 4. Regras De Decisão

- manter a versão que já provou comportamento correto em produção quando a diferença for só “mais complexidade”
- preferir a versão do outro computador quando trouxer:
  - cobertura de teste
  - pesquisa reproduzível
  - observabilidade melhor
  - isolamento melhor entre core e exploratory
- não reintroduzir:
  - modos paper por acidente
  - universo live mais largo sem justificação
  - alterações locais não rastreadas

## 5. Ordem Recomendada

1. tratar `9653eb0...` como baseline operacional validada
2. tratar `f064048...` como baseline limpa atual do GitHub
3. comparar `github-clean` vs `mac-superset`
3. rever `env`, `packageMeta` e `liveUniverse`
4. rever hotspots de runtime
5. rever dashboard
6. rever research e tooling
7. só depois decidir o merge

## 6. Saída Esperada

No fim da reconciliação, queremos sempre conseguir dizer:

- qual é o `baseline` atual
- o que fica da `live-confirmed baseline`
- o que fica do `GitHub clean`
- o que vem do `Mac`
- o que precisa `merge manual`
- que diferenças vieram do outro computador
- quais foram aceites
- quais foram rejeitadas
- e porquê
