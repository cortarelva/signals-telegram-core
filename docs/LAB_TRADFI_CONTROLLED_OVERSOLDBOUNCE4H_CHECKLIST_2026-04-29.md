# Lab TradFi Controlled Oversold Bounce 4h Checklist

Data: 2026-04-29
Estado: checklist tecnica para implementacao no lab, sem qualquer deploy live

## Objetivo

Fechar a implementacao da variante `controlledOversoldBounce4h` de forma disciplinada, com:

- mudancas minimas e rastreaveis
- backward compatibility
- testes dedicados
- outputs comparaveis contra a baseline atual

Este documento complementa:

- [LAB_TRADFI_STRATEGY_CANDIDATES_2026-04-29.md](./LAB_TRADFI_STRATEGY_CANDIDATES_2026-04-29.md)
- [LAB_TRADFI_CONTROLLED_OVERSOLDBOUNCE4H_SPEC_2026-04-29.md](./LAB_TRADFI_CONTROLLED_OVERSOLDBOUNCE4H_SPEC_2026-04-29.md)
- [LAB_TRADFI_CONTROLLED_OVERSOLDBOUNCE4H_IMPLEMENTATION_TASK_2026-04-29.md](./LAB_TRADFI_CONTROLLED_OVERSOLDBOUNCE4H_IMPLEMENTATION_TASK_2026-04-29.md)

## Regra principal

Tudo o que segue e para `lab/research`.

Nao fazer:

- alteracoes em `runtime/strategy-config.json`
- alteracoes em lanes live
- deploy para servidor

## Checklist ficheiro a ficheiro

### 1. `strategies/oversold-bounce-strategy.js`

Objetivo:
- suportar a variante nova sem partir a estrategia atual

Checklist:
- confirmar quais destes campos ja existem e quais faltam:
  - `minDropAtr`
  - `maxDropAtr`
  - `minRsiRecovery`
  - `maxAdx`
  - `minEmaSeparationPct`
  - `minLowerWickAtr`
  - `minBullRecoveryBodyAtr`
  - `minTpPctAfterCap`
  - `minTpAtrAfterCap`
- implementar os knobs em modo opcional:
  - se nao vierem na config, manter comportamento atual
- garantir gates explicitos para:
  - `recentDropAtr >= minDropAtr`
  - `recentDropAtr <= maxDropAtr`
  - `adx <= maxAdx`
  - `emaSeparationPct >= minEmaSeparationPct`
  - `lowerWickAtr >= minLowerWickAtr`
  - `bullRecoveryBodyAtr >= minBullRecoveryBodyAtr`
- garantir que o cap/economics final consegue rejeitar:
  - `tpPctAfterCap < minTpPctAfterCap`
  - `tpAtrAfterCap < minTpAtrAfterCap`
- expor no objeto de debug/diagnostico:
  - `recentDropAtr`
  - `adx`
  - `emaSeparationPct`
  - `lowerWickAtr`
  - `bullRecoveryBodyAtr`
  - `tpPctAfterCap`
  - `tpAtrAfterCap`
  - motivo de bloqueio, quando aplicavel

Definition of done:
- estrategia atual continua a funcionar sem config nova
- variante nova pode ser ligada por config sem fork pesado da logica

### 2. `strategies/index.js`

Objetivo:
- decidir como a variante entra no ecossistema

Checklist:
- verificar se a variante pode reutilizar o mesmo handler `oversoldBounce`
- se sim:
  - nao criar estrategia separada so por nome
  - diferenciar apenas por config/preset
- se nao:
  - registar variante com nome claro, por exemplo `controlledOversoldBounce4h`

Decision gate:
- preferir configuracao sobre duplicacao de estrategia

### 3. `research/build-tradfi-twelve-equities-preset.js`

Objetivo:
- criar um preset claro para a variante

Checklist:
- adicionar preset/variant dedicada, por exemplo:
  - `4h_1d_equity_controlled_reversal`
- limitar universo inicial a:
  - `AAPLUSDT`
  - `SPYUSDT`
- baseline v0 a refletir:
  - `maxRsi = 46`
  - `minRsiRecovery = 0.9`
  - `minDropAtr = 1.1`
  - `maxDropAtr = 3.2`
  - `minBullRecoveryBodyAtr = 0.10`
  - `minLowerWickAtr = 0.08`
  - `minRelativeVolume = 0.95`
  - `maxAdx = 42`
  - `minEmaSeparationPct = 0.0005`
  - `slAtrMult = 1.0`
  - `tpAtrMult = 1.4`
  - `minRrAfterCap = 0.60`
  - `minTpPctAfterCap = 0.0010`
  - `minTpAtrAfterCap = 0.35`
- documentar no proprio preset que e:
  - `lab only`
  - `not for runtime promotion`

Definition of done:
- preset gerado sem mexer nos presets live existentes

### 4. `research/optimize-tradfi-preset.js`

Objetivo:
- permitir otimizar a nova variante

