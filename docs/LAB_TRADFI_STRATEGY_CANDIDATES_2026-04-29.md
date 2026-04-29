# Lab TradFi Strategy Candidates

## Estado atual

- Testes TradFi no servidor: `47/47` a passar em copia isolada, sem tocar no runtime live.
- Otimizacao TradFi concluida em `tradfi-preset-recommendations-2026-04-29.json` e `tradfi-optimization-2026-04-29`.
- Leitura geral: o edge mais limpo aparece em reversao de timeframe maior para equities e em trap/failed move no `1h`.
- Nota de prudencia: os outputs analisados nao incluem custos reais de execucao; qualquer promocao no lab deve voltar a medir fees, slippage e estabilidade por regime.

## Ranking atual por simbolo/estrategia

1. `AAPLUSDT oversoldBounce 4h/1d`
   - `28` trades, `57.1%` winrate, `avgPnl +0.582%`, `PF 1.85`
   - Melhor combinacao de edge e amostra para reversal HTF.

2. `SPYUSDT oversoldBounce 4h/1d`
   - `32` trades, `62.5%` winrate, `avgPnl +0.466%`, `PF 2.38`
   - Muito robusta; confirma que o tema de reversal HTF nao e so AAPL-specific.

3. `QQQUSDT bullTrap 1h/1d`
   - `10` trades, `80.0%` winrate, `avgPnl +0.502%`, `PF 7.21`
   - O destaque mais explosivo, mas com amostra curta; precisa de validacao dura no lab.

4. `QQQUSDT breakdownRetestShort 1h/1d`
   - `11` trades, `63.6%` winrate, `avgPnl +0.218%`, `PF 1.87`
   - Menos vistosa que bullTrap, mas mais facil de transformar em regra repetivel.

5. `XAUUSDT failedBreakdown 1h/1d`
   - `8` trades, `50.0%` winrate, `avgPnl +0.199%`, `PF 1.77`
   - Boa candidata de reclaim/reversal, mas ainda com amostra fina.

## Padroes observados nos winners vs losers

### AAPLUSDT e SPYUSDT oversoldBounce 4h/1d

- O melhor edge veio de reversao controlada, nao de panico extremo.
- Winners tendem a aparecer com `recentDropAtr` mais moderado que os losers.
- Winners mantem mais estrutura util: separacao de EMAs ainda presente e espaco real ate ao alvo.
- Em SPY, winners vieram com `ADX` mais baixo, corpo de recuperacao mais forte e `rsiRecovery` mais agressivo do que os losers.
- Leitura pratica: queremos queda significativa, mas nao capitulacao desorganizada.

### QQQUSDT bullTrap 1h/1d

- O padrao forte foi short de exaustao, nao breakdown puro.
- Winners aparecem em contexto de breakout cansado, com `RSI` alto mas nao euforico.
- O `ADX` nos winners parece mais baixo que no breakout demasiado forte; o short funciona melhor quando a tendencia ja esta a perder qualidade.
- Leitura pratica: trap com rejeicao limpa em tendencia "soft", nao contra impulso muito vivo.

### QQQUSDT breakdownRetestShort 1h/1d

- Winners vieram com `relativeVol` mais alto, corpo de rejeicao maior e mais separacao de EMAs.
- Tambem mostraram melhor espaco ate ao alvo/suporte antes do colapso do R:R.
- Leitura pratica: retest short vale mais quando o retest falha com decisao, nao quando o mercado apenas encosta e deriva.

### XAUUSDT failedBreakdown 1h/1d

- Winners surgem quando o reclaim e violento e proximo de suporte relevante.
- `rsiRecovery` e corpo de confirmacao foram bem mais fortes nos winners.
- O `ADX` nos winners foi mais alto que nos losers, o que sugere reclaim com impulso real, nao simples bounce morto.
- Leitura pratica: queremos breakdown falhado com resposta rapida e clara do lado comprador.

## Estrategias candidatas para o lab

### 1. controlledOversoldBounce4h

- Hipotese:
  - Em equities como `AAPLUSDT` e `SPYUSDT`, o melhor bounce vem de oversold estrutural em `4h/1d`, com recuperacao real mas sem flush extremo.
