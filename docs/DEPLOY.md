# Deploying InsightHub (roadmap Phase 6)

How to put InsightHub on one VPS and switch on reporting from Education Enlightened. The decisions
behind this are D17, D25 and D28. Steps marked **owner** need accounts or approvals only the owner has.

## What runs where

| Where | What |
| --- | --- |
| **VPS** (docker compose) | Caddy (TLS), backend API, processor, Kafka + Zookeeper, Postgres/TimescaleDB, dashboard. ML engine only with `--profile ml` (off by default) |
| **Vercel** | Education Enlightened API (`enlightened-sy-api.vercel.app`), server reporter inside it |
| **Cloudflare Pages** | Education Enlightened website (`enlightened-sy.pages.dev`), built by GitHub Actions, browser reporter inside it |

Public names: `api.<DOMAIN>` (the API) and `app.<DOMAIN>` (the dashboard). Both must be under the same
registrable domain over https, because the session cookie is `__Host-ih_session` with `SameSite=Strict`.

## 1. Before you start (owner)

- A VPS: 2 vCPU / 4 GB RAM / 40 GB disk is plenty to start (Kafka and Postgres are the heavy parts).
  Ubuntu 24.04 LTS.
- A domain, with two DNS **A records** (`api.<DOMAIN>` and `app.<DOMAIN>`) pointing at the VPS's IP.
- An email address for certificate expiry notices (`ACME_EMAIL`).

## 2. Harden the server

```bash
# As root, once:
adduser --disabled-password deploy && usermod -aG sudo,docker deploy   # after installing Docker below
# SSH: keys only, no root login. In /etc/ssh/sshd_config:
#   PasswordAuthentication no
#   PermitRootLogin no
systemctl reload ssh

apt update && apt install -y ufw unattended-upgrades
ufw default deny incoming && ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw enable
dpkg-reconfigure -plow unattended-upgrades
```

Install Docker Engine and the compose plugin from Docker's official apt repository (docs.docker.com).
**Docker bypasses ufw for published ports**, which is why only Caddy publishes any (80/443). The production
override removes every other published port. Check it in step 4.

## 3. Get the code and configure

```bash
sudo mkdir -p /opt/insighthub && sudo chown deploy /opt/insighthub
git clone <repo> /opt/insighthub && cd /opt/insighthub && git checkout main
cp .env.example .env && chmod 600 .env
```

Fill in `.env` (never commit it, never paste it into chat):

| Variable | Value |
| --- | --- |
| `POSTGRES_PASSWORD` | `openssl rand -base64 24` |
| `DOMAIN` | e.g. `insighthub.example.org` (no `api.`/`app.` prefix) |
| `ACME_EMAIL` | the owner's address for certificate notices |

`backend/.env` and `processor-service/.env` aren't needed on the server: compose passes everything.
Leave `SERVICE_TOKEN` unset, so the legacy `/api/logs` stays off.

## 4. Start and check

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps        # all running; processor "healthy"
```

The first start creates the database schema (both SQL files run once, on the empty volume) and Caddy
gets the certificates.

Checks:
```bash
curl -s https://api.<DOMAIN>/health                       # {"status":"ok"}
curl -sI https://app.<DOMAIN>/login | grep -i strict-transport
docker compose exec processor node -e "fetch('http://127.0.0.1:9100/health').then(async r=>console.log(r.status, await r.text()))"
# From another machine: only 22, 80 and 443 may be open.
nmap -Pn -p 1-65535 <VPS-IP>
```

## 5. Users and keys

First apply the database migrations (safe to repeat):

```bash
docker compose exec backend node scripts/migrate.js
```

Then:

```bash
docker compose exec -it backend node scripts/create-user.js --email <owner email> --role admin   # asks for the password
docker compose exec backend node scripts/create-key.js --project education-enlightened --kind secret
docker compose exec backend node scripts/create-key.js --project education-enlightened --kind public \
  --origin https://enlightened-sy.pages.dev
```

Each key is printed **once**: put it straight into the place in step 6 and nowhere else. Add the real site
domain as another `--origin` (a new public key) once it's attached.

## 6. Switch on reporting (owner; staged)

1. **Merge** Education Enlightened's `feature/insighthub-hardening` into `v3` (scrubbing fixes, D75 there).
2. **Server reporter first.** In Vercel (Education Enlightened API project), set `INSIGHTHUB_URL=https://api.<DOMAIN>`
   and `INSIGHTHUB_SECRET_KEY=<ih_sk_…>`, then **redeploy**: env changes only apply to new deployments.
3. Watch for **24 h**: dashboard issues, the processor's `/metrics`, and the API logs.
4. **Browser reporter.** Set GitHub repository variables `VITE_INSIGHTHUB_URL=https://api.<DOMAIN>` and
   `VITE_INSIGHTHUB_KEY=<ih_pk_…>`, then run a **new release** (the values are baked in at build time).

**Done when:** a real 500 from Education Enlightened appears on the dashboard with nothing personal in it,
and the processor's `/health` stays `ok`.

## 7. Backups

```bash
sudo cp deploy/backup.sh /usr/local/sbin/insighthub-backup && sudo chmod 700 /usr/local/sbin/insighthub-backup
echo '15 3 * * * root COMPOSE_DIR=/opt/insighthub /usr/local/sbin/insighthub-backup >> /var/log/insighthub-backup.log 2>&1' \
  | sudo tee /etc/cron.d/insighthub-backup
```

Dumps go to `/var/backups/insighthub` (root-only, 14 days kept). Restoring is described at the top of
`deploy/backup.sh`, and was tested on 2026-10-23. Copy the dumps off the server too (provider snapshots
or object storage). A backup on the same disk doesn't survive losing the server.

## Updating

```bash
cd /opt/insighthub && git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

New SQL migrations don't run automatically. After every update run:

```bash
docker compose exec backend node scripts/migrate.js   # applies only what is new
```

Changing `DOMAIN` means rebuilding the dashboard image (`--build`), because its API URL is baked in.