Checklist:
- verificar como os presets atuais entram no optimizer
- adicionar suporte ao profile novo
- garantir que a grelha minima cobre:
  - `maxRsi`: `44`, `46`, `48`
  - `minRsiRecovery`: `0.7`, `0.9`, `1.2`
  - `minDropAtr`: `0.9`, `1.1`, `1.4`
  - `maxDropAtr`: `2.6`, `3.2`, `3.8`
  - `maxAdx`: `36`, `42`, `50`
  - `minEmaSeparationPct`: `0.0003`, `0.0005`, `0.0010`
  - `minBullRecoveryBodyAtr`: `0.08`, `0.10`, `0.14`
  - `minLowerWickAtr`: `0.05`, `0.08`, `0.12`
  - `tpAtrMult`: `1.2`, `1.4`, `1.6`
  - `minRrAfterCap`: `0.60`, `0.75`, `0.90`
  - `minTpPctAfterCap`: `0.0008`, `0.0010`, `0.0015`
  - `minTpAtrAfterCap`: `0.30`, `0.35`, `0.45`
- evitar grid explosiva:
  - correr por blocos
  - ou permitir subset controlado por parametro

Definition of done:
- optimizer corre a variante sem rebentar runtime ou outros presets

### 5. `research/run-tradfi-twelve-equities-backtests.js`

Objetivo:
- correr backtests comparaveis

Checklist:
- incluir a variante nova no runner
- garantir comparacao explicita com a baseline atual `oversoldBounce 4h/1d`
- exportar resultados separados para:
  - `AAPLUSDT`
  - `SPYUSDT`
  - agregado
- guardar:
  - trades
  - winrate
  - avgPnlPct
  - avgNetPnlPct
  - PF
  - maxDrawdownPct
  - trade count

Definition of done:
- runner produz baseline vs candidate no mesmo formato de output

### 6. `research/backtest-tradfi-candidates.js`

Objetivo:
- garantir que a variante entra no pipeline de candidate backtests

Checklist:
- verificar se o pipeline aceita strategy variant/preset novo
- garantir que o output distingue:
  - `oversoldBounce`
  - `controlledOversoldBounce4h`
- incluir custos:
  - fee round-trip proxy `0.10%`
  - slippage `0.02%` a `0.05%`

Definition of done:
- candidate backtest reflete economics reais o suficiente para comparacao

### 7. `tests/`

Objetivo:
- proteger a mudanca

Checklist minimo:
- teste unitario para bloquear por `maxDropAtr`
- teste unitario para bloquear por `maxAdx`
- teste unitario para bloquear por `minEmaSeparationPct`
- teste unitario para bloquear por `minLowerWickAtr`
- teste unitario para bloquear por `minTpPctAfterCap`
- teste unitario para provar backward compatibility:
  - sem knobs novos, comportamento anterior mantem-se
- teste de integracao/preset:
  - nova variante entra no preset builder / optimizer sem rebentar

Definition of done:
- testes verdes para gates novos
- nenhum teste antigo relevante partido

### 8. `package.json` ou comandos auxiliares

Objetivo:
- deixar a execucao repetivel

Checklist:
- verificar se os comandos atuais bastam:
  - `npm run optimize:tradfi`
  - `npm run backtest:tradfi-equities`
  - `npm run train:tradfi-meta`
  - `npm test`
- se nao bastarem:
  - criar comando novo explicito para a variante
  - documentar no spec e no task doc

Definition of done:
- outra iteracao consegue correr o estudo sem adivinhar comandos

## Checklist de outputs

Guardar ou regenerar de forma previsivel:

- `research/cache/tradfi-optimization/...`
- `research/cache/tradfi-patterns/...`
- diff baseline vs candidate
- nota curta com:
  - parametros vencedores
  - custos usados
  - simbolos aprovados/rejeitados

## Checklist de validacao

Antes de considerar a variante promissora:

- `PF >= 1.60`
- `avgNetPnlPct >= 0.25%`
- `winrate >= 55%`
- `trades >= 20`
- `maxDrawdownPct < 10%`
- edge em `AAPLUSDT` e `SPYUSDT`, nao so num dos dois
- custo/slippage ligados
- sem dependencia forte de poucos outliers

## Checklist de regressao a evitar

Nao aceitar:

- variante boa sem fees e fraca com fees
- aumento de trades com colapso de `avgNetPnlPct`
- variante so boa em sample curto sem walk-forward
- mistura de artefactos do lab no runtime live

## Ordem recomendada de implementacao

1. `strategies/oversold-bounce-strategy.js`
2. testes unitarios dos novos gates
3. `build-tradfi-twelve-equities-preset.js`
4. `optimize-tradfi-preset.js`
5. `run-tradfi-twelve-equities-backtests.js`
6. `backtest-tradfi-candidates.js`
7. outputs e nota final

## Registo minimo no fim

Quando a implementacao estiver feita, registar:

- ficheiros alterados
- comandos corridos
- resultados chave baseline vs candidate
- custos usados
- decisao:
  - continua no lab
  - rejeitada
  - candidata a fase seguinte
