# Lab TradFi Controlled Oversold Bounce 4h Implementation Task

Data: 2026-04-29
Estado: pronto para implementacao no lab, sem qualquer deploy live

## Objetivo

Implementar uma variante de laboratorio da familia `oversoldBounce` focada em reversao `4h/1d` para equities, começando por:

- `AAPLUSDT`
- `SPYUSDT`

A variante deve atacar um problema especifico:

- preservar reversoes de qualidade
- evitar flushes demasiado desorganizados
- evitar alvos demasiado curtos
- continuar separada do runtime live

Esta tarefa deriva de:

- [LAB_TRADFI_STRATEGY_CANDIDATES_2026-04-29.md](./LAB_TRADFI_STRATEGY_CANDIDATES_2026-04-29.md)
- [LAB_TRADFI_CONTROLLED_OVERSOLDBOUNCE4H_SPEC_2026-04-29.md](./LAB_TRADFI_CONTROLLED_OVERSOLDBOUNCE4H_SPEC_2026-04-29.md)

## Resultado esperado

No fim desta tarefa, o repo deve conseguir:

1. correr uma variante `controlledOversoldBounce4h` no lab
2. otimizar essa variante para `AAPLUSDT` e `SPYUSDT`
3. gerar outputs comparaveis contra a baseline atual de `oversoldBounce`
4. medir a variante com custos e slippage proxy
5. deixar artefactos guardados e rastreaveis em `research/cache/...`

## Ficheiros de codigo a tocar

### Estrategia

- `strategies/oversold-bounce-strategy.js`

Adicionar knobs backward-compatible para o caso de laboratorio:

- `maxDropAtr`
- `maxAdx`
- `minEmaSeparationPct`
- `minLowerWickAtr`

Regra importante:

- defaults devem manter o comportamento atual quando o knob nao e configurado
- nao partir o uso atual da estrategia fora do lab

### Research / presets / otimizacao

- `research/optimize-tradfi-preset.js`
- `research/backtest-tradfi-candidates.js`
- `research/build-tradfi-twelve-equities-preset.js`
- `research/run-tradfi-twelve-equities-backtests.js`

Objetivo aqui:

- introduzir um profile/variant dedicado, por exemplo:
  - `4h_1d_equity_controlled_reversal`
- limitar o universo inicial a:
  - `AAPLUSDT`
  - `SPYUSDT`
- permitir comparar esta variante contra a baseline `4h_1d`

### Testes

Adicionar ou estender testes em:

- `tests/`

Minimo esperado:

- teste unitario para `oversold-bounce-strategy.js` cobrindo os novos gates
- teste que prove backward compatibility quando os novos knobs nao existem
- teste que prove que a variante nova entra no preset/optimizer sem rebentar os runners existentes

## Baseline v0 a implementar no lab

Primeira seed da variante:

```json
{
  "symbolUniverse": ["AAPLUSDT", "SPYUSDT"],
  "strategy": "controlledOversoldBounce4h",
  "tf": "4h",
  "htfTf": "1d",
  "direction": "LONG",
  "enabled": true,
  "minScore": 55,
  "maxRsi": 46,
  "minRsiRecovery": 0.9,
  "minDropAtr": 1.1,
  "maxDropAtr": 3.2,
  "minBullRecoveryBodyAtr": 0.10,
  "minLowerWickAtr": 0.08,
  "minRelativeVolume": 0.95,
  "requireVolume": false,
  "maxAdx": 42,
  "minEmaSeparationPct": 0.0005,
  "slAtrMult": 1.0,
  "tpAtrMult": 1.4,
  "minRrAfterCap": 0.60,
  "minTpPctAfterCap": 0.0010,
  "minTpAtrAfterCap": 0.35
}
```

## Grelha minima de experimentacao

### Bloco A

- `maxRsi`: `44`, `46`, `48`
- `minRsiRecovery`: `0.7`, `0.9`, `1.2`
- `minDropAtr`: `0.9`, `1.1`, `1.4`
- `maxDropAtr`: `2.6`, `3.2`, `3.8`

### Bloco B

- `maxAdx`: `36`, `42`, `50`
- `minEmaSeparationPct`: `0.0003`, `0.0005`, `0.0010`
- `minBullRecoveryBodyAtr`: `0.08`, `0.10`, `0.14`
- `minLowerWickAtr`: `0.05`, `0.08`, `0.12`

### Bloco C

- `tpAtrMult`: `1.2`, `1.4`, `1.6`
- `minRrAfterCap`: `0.60`, `0.75`, `0.90`
- `minTpPctAfterCap`: `0.0008`, `0.0010`, `0.0015`
- `minTpAtrAfterCap`: `0.30`, `0.35`, `0.45`

## Custos obrigatorios na validacao

Antes de qualquer promocao:

- fee round-trip proxy: `0.10%`
- slippage proxy: `0.02%` a `0.05%`

Nao aceitar conclusoes finais com:

- fees = `0`
- slippage = `0`

## Comandos esperados

Baseline de execucao no repo:

```bash
npm run optimize:tradfi
npm run backtest:tradfi-equities
npm run train:tradfi-meta
npm test
```

Se for criado comando novo para a variante, documentar no `package.json` e neste doc.

## Critérios de aprovacao

Para esta variante continuar:

- `PF >= 1.60`
- `avgNetPnlPct >= 0.25%`
- `winrate >= 55%`
- `trades >= 20`
- `maxDrawdownPct < 10%`
- robustez aceitavel em `AAPLUSDT` e `SPYUSDT`

## Critérios de rejeicao

Rejeitar ou reformular se:

- o edge desaparecer com custos
- a variante viver de poucos outliers
- `AAPL` funcionar mas `SPY` colapsar, ou vice-versa
- abrir `maxDropAtr` e `maxAdx` aumentar trades mas destruir `avgNetPnlPct`

## Guardrails

- nao tocar no runtime live
- nao promover para `runtime/strategy-config.json`
- nao misturar esta variante com lanes crypto/futures
- manter este trabalho estritamente no `lab/research`

## Artefactos a guardar

Guardar outputs versionados ou facilmente regeneraveis em:

- `research/cache/tradfi-optimization/...`
- `research/cache/tradfi-patterns/...`

E deixar referencia curta no handoff quando a implementacao acabar:

- variante criada
- comandos corridos
- resultados chave
- ficheiros alterados

## Definicao de done

Esta tarefa fica feita quando existirem:

1. codigo da variante no lab
2. testes verdes
3. output de backtest/otimizacao comparavel
4. comparacao custo-on vs baseline
5. registo no handoff / docs
