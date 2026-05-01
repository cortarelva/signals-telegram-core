---

# signals_bot_lab

## Objetivo

Esta skill permite ao agente:

- analisar performance do bot
- executar backtests
- testar novos parâmetros
- otimizar estratégia
- propor melhorias seguras
- implementar patches pequenos no código

Nunca executar trades reais nem alterar parâmetros live sem confirmação humana.

---

## Estrutura do Projeto

## Bot live

O ficheiro `torus-ai-trading.js` é o bot em produção.

Regras para este ficheiro:

- alterações devem ser pequenas
- alterações devem ser justificadas por backtest
- nunca alterar múltiplos parâmetros ao mesmo tempo
- sempre mostrar diff antes de modificar

Se a mudança for grande, deve ser primeiro testada em `backtest-bot.js`.

---

O projeto contém:

- torus-ai-trading.js
- state.json
- backfill-dataset.js
- analyze-state.js
- simulate-params.js
- optimize-strategy.js
- backtest-bot.js
- package.json

---

## Scripts disponíveis

O agente deve usar estes comandos:

- npm run analyze
- npm run simulate
- npm run optimize
- npm run backfill
- npm run backtest

---

## Modo laboratório

Antes de propor qualquer mudança estratégica, o agente deve:

1) gerar ou atualizar dataset
npm run backfill

2) executar backtest
npm run backtest

3) executar optimizer
npm run optimize

4) comparar resultados com estratégia atual

Só depois pode sugerir mudanças.

## Workflow obrigatório

Sempre seguir esta ordem antes de propor alterações:

1) Ler o estado do bot
- abrir state.json
- verificar openSignals
- verificar closedSignals

2) Analisar performance
executar:

- npm run analyze

3) Verificar dataset histórico
executar:

- npm run backfill

4) Executar backtest completo
executar:

- npm run backtest

5) Procurar melhores parâmetros
executar:

- npm run optimize

6) Comparar resultados

Só depois disto propor alterações.

---

## Regras de segurança

Nunca:

- modificar parâmetros sem justificar com backtest
- executar código de trading real
- alterar mais de um ficheiro por proposta sem justificação
- refatorar o projeto inteiro
- remover código existente

Sempre:

- propor mudanças pequenas
- mostrar diff claro
- explicar impacto esperado
- manter compatibilidade com scripts existentes

---

## Requisitos mínimos de dados

Nunca propor mudanças estratégicas se:

- closedSignals < 30
- trades no backtest < 50

Se estes limites não forem atingidos, o agente deve apenas recolher mais dados.

## Regra de comparação de estratégia

Uma estratégia só deve ser considerada melhor se:

- winrate >= estratégia atual
- OU
- expectancy > estratégia atual

E:
- número de trades >= 50% da estratégia atual

## Limites de alteração

O agente só pode modificar no máximo:

1) 1 parâmetro de estratégia por iteração
OU
2) 1 função de análise
Após alteração, deve:

- executar backtest novamente
- mostrar comparação antes/depois
- esperar aprovação humana antes de aplicar no bot live

O agente só pode modificar no máximo:

- 1 parâmetro de estratégia por iteração
OU
- 1 função de análise

Após alteração, deve:

1) executar backtest novamente
2) mostrar comparação antes/depois
3) esperar aprovação humana antes de aplicar no bot live

## Tipos de melhorias permitidas

O agente pode propor:

- ajustes em RSI_MIN e RSI_MAX
- ajustes em SL_ATR_MULT e TP_ATR_MULT
- ajustes em PULLBACK_BAND_ATR
- melhorias no scoring de sinais
- melhorias no backtest
- melhorias no optimizer
- melhorias na análise estatística

Nunca alterar a arquitetura principal sem aprovação.

---

## Métricas de avaliação

O agente deve avaliar estratégias usando:

- número de trades
- winrate
- expectancy
- profit factor
- drawdown estimado

Uma melhoria só deve ser proposta se melhorar pelo menos uma métrica sem degradar as outras de forma significativa.

---

## Formato de proposta

Sempre apresentar:

1) alteração proposta
2) motivo baseado em dados
3) resultado esperado
4) ficheiro a alterar
5) diff pequeno

---

## Missão do agente

Transformar este bot num sistema quantitativo robusto através de:

- análise baseada em dados
- melhoria incremental
- testes constantes 

---
