# Timothy Masters Playbook para o TorusAiTrading

Data: `2026-04-27`

## Objetivo
Extrair de `Testing and Tuning Market Trading Systems` apenas o que nos ajuda a:
- testar melhor as famílias que já temos
- afinar a parte financeira sem cair em overfit
- promover/despromover setups com mais disciplina
- detetar deterioração antes de um sistema falhar em live

## Fontes Públicas Usadas
- Springer / Apress: [Testing and Tuning Market Trading Systems](https://link.springer.com/book/10.1007/978-1-4842-4173-8)
- Google Books: [Testing and Tuning Market Trading Systems: Algorithms in C++](https://books.google.com/books/about/Testing_and_Tuning_Market_Trading_System.html?id=Hyt1DwAAQBAJ)

## O que importa mesmo do Timothy Masters

### 1. Um backtest bom é só o início
O fio condutor do livro é claro:
- ideia promissora
- testes de validade
- tuning robusto
- estimativa de comportamento futuro
- monitorização para detetar deterioração

Tradução para nós:
- um setup novo não pode ir de `backtest bonito` para `live`
- tem de passar por:
  - extended sample
  - out-of-sample
  - stress de custos
  - expectativa mínima de comportamento futuro

### 2. Pré-otimização é tão importante como a otimização
O índice do livro começa por:
- `Pre-optimization Issues`
- depois `Optimization Issues`
- e só depois `Post-optimization Issues`

Isto é útil porque nos obriga a separar problemas:
- antes de mexer em parâmetros, validar se a hipótese tem sinal
- só depois ajustar
- e só depois medir robustez e futuro esperado

Tradução para nós:
- quando uma família falha, a primeira pergunta não deve ser “que parâmetro solto?”
- deve ser “há hipótese económica/estrutural aqui?”

### 3. Tuning tem de procurar robustez, não só pico de performance
O livro enfatiza tuning para comportamento robusto perante mudanças de mercado, não só para o melhor backtest.

Tradução para nós:
- superfícies suaves de performance contam mais do que o melhor ponto
- um parâmetro que melhora `avgNet` mas torna tudo frágil é suspeito
- isto bate certo com o que já vimos em:
  - `BTC breakdownRetestShort`
  - vários relaxamentos do `cipher`

### 4. Precisamos de estimar o futuro, não apenas o passado
Os capítulos de `Estimating Future Performance` apontam para algo que ainda fazemos de forma incompleta:
- produzir um intervalo plausível do que o sistema pode fazer daqui para a frente
- não apenas reportar o que já fez

Tradução para nós:
- cada promoção para live devia ter pelo menos:
  - média líquida histórica
  - lower bound conservador de performance futura
  - estimativa de drawdown plausível

### 5. Monte Carlo / permutação servem para separar skill de sorte
O capítulo `Permutation Tests` e a ênfase dele em “good luck vs real edge” são muito alinhados com o nosso problema atual.

Tradução para nós:
- várias famílias com poucas trades parecem ótimas por pura sorte amostral
- antes de promover:
  - embaralhar ordem de trades
  - testar sensibilidade da curva
  - estimar probabilidade de o resultado ser apenas sorte

### 6. Nested walk-forward é especialmente relevante para nós
Uma das ideias mais fortes do material promocional é aninhar walk-forward para reduzir selection bias em sistemas mais complexos.

Tradução para nós:
- quando comparamos muitas famílias/símbolos/configs, estamos a fazer seleção múltipla
- o nosso research devia penalizar isso explicitamente
- se escolhemos “o melhor de muitos”, precisamos de mais humildade no score final

### 7. Deterioração tem de ser medida cedo
Outra ideia importante:
- não esperar que o sistema “morra completamente”
- criar limites para detetar quando o live deixou de se parecer com o esperado

Tradução para nós:
- isto encaixa muito bem no que já começámos hoje:
  - rolling loss limits
  - cooldown por sequência de losses
- o passo seguinte é ligar isto a:
  - lower bound de performance esperada
  - drift entre live recente e expectativa de backtest

## Como isto influencia o TorusAiTrading

### A. Promoção para live tem de exigir expectativa futura mínima
Hoje olhamos muito para:
- `avgNet`
- `profitFactor`
- `drawdown`
- segunda metade da amostra

Depois de Masters, eu acrescentaria:
- lower bound conservador da média líquida
- probabilidade estimada de drawdown excessivo
- penalização por sample pequeno

### B. O tuning devia ser menos “point estimate”
Hoje ainda falamos muitas vezes como:
- “esta configuração ganhou”

Devíamos passar a falar mais como:
- “esta região de parâmetros é estável”
- “esta configuração só é boa num ponto estreito”

### C. O exploratory bucket devia ter critérios de saída mais estatísticos
Hoje já temos guardrails financeiros.
O próximo nível seria:
- matar mais cedo setups cujo live recente fique abaixo de um bound esperado
- não esperar demasiadas trades para admitir degradação

### D. Precisamos de um score de robustez transversal
Para qualquer família nova, o score final devia juntar:
- net performance
- smoothness da superfície de tuning
- OOS ratio
- sample size
- Monte Carlo / permutation confidence
- drawdown tail risk

## Tarefas concretas inspiradas por Timothy Masters

### Prioridade 1. Monte Carlo do trade list
Criar uma ferramenta tipo:
- `research/monte-carlo-trade-list.js`

Objetivo:
- baralhar a ordem de trades de cada família
- medir:
  - distribuição de equity outcomes
  - drawdown esperado
  - probabilidade de cair abaixo de um limite

Aplicações imediatas:
- `BTC 1h core`
- `SHIB short 15m`
- `breakdownContinuationBaseShort 15m exploratory`

### Prioridade 2. Lower bound de performance futura
Criar um resumo de promoção tipo:
- média líquida
- mediana
- lower bound conservador da média futura
- percentil pessimista do drawdown

Isto seria ouro para decidir:
- `promove`
- `observe`
- `paper-only`

### Prioridade 3. Ruggedness / parameter smoothness
Quando fizermos sweeps, guardar explicitamente:
- dispersão local do resultado
- quão sensível é o setup a pequenas mudanças

Regra prática:
- se só um ponto funciona, desconfiar
- se uma zona inteira funciona, respeitar

### Prioridade 4. Penalização por seleção múltipla
Se testarmos muitas famílias/símbolos/configs:
- o melhor resultado bruto vale menos
- precisamos de ajustar a confiança para isso

### Prioridade 5. Expected deterioration monitor
Usar no live:
- rolling net recente
- rolling hit rate
- rolling PF
- desvio face ao bound esperado do research

Se degradar demais:
- rebaixa para `observe`
- ou pausa bucket exploratório

## O que eu faria já a seguir

### 1. Monte Carlo dos três blocos principais
- `BTCUSDC 1h core`
- `1000SHIBUSDC 15m short`
- `ADAUSDC/BTCUSDC breakdownContinuationBaseShort 15m exploratory`

### 2. Gate de promoção baseado em bound
Em vez de:
- `avgNet > 0`

Passar para algo mais tipo:
- `avgNet > 0`
- `PF > 1.1`
- `segunda metade aceitável`
- `lower bound futuro ainda positivo ou perto de neutro`

### 3. Dashboard/research com “health vs expectation”
Muito útil para o live:
- “o sistema está dentro da banda esperada?”

## Tradução curta para nós
Se o Ernie Chan nos empurra para:
- `regime`
- `simplicidade`
- `factor context`

o Timothy Masters empurra-nos para:
- `validade estatística`
- `tuning robusto`
- `estimativa conservadora do futuro`
- `deteção precoce de deterioração`

## Conclusão
A lição mais útil dele para o nosso bot é esta:

`não basta encontrar uma estratégia positiva; precisamos de saber quão frágil ela é, quão provável é sobreviver ao futuro, e quão depressa a devemos matar quando deixar de parecer ela própria.`
