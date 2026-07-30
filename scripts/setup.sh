#!/usr/bin/env bash
#
# v7.11: Markec AI Firm — Setup Script
# ============================================================================
# Avtomatizira začetno nastavitev projekta za nove uporabnike:
#   1. Preveri zahtevane odvisnosti (bun, node)
#   2. Ustvari .env iz .env.example (če ne obstaja)
#   3. Generira APP_API_KEY (če je prazen)
#   4. Generira TELEGRAM_WEBHOOK_SECRET in MONITOR_CRON_KEY (če sta prazna)
#   5. Namesti odvisnosti (bun install)
#   6. Generira Prisma client + ustvari bazo (db:push)
#   7. Prikaže povzetek konfiguracije
#
# UPORABA:
#   bun run setup
#   # ali: bash scripts/setup.sh
# ============================================================================

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}ℹ${NC}  $1"; }
ok()    { echo -e "${GREEN}✓${NC}  $1"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $1"; }
err()   { echo -e "${RED}✗${NC}  $1"; }
header(){ echo -e "\n${BOLD}$1${NC}\n"; }

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

header "🚀 Markec AI Firm — Setup (v7.11)"

# ===== 1. Preveri odvisnosti =====
header "📋 1. Preverjanje odvisnosti"

if command -v bun &>/dev/null; then
  BUN_VER=$(bun --version)
  ok "Bun: $BUN_VER"
else
  err "Bun ni nameščen. Namesti z: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

if command -v node &>/dev/null; then
  NODE_VER=$(node --version)
  ok "Node.js: $NODE_VER"
else
  warn "Node.js ni nameščen (priporočeno za nekatere operacije)"
fi

# ===== 2. Ustvari .env =====
header "⚙️  2. Konfiguracija .env"

if [ ! -f ".env" ]; then
  info ".env ne obstaja — ustvarjam iz .env.example..."
  cp .env.example .env
  ok ".env ustvarjen"
else
  ok ".env že obstaja"
fi

# ===== 3. Generiraj APP_API_KEY =====
info "Preverjam APP_API_KEY..."

if grep -q '^APP_API_KEY=""$' .env 2>/dev/null || ! grep -q '^APP_API_KEY=' .env 2>/dev/null; then
  KEY=$(openssl rand -hex 32)
  if grep -q '^APP_API_KEY=' .env 2>/dev/null; then
    sed -i "s|^APP_API_KEY=.*|APP_API_KEY=\"$KEY\"|" .env
  else
    echo "APP_API_KEY=\"$KEY\"" >> .env
  fi
  ok "APP_API_KEY generiran: ${KEY:0:8}...${KEY: -8}"
  warn "Shrani ta ključ! Potrebuješ ga za prijavo v aplikacijo."
else
  ok "APP_API_KEY je že nastavljen"
fi

# ===== 4. Generiraj TELEGRAM_WEBHOOK_SECRET =====
info "Preverjam TELEGRAM_WEBHOOK_SECRET..."

if grep -q '^TELEGRAM_WEBHOOK_SECRET=""$' .env 2>/dev/null || ! grep -q '^TELEGRAM_WEBHOOK_SECRET=' .env 2>/dev/null; then
  SECRET=$(openssl rand -hex 16)
  if grep -q '^TELEGRAM_WEBHOOK_SECRET=' .env 2>/dev/null; then
    sed -i "s|^TELEGRAM_WEBHOOK_SECRET=.*|TELEGRAM_WEBHOOK_SECRET=\"$SECRET\"|" .env
  else
    echo "TELEGRAM_WEBHOOK_SECRET=\"$SECRET\"" >> .env
  fi
  ok "TELEGRAM_WEBHOOK_SECRET generiran"
else
  ok "TELEGRAM_WEBHOOK_SECRET je že nastavljen"
fi

# ===== 5. Generiraj MONITOR_CRON_KEY =====
info "Preverjam MONITOR_CRON_KEY..."

if grep -q '^MONITOR_CRON_KEY=""$' .env 2>/dev/null || ! grep -q '^MONITOR_CRON_KEY=' .env 2>/dev/null; then
  CRON_KEY=$(openssl rand -hex 16)
  if grep -q '^MONITOR_CRON_KEY=' .env 2>/dev/null; then
    sed -i "s|^MONITOR_CRON_KEY=.*|MONITOR_CRON_KEY=\"$CRON_KEY\"|" .env
  else
    echo "MONITOR_CRON_KEY=\"$CRON_KEY\"" >> .env
  fi
  ok "MONITOR_CRON_KEY generiran"
else
  ok "MONITOR_CRON_KEY je že nastavljen"
fi

# ===== 6. Namesti odvisnosti =====
header "📦 3. Namestitev odvisnosti"

if [ ! -d "node_modules" ]; then
  info "Nameščam odvisnosti (bun install)..."
  bun install
  ok "Odvisnosti nameščene"
else
  ok "node_modules že obstaja (preskakujem — poženi 'bun install' za update)"
fi

# ===== 7. Prisma =====
header "🗄️  4. Priprava baze"

info "Generiram Prisma client..."
bun run db:generate
ok "Prisma client generiran"

info "Ustvarjam/posodabljam bazo (db:push)..."
bun run db:push
ok "Baza pripravljena"

# ===== 8. Povzetek =====
header "📊 5. Povzetek konfiguracije"

echo ""
echo -e "${BOLD}Database:${NC}"
grep '^DATABASE_URL=' .env | head -1

echo ""
echo -e "${BOLD}Avtentikacija:${NC}"
if grep -q '^APP_API_KEY=""$' .env 2>/dev/null; then
  warn "APP_API_KEY: PRAZEN (avtentikacija izklopljena — samo za dev)"
else
  KEY=$(grep '^APP_API_KEY=' .env | head -1 | sed 's/.*="\(.*\)"/\1/')
  ok "APP_API_KEY: ${KEY:0:8}...${KEY: -8}"
fi

echo ""
echo -e "${BOLD}AI Provider:${NC}"
grep '^AI_PROVIDER=' .env | head -1
grep '^AI_MODEL=' .env | head -1

echo ""
echo -e "${BOLD}Notifikacije:${NC}"
grep '^TELEGRAM_BOT_TOKEN=' .env | head -1 | sed 's/=.*/=: ***/' || echo "TELEGRAM: ni nastavljen"
grep '^DISCORD_WEBHOOK_URL=' .env | head -1 | sed 's/=.*/=: ***/' || echo "DISCORD: ni nastavljen"

echo ""
echo -e "${BOLD}Cron:${NC}"
CRON_KEY=$(grep '^MONITOR_CRON_KEY=' .env | head -1 | sed 's/.*="\(.*\)"/\1/')
if [ -n "$CRON_KEY" ] && [ "$CRON_KEY" != '""' ]; then
  ok "MONITOR_CRON_KEY: ${CRON_KEY:0:8}..."
  echo "  Cron URL: curl -X POST 'http://localhost:3000/api/cron/run-all?key=$CRON_KEY'"
else
  warn "MONITOR_CRON_KEY: PRAZEN (cron brez avtentikacije)"
fi

# ===== Naslednji koraki =====
header "✅ Setup končan!"

echo -e "${GREEN}${BOLD}Naslednji koraki:${NC}"
echo ""
echo "  1. ${BOLD}Zaženi aplikacijo:${NC}"
echo "     bun run dev"
echo ""
echo "  2. ${BOLD}Odpri v brskalniku:${NC}"
echo "     http://localhost:3000"
echo ""
echo "  3. ${BOLD}Konfiguriraj AI provider:${NC}"
echo "     Pojdi v Settings → AI Provider"
echo "     (Ollama: http://localhost:11434, model: qwen2.5:7b)"
echo ""
echo "  4. ${BOLD}Dodaj monitor:${NC}"
echo "     Pojdi v Monitorji → Nov monitor (ali uporabi predloge)"
echo ""
echo "  5. ${BOLD}Aktiviraj cron (avtomatsko iskanje):${NC}"
echo "     crontab -e"
echo "     */15 * * * * curl -sS 'http://localhost:3000/api/cron/run-all?key=$CRON_KEY' > /dev/null"
echo ""
echo -e "${YELLOW}⚠️  VARNOST:${NC}"
echo "  - APP_API_KEY je v .env — ne commit-aj v git!"
echo "  - Preveri .gitignore vsebuje .env"
echo "  - Za production: nastavi HTTPS in APP_API_KEY"
echo ""
