/**
 * signals-telegram-core.js
 * Core simples (spot LONG only) com:
 * - EMA50/EMA200, RSI14, ATR14
 * - Sinal BUY em pullback perto da EMA50 (regime bullish) + RSI a subir
 * - SL/TP baseados em ATR
 * - Anti-spam (cooldown + dedupe) e tracker TP/SL por high/low
 *
 * Dependências:
 *   npm i dotenv
 *
 * .env (mínimo):
 *   SYMBOL=ETHUSDC
 *   TF=5m
 *   LIMIT=500
 *   COOLDOWN_MINS=30
 *   SEND_TELEGRAM=1
 *   TELEGRAM_BOT_TOKEN=xxxx
 *   TELEGRAM_CHAT_ID=yyyy
 */

require("dotenv").config();
const fs = require("fs");

const BINANCE_BASE = "https://api.binance.com";
const STATE_FILE = "./state.json";

const SYMBOL = (process.env.SYMBOL || "ETHUSDC").trim();
const TF = (process.env.TF || "5m").trim();
const LIMIT = Number(process.env.LIMIT || 500);

const COOLDOWN_MINS = Number(process.env.COOLDOWN_MINS || 30);

const SEND_TELEGRAM = String(process.env.SEND_TELEGRAM || "0") === "1";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

// Strategy knobs (ajusta se quiseres)
const EMA_FAST = 50;
const EMA_SLOW = 200;
const RSI_LEN = 14;
const ATR_LEN = 14;

const SL_ATR_MULT = Number(process.env.SL_ATR_MULT || 1.2); // exemplo teu bate ~1.2
const TP_ATR_MULT = Number(process.env.TP_ATR_MULT || 1.6); // exemplo teu bate ~1.6
const PULLBACK_BAND_ATR = Number(process.env.PULLBACK_BAND_ATR || 0.25); // quão perto da EMA50

// RSI band para procurar pullback em bullish trend
const RSI_MIN = Number(process.env.RSI_MIN || 40);
const RSI_MAX = Number(process.env.RSI_MAX || 52);

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { lastSignal: {}, openSignals: [], closedSignals: [] };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function keyFor(symbol, tf) {
  return `${symbol}_${tf}`;
}

// entry perto = "mesmo sinal"
function shouldSendSignal(state, { symbol, tf, side, entry }, cooldownMins = 30) {
  const k = keyFor(symbol, tf);
  const last = state.lastSignal[k];
  const now = Date.now();
  if (!last) return true;

  const ageMin = (now - last.ts) / 60000;
  if (ageMin < cooldownMins) return false;

  const entryDiffPct = Math.abs(entry - last.entry) / (last.entry || entry);
  if (last.side === side && entryDiffPct < 0.0015) return false; // 0.15%

  return true;
}

async function sendTelegram(text) {
  if (!SEND_TELEGRAM) return;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("[WARN] SEND_TELEGRAM=1 mas faltam TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID no .env");
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: TELEGRAM_CHAT_ID,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.log("[WARN] Telegram send falhou:", res.status, t.slice(0, 200));
  }
}

function fmt(n, d = 2) {
  if (!Number.isFinite(n)) return "n/a";
  return Number(n).toFixed(d);
}

function roundToTick(price) {
  // para já: 2 casas (USDC pairs normalmente aceitam 2 ou mais; podes ajustar por symbolInfo se quiseres)
  return Math.round(price * 100) / 100;
}

