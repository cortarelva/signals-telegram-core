# Lab TradFi Controlled Oversold Bounce 4h Spec

## Objetivo

Transformar a hipótese `controlledOversoldBounce4h` num teste de lab repetível e auditável, começando por `AAPLUSDT` e `SPYUSDT`.

O alvo não é "apanhar qualquer bounce". O alvo é encontrar reversões `4h/1d` com:

- oversold real
- recuperação confirmada
- estrutura ainda legível
- espaço suficiente até ao alvo
- proteção contra flushes demasiado desorganizados

## Evidência atual

Base observada em [LAB_TRADFI_STRATEGY_CANDIDATES_2026-04-29.md](./LAB_TRADFI_STRATEGY_CANDIDATES_2026-04-29.md) e nos outputs:

- `tradfi-preset-recommendations-2026-04-29.json`
- `tradfi-patterns-2026-04-29/aapl_4h_oversold.json`
- `tradfi-patterns-2026-04-29/spy_4h_oversold.json`

Estado atual por símbolo:

- `AAPLUSDT oversoldBounce 4h/1d`: `28` trades, `57.1%` winrate, `avgPnl +0.582%`, `PF 1.85`, `maxDD 8.28%`
- `SPYUSDT oversoldBounce 4h/1d`: `32` trades, `62.5%` winrate, `avgPnl +0.466%`, `PF 2.38`, `maxDD 3.99%`

Leitura principal dos padrões já observados:

- winners aparecem em reversão controlada, não em pânico extremo
- `recentDropAtr` tem de ser relevante, mas não excessivo
- `rsiRecovery` e corpo de recuperação importam
- em `SPY`, winners parecem surgir com `ADX` menos explosivo do que nos losers
- a estrutura das EMAs ainda precisa de estar "viva", mesmo que bearish no curto prazo

## Universo inicial

Fase 1:

- `AAPLUSDT`
- `SPYUSDT`

Fase 2, se a hipótese passar:

- `QQQUSDT`
- `AMZNUSDT`

## Timeframes e janela

- timeframe de sinal: `4h`
- timeframe de contexto: `1d`
- janela inicial de backtest: a mesma usada nos outputs atuais, `~3 anos`
- walk-forward obrigatório antes de qualquer promoção

## Hipótese de estratégia

Entrar `LONG` quando:

- existe oversold relevante em `4h`
- a recuperação já começou no candle de sinal
- o contexto `1d` ainda permite mean reversion
- o trade não nasce demasiado comprimido em `R:R`
- o selloff anterior não tem cara de capitulação completamente desorganizada

## Baseline v0 para o lab

Esta baseline é a primeira seed para teste, não uma proposta de promoção direta:

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

## Interpretação dos filtros

- `maxRsi = 46`
  - queremos oversold/recovery, não rebote já aquecido demais
- `minRsiRecovery = 0.9`
  - exige recuperação real, não apenas pausa na queda
- `minDropAtr = 1.1`
  - exclui micro pullbacks sem edge de reversão
- `maxDropAtr = 3.2`
  - corta flushes demasiado extremos que hoje parecem degradar a qualidade
- `minBullRecoveryBodyAtr = 0.10`
  - o candle de sinal precisa de mostrar intenção
- `minLowerWickAtr = 0.08`
  - wick ajuda a distinguir exaustão de simples continuação
- `minRelativeVolume = 0.95`
  - não exige climax, mas evita candles mortos
- `maxAdx = 42`
  - tenta preservar reversão controlada e reduzir contexto de pânico
- `minEmaSeparationPct = 0.0005`
  - exige estrutura ainda legível
- `minTpPctAfterCap = 0.10%`
  - corta alvos microscópicos

## Grelha de testes sugerida

### Bloco A: recuperação e oversold

- `maxRsi`: `44`, `46`, `48`
- `minRsiRecovery`: `0.7`, `0.9`, `1.2`
- `minDropAtr`: `0.9`, `1.1`, `1.4`
- `maxDropAtr`: `2.6`, `3.2`, `3.8`

### Bloco B: contexto estrutural

- `maxAdx`: `36`, `42`, `50`
- `minEmaSeparationPct`: `0.0003`, `0.0005`, `0.0010`
- `minBullRecoveryBodyAtr`: `0.08`, `0.10`, `0.14`
- `minLowerWickAtr`: `0.05`, `0.08`, `0.12`

### Bloco C: economics do trade

- `tpAtrMult`: `1.2`, `1.4`, `1.6`
- `minRrAfterCap`: `0.60`, `0.75`, `0.90`
- `minTpPctAfterCap`: `0.0008`, `0.0010`, `0.0015`
- `minTpAtrAfterCap`: `0.30`, `0.35`, `0.45`

## Custos e execução

Antes de qualquer decisão de promoção:

- correr o estudo com fees proxy
- adicionar slippage conservador
- reavaliar `PF`, `avgPnlPct` e `maxDD`

Baseline de prudência sugerida para o lab:

- fee round-trip: `0.10%`
- slippage adicional: `0.02%` a `0.05%`

## Critérios de aprovação

Para passar da fase exploratória:

- `PF >= 1.60`
- `avgNetPnlPct >= 0.25%`
- `winrate >= 55%`
- `trades >= 20`
- `maxDrawdownPct < 10%`
- robustez aceitável em `AAPL` e `SPY`, não só num símbolo

Para promoção a candidate lane:

- custo/slippage já incluídos
- walk-forward positivo
- sem colapso forte fora do período de treino
- estabilidade mínima por regime

## Critérios de rejeição

Rejeitar ou reformular se:

- o edge só existir sem custos
- o `PF` cair demasiado ao adicionar slippage
- a estratégia depender de poucos outliers
- o `maxDropAtr` mais largo aumentar muito winrate mas destruir `avgNetPnlPct`
- a hipótese funcionar só em `AAPL` ou só em `SPY`

## Implementação no lab

Passos sugeridos:

1. Clonar a lógica atual de `oversoldBounce` para uma variante de laboratório `controlledOversoldBounce4h`.
2. Introduzir os knobs novos que a hipótese pede:
   - `maxDropAtr`
   - `maxAdx`
   - `minEmaSeparationPct`
   - `minLowerWickAtr`
3. Correr grid-search faseada por blocos, não tudo de uma vez.
4. Guardar resultados por símbolo, regime e janela.
5. Comparar contra a versão atual de `oversoldBounce` e não apenas contra zero.

## Perguntas em aberto

- O `maxAdx` deve ser hard gate ou apenas score penalty?
- Vale a pena exigir `bullishFast` em parte das variantes, ou isso mata demasiadas entradas?
- O `tp` deve continuar ATR-first com cap estrutural, ou convém testar cap estrutural-first?
- O tema funciona melhor com break-even opcional em `0.8R` ou ainda é cedo para mexer na gestão?

## Próximo passo recomendado

Implementar o backtest desta candidata no lab como variante separada, com:

- universo `AAPLUSDT + SPYUSDT`
- baseline v0 acima
- custos ativados
- grid reduzida de `12` a `18` combinações antes de abrir a pesquisa
