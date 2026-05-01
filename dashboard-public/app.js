let equityChart = null;

async function loadData() {
  const res = await fetch("/api/public-state");
  const data = await res.json();

  document.getElementById("balance").innerText =
    data.balance.toFixed(2) + " USDC";

  document.getElementById("pnl").innerText =
    (data.profit >= 0 ? "+" : "") +
    data.profit.toFixed(2) +
    " USDC";

  document.getElementById("winrate").innerText =
    data.winRate.toFixed(1) + "%";

  // Equity chart
  const ctx = document.getElementById("equityChart").getContext("2d");

  if (equityChart) {
    equityChart.data.labels = data.equityHistory.map((_, i) => i + 1);
    equityChart.data.datasets[0].data = data.equityHistory;
    equityChart.update();
  } else {
    equityChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: data.equityHistory.map((_, i) => i + 1),
        datasets: [
          {
            label: "Equity",
            data: data.equityHistory,
            borderColor: "#4cafef",
            borderWidth: 2,
            fill: false,
          },
        ],
      },
      options: {
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: { display: false },
        },
      },
    });
  }

  // Open trades
  const openTable = document.getElementById("openTrades");
  openTable.innerHTML = "";
  data.openTrades.forEach(t => {
    const row = openTable.insertRow();
    row.insertCell().innerText = t.symbol;
    row.insertCell().innerText = t.side;
    row.insertCell().innerText = t.entry?.toFixed(4);
    row.insertCell().innerText = t.tp?.toFixed(4);
    row.insertCell().innerText = t.sl?.toFixed(4);
  });

  // Closed trades
  const closedTable = document.getElementById("closedTrades");
  closedTable.innerHTML = "";
  data.recentClosed.forEach(t => {
    const row = closedTable.insertRow();
    row.insertCell().innerText = t.symbol;
    row.insertCell().innerText = t.outcome;
    row.insertCell().innerText =
      (t.pnlPct >= 0 ? "+" : "") +
      Number(t.pnlPct || 0).toFixed(2) +
      "%";
  });
}

setInterval(loadData, 3000);
loadData();

async function loadData() {
  try {
    const res = await fetch("/api/public-state");
    const data = await res.json();

    document.getElementById("balance").innerText =
      data.balance.toFixed(2) + " USDC";

    document.getElementById("pnl").innerText =
      (data.profit >= 0 ? "+" : "") +
      data.profit.toFixed(2) +
      " %";

    document.getElementById("winrate").innerText =
      data.winRate.toFixed(1) + "%";

    // Open trades
    const openTable = document.getElementById("openTrades");
    openTable.innerHTML = "";
    data.openTrades.forEach(t => {
      const row = openTable.insertRow();
      row.insertCell().innerText = t.symbol;
      row.insertCell().innerText = t.side;
      row.insertCell().innerText = t.entry?.toFixed(4);
      row.insertCell().innerText = t.tp?.toFixed(4);
      row.insertCell().innerText = t.sl?.toFixed(4);
    });

    // Closed trades
    const closedTable = document.getElementById("closedTrades");
    closedTable.innerHTML = "";
    data.recentClosed.forEach(t => {
      const row = closedTable.insertRow();
      row.insertCell().innerText = t.symbol;
      row.insertCell().innerText = t.outcome;
      row.insertCell().innerText =
        (t.pnlPct >= 0 ? "+" : "") +
        Number(t.pnlPct || 0).toFixed(2) +
        "%";
    });

  } catch (err) {
    console.error("Erro a carregar dashboard:", err);
  }
}

setInterval(loadData, 3000);
loadData();