async function fetchKlines(symbol, interval, limit) {
  const url = new URL(`${BINANCE_BASE}/api/v3/klines`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Binance klines HTTP ${res.status}`);
  const data = await res.json();

  // kline: [ openTime, open, high, low, close, volume, closeTime, ... ]
  return data.map(k => ({
    openTime: k[0],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closeTime: k[6],
  }));
}

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);

  // seed com SMA
  let emaPrev = 0;
  for (let i = 0; i < period; i++) emaPrev += values[i];
  emaPrev /= period;

  for (let i = period; i < values.length; i++) {
    emaPrev = values[i] * k + emaPrev * (1 - k);
  }
  return emaPrev;
}

function rsiWilder(closes, period) {
  if (closes.length < period + 2) return { rsi: null, prevRsi: null };

  // calcular avgGain/avgLoss inicial (Wilder)
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gains += ch;
    else losses += -ch;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  const rsiAt = () => {
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  };

  let prev = null;
  let cur = rsiAt();

  for (let i = period + 1; i < closes.length; i++) {
    prev = cur;
    const ch = closes[i] - closes[i - 1];
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    cur = rsiAt();
  }

  return { rsi: cur, prevRsi: prev ?? cur };
}

function atrWilder(klines, period) {
  if (klines.length < period + 2) return null;

  const tr = [];
  for (let i = 1; i < klines.length; i++) {
    const h = klines[i].high;
    const l = klines[i].low;
    const pc = klines[i - 1].close;
    const t = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    tr.push(t);
  }

  // Wilder smoothing
  let atr = 0;
  for (let i = 0; i < period; i++) atr += tr[i];
  atr /= period;

  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
  }

  return atr;
}

function buildSignal({ symbol, tf, entry, atr, ema50, ema200, rsi }) {
  const sl = roundToTick(entry - SL_ATR_MULT * atr);
  const tp = roundToTick(entry + TP_ATR_MULT * atr);

  const msg =
`*SINAL (CORE)* — ${symbol} ${tf}
*Side:* BUY
*Entry:* ${fmt(entry, 2)}
*SL:* ${fmt(sl, 2)}
*TP:* ${fmt(tp, 2)}

EMA${EMA_FAST}=${fmt(ema50, 2)} | EMA${EMA_SLOW}=${fmt(ema200, 2)}
RSI${RSI_LEN}=${fmt(rsi, 1)} | ATR${ATR_LEN}=${fmt(atr, 2)}`;

  return { side: "BUY", entry, sl, tp, msg };
}

function updateTracker(state, { symbol, tf, candleHigh, candleLow, candleClose }) {
  if (!Array.isArray(state.openSignals) || state.openSignals.length === 0) return;

  const stillOpen = [];
  const closedNow = [];

  for (const s of state.openSignals) {
    // só track do mesmo symbol/tf
    if (s.symbol !== symbol || s.tf !== tf) {
      stillOpen.push(s);
      continue;
    }

    // LONG only
    let outcome = null;

    // usando high/low do candle fechado para simular execução
    if (candleLow <= s.sl) outcome = "SL";
    else if (candleHigh >= s.tp) outcome = "TP";

    if (!outcome) {
      stillOpen.push(s);
      continue;
    }

    s.closedTs = Date.now();
    s.outcome = outcome;
    s.exitRef = candleClose; // referência simples
    closedNow.push(s);
  }

  state.openSignals = stillOpen;

  if (!Array.isArray(state.closedSignals)) state.closedSignals = [];
  state.closedSignals.push(...closedNow);

  return closedNow;
}

(async function main() {
  try {
    console.log(`[CORE] ${SYMBOL} TF=${TF} limit=${LIMIT} (spot-long only)`);

    // Buscar klines
    const klinesRaw = await fetchKlines(SYMBOL, TF, LIMIT);

    // Garantir que usamos o último candle FECHADO
    // A Binance devolve o último ainda a formar — mas como o endpoint spot não indica "isFinal",
    // assumimos que o último pode estar em formação e usamos o penúltimo como fechado.
    if (klinesRaw.length < 210) {
      console.log("[CORE] histórico insuficiente.");
      return;
    }

    const closed = klinesRaw.slice(0, -1); // remove o último (provavelmente em formação)
    const last = closed[closed.length - 1];

    const closes = closed.map(k => k.close);

    const ema50 = ema(closes, EMA_FAST);
    const ema200 = ema(closes, EMA_SLOW);
    const { rsi, prevRsi } = rsiWilder(closes, RSI_LEN);
    const atr = atrWilder(closed, ATR_LEN);

    if (![ema50, ema200, rsi, atr].every(Number.isFinite)) {
      console.log("[CORE] indicadores ainda não prontos.");
      return;
    }

    // Tracker: fechar sinais em aberto com base no candle fechado mais recente
    const state = loadState();
    const closedNow = updateTracker(state, {
      symbol: SYMBOL,
      tf: TF,
      candleHigh: last.high,
      candleLow: last.low,
      candleClose: last.close
    });

    if (closedNow && closedNow.length) {
      for (const s of closedNow) {
        const txt = `*FECHO (CORE)* — ${s.symbol} ${s.tf}\n*Outcome:* ${s.outcome}\nEntry=${fmt(s.entry,2)} | SL=${fmt(s.sl,2)} | TP=${fmt(s.tp,2)}`;
        console.log(txt.replace(/\*/g, ""));
        await sendTelegram(txt);
      }
    }

    // Regime bullish
    const bullish = ema50 > ema200;

    // Pullback perto da EMA50 (band em ATR)
    const distToEma50 = Math.abs(last.close - ema50);
    const nearEma50 = distToEma50 <= PULLBACK_BAND_ATR * atr;

    // RSI em zona de pullback + a subir
    const rsiInBand = rsi >= RSI_MIN && rsi <= RSI_MAX;
    const rsiRising = rsi > prevRsi;

    // Condição final
    const shouldBuy = bullish && nearEma50 && rsiInBand && rsiRising;

    if (!shouldBuy) {
      //console.log("[CORE] sem sinal agora.");
      saveState(state);
      return;
    }

    // Construir sinal
    const entry = roundToTick(last.close);
    const { side, sl, tp, msg } = buildSignal({
      symbol: SYMBOL,
      tf: TF,
      entry,
      atr,
      ema50,
      ema200,
      rsi
    });

    const signalObj = {
      symbol: SYMBOL,
      tf: TF,
      side,
      entry,
      sl,
      tp,
      ts: Date.now(),
      ema50,
      ema200,
      rsi,
      atr
    };

    if (!shouldSendSignal(state, signalObj, COOLDOWN_MINS)) {
      console.log("[CORE] sinal repetido/cooldown — ignorado.");
      saveState(state);
      return;
    }

    console.log(msg);
    await sendTelegram(msg);

    // Persistir
    state.lastSignal[keyFor(SYMBOL, TF)] = { ts: signalObj.ts, side: signalObj.side, entry: signalObj.entry };
    state.openSignals.push(signalObj);
    saveState(state);

  } catch (err) {
    console.log("[ERRO]", err?.message || err);
  }
})();