- Filtros iniciais a testar:
  - `tf=4h`, `htfTf=1d`
  - `RSI` baixo com recuperacao positiva no candle de sinal
  - teto de `ADX` para evitar panico descontrolado
  - teto de `recentDropAtr` para excluir washout extremo
  - `emaSeparationPct` minimo para garantir estrutura ainda legivel
  - `minRelativeVolume` moderado, sem exigir climax absoluto
  - alvo moderado, com cap estrutural e piso de `R:R`
- Metricas-alvo:
  - `PF >= 1.6`
  - `avgPnlPct >= 0.30%`
  - `winrate >= 55%`
  - `trades >= 20`
  - `maxDrawdownPct < 10%`
- Riscos:
  - Comprar demasiado cedo em quedas que ainda nao terminaram
  - Confundir panico com oportunidade quando o `ADX` ja esta demasiado agressivo
- Prioridade:
  - `P1`

### 2. softTrendBullTrap1h

- Hipotese:
  - Em `QQQUSDT`, o short funciona melhor como trap em breakout cansado do que como chase de breakdown.
- Filtros iniciais a testar:
  - `tf=1h`, `htfTf=1d`
  - `RSI` alto, mas abaixo de euforia extrema
  - teto de `ADX` para evitar short contra impulso ainda saudavel
  - `upperWick/body` minimos para provar rejeicao
  - `minRelativeVolume` leve a moderado
  - excluir extensao excessiva onde o alvo fica curto ou o mercado ja esta "too obvious"
  - exigir `R:R` minimo robusto apos cap
- Metricas-alvo:
  - `PF >= 2.0`
  - `avgPnlPct >= 0.25%`
  - `winrate >= 60%`
  - `trades >= 10`
- Riscos:
  - Amostra atual curta
  - Pode degradar rapido se o regime mudar para momentum bull persistente
- Prioridade:
  - `P1`

### 3. decisiveRetestShort1h

- Hipotese:
  - O retest short de `QQQUSDT` melhora quando a rejeicao do retest vem com corpo forte, volume melhor e estrutura bearish ainda limpa.
- Filtros iniciais a testar:
  - `tf=1h`, `htfTf=1d`
  - `relativeVol` minimo
  - `rejectBodyAtr` minimo acima do baseline atual
  - `emaSeparationPct` minimo
  - distancia minima ate ao proximo suporte para nao entrar sem espaco
  - limite de `ADX` para evitar breakdown ja demasiado esticado
  - `R:R` minimo apos cap
- Metricas-alvo:
  - `PF >= 1.6`
  - `avgPnlPct >= 0.18%`
  - `winrate >= 58%`
  - `trades >= 10`
- Riscos:
  - Retests fracos podem parecer validos em volume baixo
  - Facil cair em "late short" se o mercado ja estiver demasiado comprimido
- Prioridade:
  - `P2`

### 4. violentFailedBreakdownReclaim1h

- Hipotese:
  - Em `XAUUSDT`, o melhor reclaim long vem quando o breakdown falha depressa e a recuperacao aparece com impulso claro.
- Filtros iniciais a testar:
  - `tf=1h`, `htfTf=1d`
  - `rsiRecovery` minimo elevado
  - `confirmBodyAtr` minimo
  - proximidade a suporte real
  - `ADX` minimo para confirmar reclaim energetico
  - wick inferior relevante, mas sem depender apenas da wick
  - alvo com `R:R` suficiente e espaco real ate resistencia
- Metricas-alvo:
  - `PF >= 1.5`
  - `avgPnlPct >= 0.15%`
  - `winrate >= 50%`
  - `trades >= 8`
- Riscos:
  - Amostra ainda pequena
  - Ouro pode mudar de regime depressa e punir reversao tardia
- Prioridade:
  - `P3`

## Ordem sugerida de testes no lab

1. `controlledOversoldBounce4h`
   - Melhor equilibrio atual entre edge, amostra e repetibilidade em dois simbolos.

2. `softTrendBullTrap1h`
   - O maior standout de PnL/PF, mas precisa validacao para sabermos se e edge real ou amostra feliz.

3. `decisiveRetestShort1h`
   - Boa extensao natural do tema QQQ short, com melhor chance de virar regra estavel do que um trap demasiado "artesanal".

4. `violentFailedBreakdownReclaim1h`
   - Boa candidata, mas deixaria para depois porque o sample ainda e o mais fino dos quatro.
