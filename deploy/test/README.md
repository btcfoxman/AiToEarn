# AiToEarn test deployment

This directory contains the 192.168.3.6 test deployment assets.

## Server layout

- Runner: `/home/btcfoxman/actions-runners/repo-aitoearn`
- App: `/home/btcfoxman/docker/aitoearn`
- URL: `http://192.168.3.6:8081`
- Runner labels: `repo-aitoearn`, `aitoearn-test`

## One-time host setup

Run on 192.168.3.6 as root from a repository checkout:

```bash
sudo bash deploy/test/prepare-aitoearn-host.sh
sudo bash deploy/test/configure-aitoearn-runner.sh <github-runner-token>
```

Create `/home/btcfoxman/docker/aitoearn/.env` from `.env.example` and fill real secrets.

## Manual deploy

```bash
bash deploy/test/deploy.sh
```

## Runtime checks

```bash
cd /home/btcfoxman/docker/aitoearn
docker compose ps
curl -f http://127.0.0.1:8081/_nhealth
docker compose logs -f --tail=200
```
