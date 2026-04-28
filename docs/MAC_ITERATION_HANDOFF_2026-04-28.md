# Handoff Para A Iteracao do Mac

Data: 2026-04-28
Objetivo: por a iteracao do Mac a par do estado real de GitHub, servidor e direcao arquitetural, para que o merge do codigo mais avancado seja feito contra a base certa e sem perder o que ja ficou operacional.

## 1. Resumo Executivo

- O repositorio de referencia e `cortarelva/TorusAiTrading`.
- O branch de trabalho que concentrou a sync util e `codex/repo-sync-cleanup`.
- O head atual desse branch, ja sincronizado no GitHub, e `cd940aa36d27c028af46d015f14e53422c8f120d`.
- O PR correspondente e o draft PR #1:
  - [PR #1](https://github.com/cortarelva/TorusAiTrading/pull/1)
- O ultimo estado live confirmado no servidor continua a ser `9653eb0c0e8b5cde836fbaa4449aa8e18b1b1d13`.
- O tune novo para `ADAUSDC` ja ficou no GitHub, mas o deploy para producao ficou pendente porque o acesso SSH ao servidor passou a devolver timeout em `46.62.151.48:22`.
- A analise mais recente mostrou que o lane principal nao deve ser simplesmente afrouxado; em geral, relaxar filtros piorou o equilibrio entre frequencia e qualidade.
- O proximo grande passo deve ser:
  - mergear o codigo mais avancado do Mac sobre esta base limpa e alinhada
  - preparar a migracao da persistencia para uma base de dados central, idealmente PostgreSQL
- O `torus-pr1-snapshot` deste workspace contem uma linha mais avancada de codigo, mas nao deve ser confundido com a verdade live que estava validada no servidor.
- A afinacao mais recente em estudo e uma relaxacao estreita de `cipherContinuationLong:macd_not_reaccelerating` apenas para `ADAUSDC`, nunca uma abertura geral do gate.

## 2. Estado Atual: GitHub, Servidor e Live

### GitHub

- Repositorio: `cortarelva/TorusAiTrading`
- Branch principal de trabalho: `codex/repo-sync-cleanup`
- Commit de referencia atual:
  - `cd940aa36d27c028af46d015f14e53422c8f120d`
- O commit `9653eb0c0e8b5cde836fbaa4449aa8e18b1b1d13` continua a ser a ultima reconciliacao live testada e puxada para o servidor.
- O commit `cd940aa36d27c028af46d015f14e53422c8f120d` acrescenta a afinacao estreita de `macd_not_reaccelerating` para `ADAUSDC`, o teste novo, e este handoff revisto.

### Servidor

- Host live: `46.62.151.48`
- Repo live: `/opt/TorusAiTrading`
- Repo staging limpo usado para reconciliacao:
  - `/opt/TorusAiTrading-updated-963c259`

### Live em producao

Ultimo estado live confirmado no servidor:

- path live: `/opt/TorusAiTrading`
- branch live: `codex/repo-sync-cleanup`
- HEAD live:
  - `9653eb0c0e8b5cde836fbaa4449aa8e18b1b1d13`
- `git status --short` no live estava limpo
- O branch no GitHub esta agora um commit a frente, em `cd940aa36d27c028af46d015f14e53422c8f120d`.
- O cutover desse ultimo commit ficou pendente por indisponibilidade de SSH durante esta iteracao.

### Servicos validados

- bot:
  - service: `torus-ai-trading-bot.service`
  - estado: `active`
  - arranque confirmado: `2026-04-28 14:42:33 UTC`
- dashboard:
  - service: `torus-ai-trading-dashboard.service`
  - estado: `active`
  - arranque confirmado: `2026-04-28 15:02:00 UTC`

### Verificacao funcional que passou

- `http://127.0.0.1:3002/` respondeu com HTML
- `app.js` e `styles.css` estavam a ser servidos
- `/api/state` respondeu corretamente
- estado observado nessa verificacao:
  - `executionMode=binance_real`
  - `botStatus.running=true`
  - `openExecutions=0`
  - `openSignals=0`
  - `closedSignals=293`
  - `executions=293`
  - `btcContextState=mixed`

Observacao importante:
- o dashboard teve de ser reiniciado separadamente depois do cutover
- o bot loop ja estava a usar o novo checkout, mas o dashboard ainda estava a servir codigo antigo em memoria

### Nota operacional sobre observabilidade

- `journalctl` ajuda a ver arranques, paragens e falhas de servico
- a telemetria util da app vive sobretudo em JSON e SQLite
- fontes atuais mais relevantes no live:
  - `runtime/state.json`
  - `runtime/orders-log.json`
  - `runtime/execution-metrics.json`
  - `runtime/performance-baseline.json`
  - `runtime/runtime-store.sqlite`

### Nota operacional sobre acesso

- foi bootstrapado acesso por chave SSH ao servidor para facilitar trabalho futuro
- tambem foi configurado acesso de escrita ao GitHub para a sync final do branch
- por seguranca, a password de `root` usada durante o bootstrap deve ser rodada

## 3. O Que Foi Feito Nesta Iteracao

### 3.1. Primeiro diagnostico

- O `main` antigo do repo nao era a melhor representacao do que deveria estar em producao.
- O branch `codex/repo-sync-cleanup` continha a sync grande de codigo e era o candidato real a estado live.
- O servidor, porem, estava a correr um estado hibrido:
  - checkout atrasado em relacao ao GitHub
  - alteracoes locais por cima
  - branch dirty

### 3.2. Reconciliacao com o GitHub

Foi sincronizado para o GitHub o estado live testado que faltava subir. Os ficheiros importantes que entraram nessa reconciliacao foram:

- `runtime/config/load-runtime-config.js`
- `runtime/btc-regime-context.js`
- `dashboard/index.html`
- `dashboard/styles.css`
- `dashboard/app.js`
- `runtime/dashboard-server.js`
- `runtime/torus-ai-trading.js`

Artefacto local do patch final:

- [final-server-sync-9653eb0.patch](C:\Users\joborocha\Documents\Codex\2026-04-28\procura-instancias-tuas-a-correr-em\final-server-sync-9653eb0.patch)

### 3.3. Cutover limpo no servidor

O live foi depois alinhado com o branch limpo, preservando estado operacional.

Ficheiros preservados durante o cutover:

- `.env`
- `runtime/state.json`
- `runtime/orders-log.json`
- `runtime/execution-metrics.json`
- `runtime/performance-baseline.json`
- `runtime/runtime-store.sqlite`
- `runtime/runtime-store.sqlite-shm`
- `runtime/runtime-store.sqlite-wal`

Tambem foi necessario reparar o `.git` do checkout live, porque uma copia anterior vinha de um worktree e o ponteiro `.git` deixava de ser valido depois da movimentacao.

## 4. Backups Criados

Backups principais criados antes do alinhamento live:

- `/opt/TorusAiTrading-live-backup-20260428-144031`
- `/opt/TorusAiTrading-state-backup-20260428-144031`

Estes sao os backups que devem ser tratados como referencia de rollback imediato.

## 5. Analise de Estrategias Feita Hoje

### Artefactos da analise

- [balance-equilibrium-analysis.js](C:\Users\joborocha\Documents\Codex\2026-04-28\procura-instancias-tuas-a-correr-em\balance-equilibrium-analysis.js)
- [balance-equilibrium-report-live.json](C:\Users\joborocha\Documents\Codex\2026-04-28\procura-instancias-tuas-a-correr-em\balance-equilibrium-report-live.json)

Esta analise foi corrida contra o checkout live do servidor, nao apenas contra um snapshot local.

### Universo analisado

Runs ativas consideradas:

- `ETHUSDC` `1h` `cipherContinuationShort`
- `ADAUSDC` `5m` `cipherContinuationLong`
- `LINKUSDC` `5m` `cipherContinuationLong`
- `1000SHIBUSDC` `15m` `cipherContinuationShort`

Custos considerados:

- `feeRate=0.0004`
- `slippagePct=0.0001`
- custo round-trip total aproximado:
  - `0.10%`

### Cenarios comparados

- `baseline`
- `pullback_plus`
- `adx_minus4`
- `score_minus5`
- `balanced_combo`
- `loose_rr`

### Conclusao principal

O lane principal atual nao deve ser afrouxado de forma geral.

O que os numeros mostraram:

- `baseline` foi o melhor equilibrio global
- baixar `minScore` nao teve efeito util
- baixar `earlyEntryMinAdx` nao teve efeito util
- alargar a zona de `pullback` piorou o equilibrio
- alguns cenarios relaxados ate reduziram o numero de trades, porque entraram cedo demais e bloquearam setups melhores que vinham depois

### Recomendacao operacional de estrategia

Manter como lane principal:

- `ETHUSDC`
- `ADAUSDC`
- `LINKUSDC`

Tratar com cuidado:

- `1000SHIBUSDC short`

Leitura sobre `1000SHIBUSDC short`:

- nao parece um problema de "esta demasiado apertado"
- parece antes uma lane fraca neste regime
- melhor candidata a:
  - sair do lane principal
  - ou ir para lane `exploratory` / `observe`

### Numeros agregados mais importantes

- `baseline`
  - `39` trades
  - `netPnl +7.9297`
  - `avgNetPerTrade 0.2033`
  - `3/4` runs passam o gate de equilibrio
- `pullback_plus`
  - `22` trades
  - `netPnl +2.1544`
  - `avgNetPerTrade 0.0979`
  - `0` runs a passar
- `adx_minus4`
  - igual ao baseline
- `score_minus5`
  - igual ao baseline
- `balanced_combo`
  - `5` trades
  - `netPnl -2.1724`
  - `avgNetPerTrade -0.4345`
  - `0` runs a passar
- `loose_rr`
  - `9` trades
  - `netPnl +1.2805`
  - `avgNetPerTrade 0.1423`
  - `0` runs a passar

### Highlights baseline por simbolo

- `ETHUSDC 1h short`
  - `6` trades
  - `66.67%` winrate
  - `PF 2.406`
  - `avgNetPnlPct +0.7348`
- `ADAUSDC 5m long`
  - `18` trades
  - `77.78%` winrate
  - `PF 1.759`
  - `avgNetPnlPct +0.1119`
- `LINKUSDC 5m long`
  - `9` trades
  - `88.89%` winrate
  - `PF 5.108`
  - `avgNetPnlPct +0.2759`
- `1000SHIBUSDC 15m short`
  - `6` trades
  - `50%` winrate
  - `PF 0.642`
  - `avgNetPnlPct -0.1626`

### Update tardio: analise do gate `macd_not_reaccelerating`

Depois da analise de equilibrio geral, foi feita uma auditoria mais fina sobre os sinais bloqueados da lane principal usando:

- `server-live-state-2026-04-28.json`
- `server-live-strategy-config-2026-04-28.json`
- `today-signal-audit.js`
- `today-signal-audit-details-2026-04-28.json`

Observacao metodologica importante:

- a auditoria parte do estado live capturado do servidor
- mas o `torus-pr1-snapshot` local inclui codigo mais avancado do que o branch/live efetivamente validados
- por isso, qualquer tune novo deve ser aplicado sobre a base live/branch estrita, nao sobre o snapshot avancado

#### Resultado do filtro na lane principal

Dentro dos bloqueados `EXECUTABLE` resolvidos da lane principal, o filtro `cipherContinuationLong:macd_not_reaccelerating` apanhou:

- `49` casos no total
- `ADAUSDC`: `28`
  - `17` `tp_before_sl`
  - `6` `sl_before_tp`
  - `3` `timeout_negative`
  - `1` `timeout_positive`
  - `1` `timeout_flat`
- `LINKUSDC`: `21`
  - `4` `tp_before_sl`
  - `12` `sl_before_tp`
  - `4` `timeout_negative`
  - `1` `timeout_flat`

Leitura:

- `ADAUSDC` tem falsos negativos reais neste gate
- `LINKUSDC` nao justifica uma abertura equivalente
- portanto, qualquer relaxacao aqui deve ser:
  - simbolo-especifica
  - estreita
  - e rastreavel nos logs

#### Tune recomendado

O tune preparado para esta iteracao e:

- novo caminho `selected_premacd_structure` em `strategies/cipher-continuation-long-strategy.js`
- ativo apenas em `ADAUSDC` dentro de `runtime/strategy-config.json`
- com requisitos cumulativos de estrutura:
  - `bullishBias`
  - `aboveEma50`
  - `bullishStack`
  - `pullbackTouchesEma20`
  - `pullbackNearBbBasis`
  - `pullbackStaysAboveEma50`
  - `extensionAtr <= 0.1`
  - `signalVolRatio <= 0.9`
  - `rsi >= 49`
  - `adx >= 8`
  - `plannedRr >= 0.6`

Na amostra de hoje, este recorte teria selecionado:

- `3` sinais `ADAUSDC`
- `3/3` com `tp_before_sl`
- soma de `planned R = 2.9277`
- soma de `labelRealizedPnlPct = +0.6702%`

Artefactos tecnicos preparados para este tune:

- `strategies/cipher-continuation-long-strategy.js`
- `runtime/strategy-config.json`
- `tests/cipher-continuation-long-premacd-override.test.js`

Nota de estado:

- este tune deve ser tratado como uma afinacao incremental da base live estrita
- nao implica adotar em bloco os caminhos `early` do snapshot mais avancado

## 6. Onde a Iteracao do Mac Deve Entrar

Premissa importante:

- a iteracao do Mac parece conter mais codigo e deve ser tratada como candidata a superset
- mas nao deve substituir cegamente esta base
- deve mergear contra o estado que ja esta:
  - no GitHub
  - em producao
  - e validado pela analise de equilibrio

Em termos praticos, a iteracao do Mac deve assumir como base minima:

- repo: `cortarelva/TorusAiTrading`
- branch: `codex/repo-sync-cleanup`
- head: `9653eb0c0e8b5cde836fbaa4449aa8e18b1b1d13`

## 7. Prioridades de Merge Para a Iteracao do Mac

### 7.1. Objetivo do merge

Trazer o codigo mais avancado do Mac para cima desta base sem perder:

- o alinhamento live-server-GitHub
- a limpeza do checkout
- a validacao operacional ja feita
- as conclusoes da analise sobre os lanes principais

### 7.2. Hotspots de conflito provavel

Estes sao os pontos onde o merge provavelmente vai exigir analise manual:

- `runtime/torus-ai-trading.js`
- `runtime/dashboard-server.js`
- `dashboard/app.js`
- `runtime/config/load-runtime-config.js`
- `runtime/futures-executor.js`
- `runtime/strategy-config.json`
- `strategies/index.js`
- qualquer nova camada de persistencia / repositorio / data-access abstractions

### 7.3. Regra de merge recomendada

Para a iteracao do Mac:

- tratar o codigo do Mac como candidato a funcionalidade mais avancada
- tratar o branch atual como candidato a baseline operacional limpa
- nao reintroduzir:
  - worktrees partidos
  - dirtiness local em producao
  - divergencia entre o que esta live e o que esta no GitHub

## 8. Persistencia: Direcao Recomendada

### Estado atual

Hoje, a persistencia esta dividida entre JSON e SQLite.

Exemplos relevantes no codigo:

- [sqlite-store.js](C:\Users\joborocha\Documents\Codex\2026-04-28\procura-instancias-tuas-a-correr-em\torus-pr1-snapshot\runtime\sqlite-store.js)
- [file-utils.js](C:\Users\joborocha\Documents\Codex\2026-04-28\procura-instancias-tuas-a-correr-em\torus-pr1-snapshot\runtime\file-utils.js)

O espelho SQLite atual usa WAL e serve bem como etapa transitoria, mas nao deve ser o destino final como source of truth principal.

### Recomendacao

Usar PostgreSQL como base principal de persistencia operacional.

Se o volume temporal crescer muito:

- considerar Timescale por cima de PostgreSQL

Direcao resumida:

- base principal:
  - PostgreSQL 16/17
- aceleracao time-series, se necessario:
  - Timescale
- JSON e SQLite:
  - manter apenas como camada de transicao / compatibilidade temporaria

### Porque esta recomendacao faz sentido

O objetivo de longo prazo do sistema nao e apenas executar sinais. E ser capaz de:

- analisar mercados
- gerar ou selecionar estrategias
- testar essas estrategias
- medir edge por regime
- promover ou desligar lanes
- implementar ao vivo com rastreabilidade

Isso exige:

- proveniencia total
- historico auditavel
- joins entre execucao live, configuracao, research, modelos e contexto de regime

### Entidades/tabelas base sugeridas

- `market_bars`
- `signal_candidates`
- `executions`
- `fills`
- `strategy_versions`
- `strategy_configs`
- `backtest_runs`
- `walk_forward_runs`
- `model_versions`
- `regime_snapshots`
- `promotion_decisions`
- `account_snapshots`

### Estrategia de migracao recomendada

1. dual-write
   - manter JSON/SQLite
   - escrever tambem em PostgreSQL
2. mover reads analiticos e dashboard para PostgreSQL
3. mover runtime live para usar PostgreSQL como source of truth
4. retirar JSON/SQLite como persistencia primaria

## 9. Lacunas Arquiteturais Mais Importantes

Mesmo com o sistema agora mais limpo e alinhado, ainda faltam algumas pecas para o objetivo autonomo completo:

- proveniencia total por trade
  - cada execucao deveria saber exatamente de que `strategy_version`, `config_version`, `dataset`, `regime snapshot` e `promotion decision` veio
- motor formal de promocao/demissao de estrategias
- adaptacao por regime fechada e auditavel
- persistencia unificada

O edge de longo prazo nao vai vir apenas de "mais estrategias". Vai vir de um sistema que consegue:

- gerar hipoteses
- testar
- validar
- promover
- desligar
- reaprender
- e fazer isso tudo com memoria auditavel

## 10. Proxima Acao Recomendada Para a Iteracao do Mac

Quando a iteracao do Mac pegar neste contexto, a ordem recomendada e:

1. puxar e rever `codex/repo-sync-cleanup` no commit `9653eb0`
2. comparar esse estado com o codigo mais avancado do Mac
3. fazer merge por hotspots, nao por substituicao cega
4. preservar a conclusao atual sobre estrategia:
   - nao abrir os gates do lane principal sem nova prova
   - considerar `1000SHIBUSDC short` como candidata a lane exploratoria
5. desenhar a nova camada de persistencia com PostgreSQL como alvo
6. so depois disso mexer mais a serio no motor autonomo de selecao/promocao de estrategias

## 11. Artefactos Locais Que Ajudam Neste Handoff

- [balance-equilibrium-analysis.js](C:\Users\joborocha\Documents\Codex\2026-04-28\procura-instancias-tuas-a-correr-em\balance-equilibrium-analysis.js)
- [balance-equilibrium-report-live.json](C:\Users\joborocha\Documents\Codex\2026-04-28\procura-instancias-tuas-a-correr-em\balance-equilibrium-report-live.json)
- [final-server-sync-9653eb0.patch](C:\Users\joborocha\Documents\Codex\2026-04-28\procura-instancias-tuas-a-correr-em\final-server-sync-9653eb0.patch)
- [AGENT_CONTEXT.md](C:\Users\joborocha\Documents\Codex\2026-04-28\procura-instancias-tuas-a-correr-em\AGENT_CONTEXT.md)

## 12. Nota Final

Este handoff deve ser lido com uma ideia central:

- o sistema ficou finalmente alinhado entre GitHub e servidor
- o lane principal atual nao deve ser relaxado por intuicao
- a proxima grande evolucao deve acontecer com merge disciplinado e persistencia centralizada

Se a iteracao do Mac tem mais codigo, isso e bom. Mas o merge deve respeitar esta base operacional limpa, porque ela ja representa um passo importante na direcao certa.
