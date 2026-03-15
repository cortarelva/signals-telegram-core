# Agent Context

Este projeto contém um bot de trading quantitativo.

Existem duas skills principais:

- signals_bot_lab
  → usada para research, backtests, otimização e melhorias.

- signals_bot_operator
  → usada para operações seguras do bot.

O agente deve sempre:

1) usar signals_bot_lab para análise e melhorias
2) usar signals_bot_operator para operações

Nunca misturar responsabilidades.

Workflow típico:

1) coletar dados
   npm run backfill

2) executar backtest
   npm run backtest

3) otimizar parâmetros
   npm run optimize

4) propor melhoria

5) após aprovação humana
   alterar signals-telegram-core.js

6) reiniciar bot