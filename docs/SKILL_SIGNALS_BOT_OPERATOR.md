# signals_bot_operator

## Objetivo

Esta skill permite ao agente operar o bot de forma segura em ambiente local ou servidor, sem alterar a estratégia arbitrariamente.

O foco desta skill é:

- arrancar e parar o bot
- monitorizar logs
- verificar estado do processo
- validar saúde do sistema
- executar comandos operacionais seguros
- preparar deploy controlado
- operar PM2 ou loop local
- verificar ficheiros essenciais

Nunca executar trades reais sem confirmação humana explícita.

---

## Escopo

Esta skill é apenas para operações e observabilidade.

Não serve para:
- otimizar estratégia
- alterar parâmetros de trading sem análise
- refatorar o bot
- modificar lógica de entrada/saída

Essas tarefas pertencem à skill `signals_bot_lab`.

---

## Ficheiros principais

- torus-ai-trading.js
- state.json
- package.json
- .env
- analyze-state.js
- simulate-params.js
- optimize-strategy.js
- backfill-dataset.js
- backtest-bot.js

---

## Comandos permitidos

### Operação local
- npm run run
- npm run loop
- npm run analyze
- npm run simulate
- npm run optimize
- npm run backfill
- npm run backtest

### Diagnóstico
- node -v
- npm -v
- pwd
- ls -lah
- ps aux
- cat package.json
- tail
- grep

### PM2 (se existir no ambiente)
- pm2 status
- pm2 logs
- pm2 start
- pm2 restart
- pm2 stop
- pm2 delete

---

## Workflow operacional obrigatório

Sempre seguir esta ordem antes de mexer no bot:

1) Confirmar diretório atual
- verificar que o agente está dentro da pasta correta do projeto

2) Confirmar ficheiros essenciais
- package.json
- torus-ai-trading.js
- state.json
- .env

3) Confirmar modo de execução disponível
- loop local
- PM2
- outro processo supervisor

4) Verificar saúde do sistema
- processo ativo ou parado
- erros recentes
- logs do bot
- integridade do state.json

5) Só depois executar ação operacional

---

## Ações operacionais permitidas

### Arranque do bot
Se o bot estiver parado, o agente pode:
- sugerir `npm run loop`
- sugerir arranque com PM2
- validar se arrancou sem erro

### Paragem do bot
Se o utilizador pedir, o agente pode:
- parar loop local
- parar processo PM2
- confirmar que o processo terminou

### Reinício do bot
Se houver erro, o agente pode:
- reiniciar o processo
- validar logs
- confirmar se o erro desapareceu

### Logs
O agente pode:
- ler logs recentes
- procurar erros
- resumir estado atual
- destacar falhas repetidas

### Verificação de configuração
O agente pode:
- confirmar presença de variáveis no `.env`
- verificar se faltam campos obrigatórios
- nunca mostrar segredos completos

---

## Regras de segurança

Nunca:
- mostrar valores completos de chaves API
- alterar `.env` sem explicar antes
- executar ordens reais na Binance sem confirmação humana explícita
- modificar vários ficheiros em simultâneo sem necessidade
- apagar ficheiros de estado
- fazer deploy automático sem validação

Sempre:
- mostrar o comando antes de o usar
- explicar impacto da ação
- preferir alterações reversíveis
- validar se o bot arrancou corretamente após mudança

---

## Regras específicas para `.env`

O agente pode:
- verificar se existem variáveis necessárias
- indicar quais faltam
- sugerir linhas a adicionar

O agente nunca deve:
- imprimir tokens completos
- expor API keys
- fazer commit do `.env`

---

## Regras específicas para `state.json`

O agente pode:
- validar formato JSON
- verificar openSignals
- verificar closedSignals
- resumir métricas
- detetar inconsistências

O agente nunca deve:
- limpar o ficheiro sem aprovação
- alterar histórico sem motivo explícito
- inventar valores

---

## Prioridades operacionais

Quando houver problemas, a ordem de prioridade é:

1) confirmar se o processo está vivo
2) confirmar se o ficheiro `.env` está correto
3) confirmar se `state.json` está válido
4) ler erro exato no terminal ou logs
5) propor correção mínima
6) reiniciar e validar

---

## Formato de resposta operacional

Quando agir, o agente deve responder assim:

1) estado atual
2) problema encontrado
3) ação proposta
4) comando a executar
5) resultado esperado
6) validação final

---

## Exemplos de tarefas desta skill

- "ver se o bot está a correr"
- "arranca o bot"
- "reinicia o bot"
- "mostra os últimos erros"
- "valida o state.json"
- "confirma se o .env tem o que falta"
- "prepara arranque com pm2"
- "verifica se o bot está preso"

---

## Missão do agente

Operar o bot com segurança, estabilidade e observabilidade, sem confundir operações com research e sem tocar na estratégia sem validação.
