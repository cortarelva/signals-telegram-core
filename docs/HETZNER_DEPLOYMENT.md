# Hetzner Deployment

## Goal

Run `TorusAiTrading` on a Hetzner Ubuntu server instead of a personal computer, with:

- the bot loop as a dedicated `systemd` service
- the dashboard as a separate `systemd` service
- the dashboard bound only to `127.0.0.1`
- the live `.env` stored only on the server

## Recommended server

- Ubuntu 24.04
- 2 vCPU
- 4 GB RAM
- 40 GB SSD or higher

This is enough for:

- bot runtime
- local dashboard
- logs
- SQLite mirror
- light research and maintenance

## Suggested server layout

- project dir: `/opt/TorusAiTrading`
- service user: `torus`
- dashboard access: SSH tunnel or authenticated reverse proxy

## Security rules

- do not expose the dashboard directly to the public internet without auth
- keep `DASHBOARD_HOST=127.0.0.1`
- keep API keys only in the server `.env`
- if Binance API IP whitelist is enabled, add the Hetzner public IP before starting live mode

## Files prepared for deployment

- bootstrap script:
  - [`/Users/joel/Documents/CoddingStuff/TorusAiTrading/deploy/hetzner/install-runtime.sh`](/Users/joel/Documents/CoddingStuff/TorusAiTrading/deploy/hetzner/install-runtime.sh)
- production env template:
  - [`/Users/joel/Documents/CoddingStuff/TorusAiTrading/deploy/hetzner/env.production.example`](/Users/joel/Documents/CoddingStuff/TorusAiTrading/deploy/hetzner/env.production.example)
- bot service:
  - [`/Users/joel/Documents/CoddingStuff/TorusAiTrading/deploy/hetzner/systemd/torus-ai-trading-bot.service`](/Users/joel/Documents/CoddingStuff/TorusAiTrading/deploy/hetzner/systemd/torus-ai-trading-bot.service)
- dashboard service:
  - [`/Users/joel/Documents/CoddingStuff/TorusAiTrading/deploy/hetzner/systemd/torus-ai-trading-dashboard.service`](/Users/joel/Documents/CoddingStuff/TorusAiTrading/deploy/hetzner/systemd/torus-ai-trading-dashboard.service)

## Deployment sequence

1. Create the server in Hetzner.
2. Create a non-root user, for example `torus`.
3. Clone the repository into `/opt/TorusAiTrading`.
4. Run the bootstrap script:

```bash
cd /opt/TorusAiTrading
bash deploy/hetzner/install-runtime.sh
```

5. Copy your real `.env` to `/opt/TorusAiTrading/.env`.
6. Review the env carefully. Start in `EXECUTION_MODE=paper` first.
7. Install the systemd service files:

```bash
sudo cp deploy/hetzner/systemd/torus-ai-trading-bot.service /etc/systemd/system/
sudo cp deploy/hetzner/systemd/torus-ai-trading-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable torus-ai-trading-bot.service
sudo systemctl enable torus-ai-trading-dashboard.service
sudo systemctl start torus-ai-trading-bot.service
sudo systemctl start torus-ai-trading-dashboard.service
```

8. Check service health:

```bash
sudo systemctl status torus-ai-trading-bot.service
sudo systemctl status torus-ai-trading-dashboard.service
journalctl -u torus-ai-trading-bot.service -n 100 --no-pager
journalctl -u torus-ai-trading-dashboard.service -n 100 --no-pager
```

## Dashboard access

Default recommendation: use an SSH tunnel from your local machine:

```bash
ssh -L 3002:127.0.0.1:3002 torus@YOUR_SERVER_IP
```

Then open:

- [http://127.0.0.1:3002](http://127.0.0.1:3002)

## Live migration checklist

Before switching from local runtime to Hetzner live runtime:

- confirm there are no open positions
- confirm Binance API keys work from the server IP
- confirm Telegram notifications work
- confirm dashboard works through the SSH tunnel
- confirm `runtime/state.json`, `runtime/orders-log.json`, and `runtime/runtime-store.sqlite` are writable
- confirm the server clock is correct

## What I will need for the real deployment

To perform the actual deployment on the Hetzner server, I will need:

- SSH host or IP
- SSH username
- authentication method:
  - preferred: SSH key already loaded on your machine
  - acceptable: password if that is how the server is configured

I do not need your Hetzner console password if SSH access is already available.
