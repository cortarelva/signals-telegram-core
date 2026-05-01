# Ernie Chan Playbook para o TorusAiTrading

Data: `2026-04-27`

## Objetivo
Extrair dos livros e materiais públicos do **Ernie Chan** apenas o que é útil para o nosso sistema: ideias que possam virar
- novas famílias de estratégia
- novos filtros de research
- novas regras de robustez
- melhores decisões de promoção/despromoção para live

## Fontes Públicas Usadas
- Site oficial: [epchan.com](https://epchan.com/)
- Apresentação do próprio autor sobre backtesting e pitfalls: [Backtesting and its Pitfalls (Ernest Chan)](https://www.epchan.com/wp-content/uploads/2022/04/Backtesting-and-its-Pitfalls.pdf)
- `Quantitative Trading` no Google Books: [Quantitative Trading](https://books.google.com/books/about/Quantitative_Trading.html?id=NZlV0M5Ije4C)
- Front matter / conteúdos de `Algorithmic Trading`: [Algorithmic Trading: Winning Strategies and Their Rationale](https://assets.thalia.media/doc/artikel/237/320/2373209cba2fb2b7be30a0feaae7939509980fd5.pdf)
- `Machine Trading` no Google Books: [Machine Trading](https://books.google.com/books/about/Machine_Trading.html?id=7bfBDQAAQBAJ)

## O que importa mesmo do Ernie Chan

### 1. Estratégias simples e com racional económico
Chan insiste em estratégias simples, lineares e explicáveis, porque modelos complexos têm mais risco de `data-snooping` e overfit.

Tradução para nós:
- preferir setups com poucas regras nucleares
- só aceitar parâmetros extra quando melhoram fora da amostra
- desconfiar de famílias que só funcionam depois de muita afinação

### 2. Mean reversion e momentum são famílias diferentes
Nos materiais dele, o mundo divide-se muito entre:
- `mean reversion`
- `momentum / trend / breakout`

E ele trata isto como **dependente do regime**.

Tradução para nós:
- não devemos tentar forçar um `cipher long` em dias de `breakdown continuation`
- nem um short de continuação num contexto claramente mean-reverting
- o sistema precisa de um seletor melhor de regime para decidir *qual família pode falar*

### 3. O backtest tem de ser brutalmente honesto
Pontos batidos por Chan:
- `look-ahead bias`
- `survivorship bias`
- `data-snooping bias`
- divergência entre backtest e live
- custos, execução e dataset importam tanto como a lógica

Tradução para nós:
- isto valida o foco que já pusemos em `fills reais`, `fees`, `slippage`, `pnlSource`
- também reforça que qualquer família nova só deve sobreviver se continuar positiva líquida

### 4. Quanto mais parâmetros, mais dados precisas
Na apresentação dele há uma regra prática forte:
- cada parâmetro adicional otimizado pede mais dados

Tradução para nós:
- devemos manter um `parameter budget`
- e preferir grids curtas com poucos graus de liberdade
- uma família que só funciona com 8 knobs finos é suspeita

### 5. Time-series vs cross-sectional
Chan trabalha muito a distinção entre:
- `time-series` momentum / mean reversion
- `cross-sectional` momentum / mean reversion

Isto é importante porque um monte de alts move-se por fator comum.

Tradução para nós:
- `ADA`, `LINK`, `XRP`, `SHIB`, `PEPE` muitas vezes são menos “ativos independentes” e mais “expressões de BTC”
- devíamos tratar parte do sistema como um problema de **leader/follower** ou **market breadth**

### 6. Futuros não são só preço: carry e estrutura importam
Nos livros sobre futures, Chan dá muita importância a:
- roll returns
- contango / backwardation
- carry

No nosso mundo de perp crypto, o análogo mais próximo é:
- funding
- open interest
- basis / desvio spot-perp

Tradução para nós:
- há espaço para um filtro `carry/funding-aware`
- sobretudo para shorts/longs em dias de overcrowding

### 7. Não basta acertar na direção
Este é um ponto muito Chan no espírito:
- um bom modelo não é só “adivinha subida ou descida”
- tem de ter boa geometria de entrada, saída, custos e implementação

Tradução para nós:
- a tua pergunta “teria sido buy ou short?” é válida
- mas promoção para live exige mais: frequência, MAE, PF líquido, drawdown, estabilidade temporal

## Como isto bate no estado atual do nosso bot

### O que já está muito alinhado com Chan
- Separação entre research e live
- Foco em `netPnL`, não só bruto
- Atenção a execução real da Binance
- Desconfiança saudável de setups visuais bonitos sem edge líquida
- Promoção gradual por amostra, PF e drawdown

### O que ainda está fraco face ao “playbook Chan”

#### A. Regime switching
Hoje temos sinais de regime, mas ainda não temos um orquestrador forte do tipo:
- `neste regime só pode falar mean reversion`
- `neste regime só pode falar breakdown continuation`
- `neste regime só entra leader/follower`

#### B. Cross-sectional / factor view
Falta-nos uma camada explícita para dizer:
- `alts estão só a seguir BTC`
- `breadth está a degradar`
- `este símbolo é só beta de BTC hoje`

#### C. Bucket de estratégias por hipótese
Precisamos de pensar em famílias por hipótese económica:
- `trend continuation`
- `weak-base breakdown`
- `post-flush reclaim`
- `oversold bounce`

em vez de só por “nome de setup”.

#### D. Budget de parâmetros
Temos de institucionalizar algo como:
- poucas variáveis por família
- extended test obrigatório
- segunda metade da amostra obrigatória

#### E. Carry / funding / crowding
Ainda não usamos funding/open-interest como filtro sério.
Para perp crypto, isto é provavelmente a ponte mais óbvia entre as ideias de futures do Chan e o nosso sistema.

## O que eu faria a seguir inspirado por Chan

### Prioridade 1. Market factor / leader-follower
Construir uma camada de research e depois runtime para:
- retorno de `BTC` nas últimas `n` velas
- breadth das alts ativas
- correlação curta com `BTC`
- beta intraday a `BTC`
- classificação:
  - `alt-follow rally`
  - `btc-led selloff`
  - `mixed tape`
  - `idiosyncratic`

Isto ajuda a responder:
- um setup em `ADA` é realmente de `ADA`?
- ou é só `BTC beta`?

### Prioridade 2. Regime gate por família
Criar um gate mais forte que selecione famílias por estado de mercado:
- `mean-reverting`
- `trend`
- `breakdown continuation`
- `leader-follow`

Objetivo:
- menos falsos negativos “porque o setup certo não existia”
- menos falsos positivos “porque a família errada falou”

### Prioridade 3. Diagnostics de mean reversion
Adicionar ao research, não necessariamente ao live já:
- meia-vida (`half-life`)
- algum proxy de stationarity / persistência
- Hurst-like diagnostics quando fizer sentido

Isto serve sobretudo para:
- `oversoldBounce`
- `failedBreakdown`
- pares / spreads futuros

### Prioridade 4. Funding / OI / crowding
Para perp crypto:
- funding extremo
- funding a virar
- OI a expandir com preço contra
- OI a cair em flushes

Isto pode ajudar em:
- `breakdownContinuationBaseShort`
- `flushReclaimLong`
- filtros de squeeze falso

### Prioridade 5. Parameter budget formal
Regra de research recomendada:
- cada família nova entra com poucos parâmetros
- qualquer relaxamento grande precisa:
  - extended sample
  - split temporal
  - resultado líquido

## O que eu NÃO traria dos livros dele para nós, pelo menos já

### 1. ML pesado como motor principal
Mesmo no material mais recente, a grande lição útil para nós não é “substituir tudo por ML”.
É usar dados e features para melhorar decisão, não para esconder overfit.

### 2. Pairs trading clássico já
É interessante, mas não é a frente mais prioritária para o nosso bot atual.
Primeiro ainda temos muito para extrair de:
- regime
- breadth
- leader/follower
- carry

### 3. Complexidade académica só porque parece sofisticada
Se uma ideia não melhora a curva líquida, não fica.

## Tradução disto para backlog do TorusAiTrading

### Muito prioridade
- `BTC/alt factor context` no research e dashboard
- `family regime gate`
- `parameter budget` explícito nos estudos

### Prioridade média
- `funding + OI crowding filters`
- `half-life / stationarity diagnostics` para setups de reversão

### Prioridade baixa
- pares / cointegration
- ML mais complexo

## Conclusão
Se eu resumir a utilidade do Ernie Chan para nós numa linha:

> o edge não vem de ter regras mais agressivas; vem de ter **famílias simples, honestamente testadas, ligadas ao regime certo e ao fator certo**.

E isso encaixa muito bem com o ponto onde o nosso sistema está:
- o próximo salto não parece ser “mais filtros”
- nem “menos filtros”
- parece ser **classificar melhor o regime e a liderança do mercado antes de escolher a família de estratégia**.
