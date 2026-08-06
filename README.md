# Markec AI Firm — AI Trading Firm za slovenske oglase

[![Version](https://img.shields.io/badge/version-v7.61.0-blue.svg)](./CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/markec12345678/markecaifirm?style=social)](https://github.com/markec12345678/markecaifirm/stargazers)
[![AI Endpoints](https://img.shields.io/badge/AI%20endpoints-287-green.svg)](./AI_ENDPOINTS.md)
[![API Routes](https://img.shields.io/badge/API%20routes-422-cyan.svg)](#)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org/)
[![TypeScript Errors](https://img.shields.io/badge/TS%20errors-0-brightgreen.svg)](#)
[![Vulnerabilities](https://img.shields.io/badge/vulns-0-brightgreen.svg)](#)
[![Tests](https://img.shields.io/badge/tests-37-brightgreen.svg)](#)
[![Prisma](https://img.shields.io/badge/Prisma-6-indigo.svg)](https://www.prisma.io/)
[![Local-First](https://img.shields.io/badge/local-first-purple.svg)](#-local-first--zero-cloud)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

<div align="center">
  <img src="./public/dashboard-preview.png" alt="Markec AI Firm Dashboard Preview" width="100%" />
  <p><em>Glavni dashboard z 17 zavihki, AI insights, real-time alerti in profit pipeline</em></p>
</div>

> **AI-powered trading firm** za Bolha, Facebook Marketplace, Vinted, Avtonet, mobile.de, Kleinanzeigen, Subito in Willhaben.
> **287 AI endpointov** + **30 analytics** + **10 cron automatizacij** + **11 Telegram ukazov** za iskanje, ocenjevanje, kupovanje in preprodajo.
> **Local-first** — vsi podatki ostanejo na tvojem računalniku. **Zero-cloud**. **0 vulnerabilities**. **37 tests**.

---

## 📑 Kazalo

- [Overview](#-overview)
- [Ključne funkcije](#-ključne-funkcije)
- [Tehnologija](#-tehnologija)
- [Hitri začetek](#-hitri-začetek)
- [AI provider konfiguracija](#-ai-provider-konfiguracija)
- [AI funkcije po kategorijah](#-ai-funkcije-po-kategorijah)
- [Local-first & Zero-cloud](#-local-first--zero-cloud)
- [Notifikacije](#-notifikacije)
- [Anti-detection](#-anti-detection)
- [API dokumentacija](#-api-dokumentacija)
- [Development](#-development)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [License](#-license)
- [Changelog](#-changelog)

---

## 🎯 Overview

**Markec AI Firm** je celovit AI sistem za avtomatizirano iskanje, ocenjevanje, kupovanje in preprodajo
oglasev na slovenskih (in srednjeevropskih) oglasnih platformah. Aplikacija teče lokalno na tvojem
računalniku — brez cloud storitev, brez mesečnih naročnin, brez deljenja podatkov z zunanjimi strežniki.

### Čisto v eni povedi
Lovi podcenjene oglase na Bolhi/Facebooku/Vintedu z AI, jih kupi poceni, preprodaj drago z
AI-optimiziranimi oglasi, in avtomatiziraj celoten workflow od odkritja do prodaje.

### Verzija v7.61.0 (avgust 2026)

**287 AI endpointov** + **30 analytics** + **10 cron automatizacij** + **11 Telegram ukazov** + **~108 funkcij** organiziranih v 7 kategorij:
- **Statistike** (analytics, predictions, forecasting) — 35+ funkcij
- **Skladišče** (inventory management, aging, depreciation) — 20+ funkcij
- **Oglasi** (listing optimization, SEO, image analysis) — 25+ funkcij
- **Negotiation** (real-time bot, chatbot, playbook) — 8+ funkcij
- **Buyers/Customers** (segmentation, trust score, matching) — 12+ funkcij
- **Risk/Insurance** (hedging, fraud detection, claims) — 10+ funkcij
- **Finance/Profit** (margin, ROI, compounding, tax) — 16+ funkcij

### Kaj je novega v v7.56–v7.61 (6 verzij, 18 novih funkcij)

**v7.61 — AI Negotiation Script Generator & Inventory Insurance Calculator & AI Photo Enhancement Advisor (3 funkcije):**
- **AI Negotiation Script Generator** — AI generira cel strategia dokument za pogajanje kot kupec (anchoring offer, offer ladder 3-5 korakov, walkaway price, psychological tactics, objection handlers)
- **Inventory Insurance Calculator** — izračun zavarovalnih potreb za HELD inventar z 3 opcijami (BASIC/STANDARD/PREMIUM) glede na category risk (elektronika 1.5×, avto 2.0×, moda 0.5×)
- **AI Photo Enhancement Advisor** — AI svetuje izboljšave fotografij za večjo verjetnost prodaje (osvetlitev, ozadje, kot, kompozicija, staging, retake) z quantified price uplift

**v7.60 — Demand Forecast AI & Margin Guardian Pro & Multi-Platform Listing Generator (3 funkcije):**
- **Demand Forecast AI** — AI napoved katere kategorije bodo v HIGH povpraševanju naslednjih 30 dni (sell-through + trend + sezonskost + anti-hallucination)
- **Margin Guardian Pro** — real-time margin monitoring za HELD inventar z AI pricing priporočili (carrying cost, breakeven, urgency)
- **Multi-Platform Listing Generator** — AI generira optimizirane oglase za 5 platform hkrati (Bolha, Vinted, FB, mobile.de, Kleinanzeigen) z različnimi SEO/title/tags/price

**v7.59 — Tveganje & CRM & paketiranje (3 funkcije):**
- **Portfolio Stress Test** — kaj če trg pade 30%? Simulacija MILD/MODERATE/SEVERE scenarijev
- **Supplier Relationship Manager (CRM)** — trust tiers (PLATINUM/GOLD/SILVER/BRONZE) za stalne dobavitelje
- **Bundle Profit Optimizer** — AI paketi za cross-sell (PS5 + controller + igra = višji profit)

**v7.58 — Optimizacija virov & sledenje oglasom & avtomatska ponovna objava (3 funkcije):**
- **Deal Source ROI Analyzer** — kateri vir nakupa (Bolha/Vinted/FB) daje najboljši ROI
- **Listing Performance Tracker** — staleScore + status (FRESH→DEAD) za held inventar
- **Auto-Relisting Scheduler** — AI generira full relisting plan (platform, title, price, timing)

**v7.57 — Davčna poročila & reinvesticije & konkurenčna obveščenost (3 funkcije):**
- **Tax Report Generator** — letno davčno poročilo v slovenskem formatu (FURS-ready, 5000€ neoporečno, 40% dohodnina, 3y loss carryforward)
- **Reinvestment Advisor** — kam reinvestirati dobiček glede na ROI leaderboard
- **Competitor Listing Tracker** — sledi supplier-jem (SUPPLIER/ONE_TIME/WATCHED)

**v7.56 — Niche discovery & listing visibility & compounding (3 funkcije):**
- **Market Gap Finder** — prazne niše z visokim povpraševanjem (gapScore = demand/supply)
- **Listing Refresh Scheduler** — kdaj in kako osvežiti oglase za max vidljivost
- **Profit Maximizer v2** — ML compounding projekcija (3 scenariji, 24-mesečna)

**🔥 Prejšnje verzije (v7.50–v7.55):**
- v7.55: ROI Leaderboard, Negotiation Outcome Predictor, Liquidation Strategist
- v7.54: Missed Opportunity Tracker, Conversation Memory, Optimal Listing Time
- v7.53: AI Output Cache (6h), Batch Deal Evaluator (50 oglasov/klic), Smart Notification Router
- v7.52: Anti-Hallucination Layer (5 slojev — prompt grounding, numeric sanity, cross-reference, confidence threshold, pattern detection)
- v7.51: Cash Flow Forecaster, Search Keyword Optimizer, Purchase Pattern
- v7.50: Weekly Trend Radar, Risk Spread Calculator, Quick Sell Ladder

**🔒 Varnostni popravki (v6.92.1):**
- API avtentikacija (APP_API_KEY, middleware)
- SSRF zaščita (lib/url-safety.ts)
- Email XSS fix (HTML escape)
- Slack Block Kit fix (mrkdwn_section → mrkdwn)
- Telegram MarkdownV2 + 429 rate-limit handling
- CI fix (continue-on-error odstranjen)
- Next.js config fix (ignoreBuildErrors: false, reactStrictMode: true)

**🧹 Čiščenje (v6.93):**
- -265.615 vrstic smeti (skills/, comp/idea/search JSON, mrtva koda)
- webhook-engine priklopljen na pipeline (5 eventov)
- smart-push priklopljen (priority batching)

**⚡ Performanse (v6.94):**
- ~83% manj JS na prvem loadu (next/dynamic lazy-load)

**🔧 Refactoring (v6.95-v6.99):**
- ListingDetailModal razbit z 4070 na ~2227 vrstic (−45%)
- 6 podkomponent izvlečenih (SentimentPanel, AuctionSniperPanel, FraudDetectionPanel, ImageAnalysisPanel, NegotiationPanel, ListingActionsBar)

**Aplikacija sedaj ima 17 zavihkov z 55+ AI funkcijami** z keyboard shortcuts:
`1-9/0` (osnovni), `b` (kupci), `a` (AI Hub), `i` (skladišče AI), `p` (cene AI), `l` (oglasi AI), `r` (tveganja AI)

▶️ Glej [CHANGELOG.md](./CHANGELOG.md) za popolno zgodovino v1.0 → v7.61. Za starejše verzije (v1.0–v6.x) glej [ARCHIVE.md](./ARCHIVE.md).

---

## 🚀 Ključne funkcije

### 📱 17 zavihkov v aplikaciji

| # | Zavihek | Shortcut | Kaj |
|---|---|---|---|
| 1 | Dashboard | `1` | Pregled aktivnosti, statistike, AI insights |
| 2 | Monitorji | `2` | Upravljanje iskalnih monitorjev (10 virov) |
| 3 | Alerti | `3` | Real-time alerti (SSE) z AI verdict |
| 4 | Oglasi | `4` | Brskanje po najdenih oglasih z AI analizo |
| 5 | Watchlist | `5` | Priljubljeni oglasi z target price |
| 6 | Skladišče | `6` | Trade management (buy/sell, ROI) |
| 7 | **Skladišče AI** | `i` | AI: 10 funkcij (aging, stockout, shrinkage, liquidation, rebalancer, capital, carrying, depreciation, growth, health) |
| 8 | **Cene AI** | `p` | AI: 10 funkcij (smart-pricing, forecast, margin, price-war, seasonal, dashboard, playbook, reserve, psychology, geo) |
| 9 | **Oglasi AI** | `l` | AI: 10 funkcij (image-gen, desc-gen, SEO, virality, CTR, title, tag, thumbnail, social-proof, refresh) |
| 10 | **Tveganja AI** | `r` | AI: 10 funkcij (hedging, insurance, saturation, parity, guardian, claim, anomalies, inv-risk, quality-pred, quality-agg) |
| 11 | **Kupci** | `b` | AI: 10 funkcij (persona, trust, journey, review, lifecycle, matchmaker, CLV, churn, intent, conversion) |
| 12 | Analitika | `7` | Arbitraža, trendi, sezonski vzorci |
| 13 | Statistike | `8` | 23 AI funkcij: budget, forecast, rebalance... |
| 14 | Obvestila | `9` | Zgodovina notifikacij |
| 15 | Zdravje | `0` | Sistemski health, scraper stats |
| 16 | Nastavitve | — | AI provider, Telegram, Discord, Email, Push... |
| 17 | **AI Hub** | `a` | Vsi 287 AI endpointov z iskalnikom in runner-jem |

### 🔍 Iskanje & odkrivanje
- Multi-platform monitoring (Bolha, Facebook, Vinted, Avtonet, Kleinanzeigen, eBay, poljuben RSS)
- AI Deal Score 0-100 z reasoning
- Reverse image search za odkrivanje stock photos
- Multi-image quality assessment z VLM
- Fake detection in fraud detection
- Real-time auction sniper v2 z ML timing

### 🧠 AI analiza & ocenjevanje
- AI Score 1-10 + Risk Score 1-10
- AI Estimated Value (EUR) — koliko je item res vreden
- AI Verdict: PRILIKA / SUMNJIVO / NEZANIMIVO
- Multi-image VLM analiza (AUTHENTIC / SUSPICIOUS / STOCK_PHOTO)
- Profit Margin Predictor (pred-nakupna analiza)
- Profit Cycle Optimizer z 12m/24m/36m compounding

### 💼 Trade management
- Buy/sell tracking z automatic margin calculation
- Inventory aging predictor z depreciation curve (4 tipi)
- Inventory lifecycle, health monitor, stockout prevention
- Cross-border arbitrage detection
- Bulk listing generator za 5 platform hkrati

### 🤝 Negotiation & buyers
- Real-time negotiation bot z 10 taktikami
- Buyer trust score (platinum→scammer, 6 levelov)
- Buyer matchmaker v2 z ML matching (8 faktorjev)
- Customer segmentation (RFM analiza, 5 segmentov)
- Cross-sell recommender (8 strategij)
- Buyer persona generator

### 📈 Pricing & listing
- Smart pricing engine z A/B testing
- Listing SEO optimizer per platforma (Bolha/Facebook/Vinted)
- Listing image optimizer z VLM (8 quality faktorjev)
- Reserve price optimizer za dražbe
- Price war strategist (defensive/offensive)
- Seasonal bundle packager

### 🛡️ Risk management
- Risk hedging (8 strategij)
- Insurance optimizer v2 z 4D risk matriko
- Fraud detection in fake listing detection
- Margin guardian (avtomatski margin alerts)
- Tax loss harvesting

### 📊 Analytics & dashboards
- Master Dashboard z health score
- Profit forecast in monthly reports
- Performance benchmarks
- Continuous learning sistem
- Daily summary digest

### 🔔 Notifikacije (5 kanalov)
- **Telegram** z inline buttons in webhook support
- **Discord** webhook z rich embeds
- **Slack** webhook
- **Email** SMTP
- **Web Push** (VAPID) — mobile/desktop push notifications

### 🕵️ Anti-detection (9 tehnik — v7.40 maximal)
- **Cookie jar** — per-domain session affinity (Cloudflare cf_clearance persistence)
- **429 retry** — exponential backoff + jitter + UA rotation (max 3 retries)
- **Platform-specific Referer** headers (Bolha, mobile.de, Kleinanzeigen, etc.)
- **Gaussian delay** — Box-Muller transform (bolj človeška distribucija)
- **12 User-Agent strings** — Chrome/Firefox/Safari/Edge × Win/Mac/Linux
- **Per-domain session** — isti UA + cookies per domain (naravno)
- **Proxy rotation** (HTTP/SOCKS5 z undici ProxyAgent)
- **CAPTCHA solving** (2captcha, anti-captcha, capmonster)
- **Scraper Auto-Recovery** — avtomatski Playwright fallback pri napakah

---

## 🛠️ Tehnologija

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 16 (App Router) |
| **Language** | TypeScript 5 (strict mode) |
| **Styling** | Tailwind CSS 4 + shadcn/ui |
| **Database** | Prisma 6 + SQLite (local-first) |
| **AI providers** | Ollama, OpenAI, Anthropic, OpenRouter, Gemini, OpenAI-compatible |
| **Scraping** | cheerio (HTML), native fetch (RSS), Playwright (fallback) |
| **Notifications** | Telegram Bot API, Discord/Slack webhooks, SMTP, Web Push (VAPID) |
| **Anti-detection** | Cookie jar, 429 retry, Referer, Gaussian delay, 12 UAs, Proxy rotation, CAPTCHA solver, Auto-Recovery |
| **Security** | AES-256-GCM secrets encryption, Rate limiting (20 AI/min/IP), SSRF protection |
| **Testing** | Vitest (37 tests), structured logger, try/catch na vseh API routes |
| **Runtime** | Bun (priporočeno) ali Node.js 20+ |
| **CI/CD** | GitHub Actions (lint, typecheck, tests, audit) |

---

## ⚡ Hitri začetek

### Zahteve
- Node.js >= 20.0.0 ali Bun >= 1.0.0
- 4GB RAM (za lokalne AI modele)
- ~500MB prostora

### 1. Inštalacija

```bash
git clone https://github.com/markec12345678/markecaifirm.git
cd markecaifirm

# 🚀 Hitri setup (avtomatizirano — ustvari .env, generira ključe, namesti bazo)
bun run setup

# Ali ročno:
bun install
bun run db:generate
bun run db:push
bun run dev

# Ali z npm/node
npm install
npx prisma generate
npx prisma db push
npm run dev
```

Aplikacija teče na **http://localhost:3000**

### 2. Konfiguracija AI

Odpri **http://localhost:3000/settings** in nastavi:

#### Opcija A: Ollama (lokalno, brezplačno, priporočeno)
```bash
# Inštaliraj Ollama: https://ollama.com
ollama pull qwen2.5:7b  # ali llama3.1:8b, mistral:7b
# Ollama teče na http://localhost:11434
```
V Settings: Provider=Ollama, BaseURL=http://localhost:11434, Model=qwen2.5:7b

#### Opcija B: OpenAI
```bash
# Set API key v Settings UI
# Provider=OpenAI, Model=gpt-4o-mini (ali gpt-4o)
```

#### Opcija C: Anthropic Claude
```bash
# Provider=Anthropic, Model=claude-3-5-sonnet-20241022
```

#### Opcija D: OpenRouter (dostop do več modelov)
```bash
# Provider=OpenRouter, Model=anthropic/claude-3.5-sonnet
```

### 3. Nastavi monitoring

1. Pojdi na **http://localhost:3000**
2. Ustvari nov monitor (npr. "iPhone 13 Bolha")
3. Nastavi iskalni URL na Bolhi
4. Nastavi AI score threshold (default: 7/10)
5. (Opcija) Nastavi Telegram bot za real-time alerts

### 4. Aktiviraj cron (avtomatsko iskanje)

```bash
# Linux cron (vsakih 15 min)
*/15 * * * * curl -s "http://localhost:3000/api/cron/run-all?key=$MONITOR_CRON_KEY"

# Ali Windows Task Scheduler z enakim URL
```

---

## 🤖 AI provider konfiguracija

Aplikacija podpira **6 AI providerjev** z **fallback sistemom**:

| Provider | Models | Pricing | Best for |
|----------|--------|---------|----------|
| **Ollama** | qwen2.5:7b, llama3.1:8b, mistral:7b | Brezplačno | Lokalna slovenščina, zero-cloud |
| **OpenAI** | gpt-4o, gpt-4o-mini, gpt-3.5-turbo | $0.15-5/1M tokens | Najboljša kvaliteta |
| **Anthropic** | claude-3.5-sonnet, claude-3-opus | $0.25-15/1M tokens | Long context, reasoning |
| **OpenRouter** | 200+ models prek enega API | Različno | Fleksibilnost |
| **Gemini** | gemini-1.5-pro, gemini-1.5-flash | Brezplačno (z limiti) | Multimodal, spletni podatki |
| **OpenAI-compatible** | poljuben | Različno | Local LLM (vLLM, LM Studio) |

### Fallback sistem
```typescript
// v Settings: Nastavi primary + fallback
// Če primary odpove, avtomatsko preklopi na fallback
const aiSettings = {
  provider: 'openai',
  fallbackProvider: 'ollama',  // backup
};
```

### AI usage tracking
Vsak AI klic je zabeležen v bazi (`aiCallsToday`, `aiCallsDate`).
Dnevni reset ob polnoči.

---

## 📚 AI funkcije po kategorijah

### 📊 Statistike (35+ funkcij)
- **Anomaly detection** — AI sam odkriva trende in anomalije
- **Daily summary** — dnevni povzetek aktivnosti
- **Demand forecast** — napoved povpraševanja po kategorijah
- **Depreciation forecast** — napoved padca vrednosti
- **Market trends** — trendi v kategorijah
- **Market saturation** — nasičenost trga
- **Performance forecaster** — napoved performance
- **Profit forecast** — napoved dobička
- **Profit dashboard** — centralni dashboard
- **Trend predictions** — trendi za naslednje tedne
- ...in 25+ več

### 📦 Skladišče (20+ funkcij)
- **Inventory aging** — sledi staranju inventarja (7 faz)
- **Inventory aging predictor** — depreciation curve (4 tipi)
- **Inventory health** — zdravje inventarja
- **Inventory health monitor** — real-time monitoring
- **Inventory lifecycle** — celoten lifecycle
- **Stockout prevention** — preprečevanje izpodravitve
- **Predictive procurement** — napovedna nabava
- **Smart restock** — pametno dopolnjevanje
- **Cash reserve** — rezerva gotovine
- **Cashflow** — tok gotovine
- ...in 10+ več

### 📝 Oglasi (25+ funkcij)
- **Generate listing** — AI generira oglas iz trade-a
- **Listing SEO optimizer** — optimizacija za Bolha/Facebook/Vinted
- **Listing image optimizer** — VLM analiza slik (8 faktorjev)
- **Listing performance** — performansa oglasov
- **Listing refresh** — osveževanje oglasov
- **Listing rotation** — rotacija med platformami
- **Listing velocity** — hitrost prodaje
- **Title A/B test** — testiranje naslovov
- **Description optimizer** — optimizacija opisov
- **Bulk listing generator** — multi-platform generacija
- ...in 15+ več

### 🤝 Negotiation (8+ funkcij)
- **Real-time negotiation bot** — real-time odgovori (10 taktik)
- **Negotiation chatbot** — multi-turn pogovor
- **Negotiation playbook** — strategija za vsak item
- **Negotiation tracker** — sledi pogajanjem
- **Negotiation outcome** — napoved izida
- **Smart alert router** — pametno usmerjanje alertov

### 👥 Buyers/Customers (12+ funkcij)
- **Customer segmentation** — RFM analiza (5 segmentov)
- **Buyer trust score** — 6 trust levelov (platinum→scammer)
- **Buyer matchmaker v2** — ML matching (8 faktorjev)
- **Buyer persona** — generiranje kupcev
- **Buyer intent** — napoved nakupne intencije
- **Customer LTV** — lifetime value napoved
- **Cross-sell recommender** — 8 strategij
- **Buyer matchmaker v1** — osnovni matching

### 🛡️ Risk/Insurance (10+ funkcij)
- **Risk hedging** — 8 hedging strategij
- **Insurance optimizer v2** — 4D risk matrika
- **Insurance claim** — upravljanje zahtevkov
- **Fraud detection** — zaznavanje prevare
- **Fake detection** — lažni oglasi
- **Margin guardian** — avtomatski margin alerts
- **Risk parity** — porazdelitev tveganja
- **Tax loss harvesting** — davčna optimizacija

### 💰 Finance/Profit (16+ funkcij)
- **Profit margin predictor** — pred-nakupna analiza
- **Profit cycle** — 8-fazni cikel z compounding
- **Profit cascade** — kaskadni profit
- **Profit dashboard** — centralni dashboard
- **Profit forecast** — napoved dobička
- **Profit trail** — sled dobička
- **Profit playbook** — 8 faz playbook
- **Master dashboard** — glavni dashboard z health score
- **Autonomous trading** — paper/live mode
- **Cash generator** — 8 strategij z 3-valovnim planom
- **Smart bundle pricing** — 8 pricing modelov
- **Margin optimizer** — optimizacija marž
- **Budget allocator** — porazdelitev proračuna
- ...in 4+ več

▶️ **Glej [AI_ENDPOINTS.md](./AI_ENDPOINTS.md) za popoln seznam vseh 287 AI endpointov.**

---

## 🔒 Local-first & Zero-cloud

### Kaj to pomeni?

| Lastnost | Markec AI Firm | Tipična SaaS |
|----------|---------------|--------------|
| Podatki | Lokalno (SQLite) | Cloud |
| AI model | Lokalno (Ollama) ali tvoj API | Njihov |
| Mesečna naročnina | 0€ | 10-100€ |
| Data sharing | Nikoli | Pogosto |
| Customizacija | Polna | Omejena |
| Offline delovanje | Da (z Ollama) | Ne |
| Hitrost | Lokalna omrežja | Internet |

### Zakaj local-first?
1. **Privatnost** — tvoji podatki ne zapustijo računalnika
2. **Stroški** — enkratna namestitev, brez mesečnih naročnin
3. **Hitrost** — lokalna AI (Ollama) je hitrejša od cloud API-jev
4. **Kontrola** — polna kontrola nad AI modelom in parametri
5. **GDPR compliant** — podatki ostanejo pri tebi

---

## 🔔 Notifikacije

### 5 kanalov
1. **Telegram Bot** — real-time alerts z inline buttons
2. **Discord Webhook** — rich embeds z barvami
3. **Slack Webhook** — za team collaboration
4. **Email SMTP** — za dnevne/porochne digeste
5. **Web Push (VAPID)** — browser push na mobile/desktop

### Notification modes
- **Instant** — takoj ko pride nov listing
- **Daily digest** — enkrat dnevno povzetek
- **Weekly digest** — enkrat tedensko povzetek

### Quiet hours
- Onemogoči alerte v določenih urah (npr. 22:00-07:00)
- Pomembni alerti (high score) še vedno pridejo skozi

---

## 🕵️ Anti-detection

Za scraping Bolhe in drugih platform, aplikacija vključuje:

### 6 tehnik
1. **Proxy rotation** — HTTP/SOCKS5 proxy z avtentikacijo
2. **Realistic headers** — rotacija User-Agent stringov
3. **Request randomization** — 1-5s delay med requesti
4. **Stealth mode** — Playwright z anti-detection plugin
5. **CAPTCHA solving** — 2captcha, anti-captcha, capmonster, custom
6. **TLS fingerprinting** — custom TLS client za fingerprint masking

### Etika uporabe
- Spoštuj robots.txt in ToS platform
- Ne preobremeni strežnikov (rate limiting)
- Ne uporabljaj za fraud ali zlonamerne namene

---

## 📡 API dokumentacija

### Auth
Ni avtentikacije (local-first). Aplikacija teče na localhost.

### Endpointi (287 AI + 30 analytics + 10 cron + sistemski = 422)

```bash
# AI primeri
GET  /api/ai/insights  ?days=30                    # AI Insights (trendi, anomalije)
POST /api/ai/customer-segmentation       # RFM analiza
POST /api/ai/buyer-matchmaker-v2         # ML matching
POST /api/ai/realtime-negotiation-bot    # Real-time negotiation
POST /api/ai/profit-margin-predictor     # Pred-nakupna analiza
POST /api/ai/auction-sniper-v2           # Auction sniper z ML timing
POST /api/ai/batch-deal-evaluator        # 50 oglasov v 1 AI klicu
POST /api/ai/negotiation-outcome-predictor  # Predvidi accept/counter/reject
GET  /api/ai/liquidation-strategist      # Exit strategija za zastarele item-e
GET  /api/ai/reinvestment-advisor         # Kam reinvestirati dobiček (v7.57)
GET  /api/ai/auto-relisting-scheduler     # AI full relisting plan (v7.58)
GET  /api/ai/profit-maximizer-v2          # ML compounding projekcija (v7.56)
GET  /api/ai/bundle-profit-optimizer       # AI paketi za cross-sell (v7.59)
GET  /api/ai/demand-forecast               # AI napoved povpraševanja 30 dni (v7.60)
GET  /api/ai/margin-guardian-pro            # Real-time margin monitoring + AI pricing (v7.60)
GET  /api/ai/multi-platform-listing-generator  # AI oglasi za 5 platform hkrati (v7.60)
GET  /api/ai/negotiation-script-generator     # AI strategia dokument za pogajanje (v7.61)
GET  /api/ai/photo-enhancement-advisor         # AI nasveti za boljše fotografije (v7.61)

# Sistemski
GET  /api/health                         # Health check
POST /api/run?id=<monitorId>             # Sproži scan enega monitorja
GET  /api/cron/run-all?key=<secret>      # Cron: vsi monitorji + alerts + digest
POST /api/settings                       # Update nastavitve
GET  /api/listings                       # Seznam listingov
POST /api/trades                         # Ustvari trade

# Profit pipeline (v7.32-v7.61)
GET  /api/trades/deal-flow               # ROI, win rate, money velocity, pipeline
GET  /api/analytics/deal-funnel          # Conversion funnel (discovery→profit)
GET  /api/analytics/sold-comps           # Fair market value (Keepa-style)
GET  /api/analytics/niche-score          # Best categories by opportunity
GET  /api/analytics/deal-velocity        # Market temperature (HOT/COLD)
GET  /api/analytics/source-quality       # Best monitor score
GET  /api/analytics/net-profit           # After-tax profit (SI tax law)
GET  /api/analytics/reseller-blackbook   # Best recurring sellers
GET  /api/analytics/time-to-profit       # Cycle time optimization
GET  /api/analytics/profit-heatmap       # Best days/hours for profit
GET  /api/analytics/market-trend         # Rising/falling prices
GET  /api/analytics/cross-platform-arbitrage  # Buy cheap, sell expensive
GET  /api/analytics/deal-timing          # When new deals appear
GET  /api/analytics/seasonal-calendar    # Best month to sell
GET  /api/analytics/profit-goal-tracker  # Progress to monthly goal
GET  /api/analytics/platform-performance # Best platform per category
GET  /api/analytics/weekly-trend-radar   # 7-day market shifts (v7.50)
GET  /api/analytics/cash-flow-forecast   # 7/14/30d capital forecast (v7.51)
GET  /api/analytics/roi-leaderboard      # Best brands/models by ROI (v7.55)
GET  /api/analytics/missed-opportunities # Zamujene priložnosti (v7.54)
GET  /api/analytics/optimal-listing-time # Najboljši čas za objavo (v7.54)
GET  /api/analytics/tax-report           # Letno davčno poročilo FURS (v7.57)
GET  /api/analytics/competitor-tracker   # Sledenje supplier-jem (v7.57)
GET  /api/analytics/deal-source-roi       # ROI po viru nakupa (v7.58)
GET  /api/analytics/listing-performance   # StaleScore za held inventar (v7.58)
GET  /api/analytics/market-gap-finder     # Prazne niše z visokim povpraševanjem (v7.56)
GET  /api/analytics/portfolio-stress-test # Stresni test portfelja -10/-25/-40% (v7.59)
GET  /api/analytics/supplier-crm          # CRM za stalne dobavitelje (v7.59)
GET  /api/analytics/inventory-insurance-calculator  # Zavarovalne opcije za inventar (v7.61)
GET  /api/ai/demand-forecast              # AI napoved povpraševanja 30 dni (v7.60)
GET  /api/ai/margin-guardian-pro           # Real-time margin monitoring + AI pricing (v7.60)
GET  /api/ai/multi-platform-listing-generator  # AI oglasi za 5 platform (v7.60)
GET  /api/ai/negotiation-script-generator  # AI strategia za pogajanje (v7.61)
GET  /api/ai/photo-enhancement-advisor      # AI nasveti za fotografije (v7.61)

# Cron automation (10 endpoints)
GET  /api/cron/smart-deal-alert?key=     # TOP 3 deals → Telegram
GET  /api/cron/inventory-aging-alert?key=  # Aging items → Telegram
GET  /api/cron/weekly-report?key=        # Monday profit summary
GET  /api/cron/daily-pulse?key=          # Daily morning summary
GET  /api/cron/auto-price-drop?key=      # Price drop suggestions
GET  /api/cron/competitor-price-monitor?key=  # Competitor alerts
GET  /api/cron/scraper-recovery?key=     # Auto-retry failed scrapers
GET  /api/cron/relisting-reminder?key=   # Bolha ad expiry alerts
GET  /api/cron/smart-notification-router?key=  # Priority-based routing (v7.53)
GET  /api/cron/heartbeat?key=            # Sistemski heartbeat
```

▶️ **Glej [AI_ENDPOINTS.md](./AI_ENDPOINTS.md) za popoln seznam.**

---

## 🛠️ Development

### Setup
```bash
bun install
bun run db:generate
bun run db:push
bun run dev
```

### Scripts
```bash
bun run dev          # Development server
bun run build        # Production build
bun run start        # Production server
bun run lint         # ESLint
bun run typecheck    # TypeScript check
bun run db:push      # Push Prisma schema
bun run db:generate  # Generate Prisma client
bun run db:migrate   # Run migrations
bun run db:reset     # Reset database
```

### Project structure
```
markec-ai-firm/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── ai/              # 287 AI endpointov
│   │   ├── page.tsx             # Main dashboard
│   │   ├── settings/            # Settings UI
│   │   └── ...
│   ├── components/
│   │   ├── dashboard/           # Dashboard komponente
│   │   └── ui/                  # shadcn/ui komponente
│   └── lib/
│       ├── ai.ts                # Multi-provider AI client
│       ├── db.ts                # Prisma client
│       └── pipeline.ts          # Scraping pipeline
├── prisma/
│   └── schema.prisma            # Database schema
├── .github/
│   ├── workflows/               # CI/CD
│   ├── ISSUE_TEMPLATE/          # Issue templates
│   ├── CODEOWNERS               # Code owners
│   └── PULL_REQUEST_TEMPLATE.md
├── public/                      # Static assets
├── README.md                    # Ta datoteka
├── CHANGELOG.md                 # Verzije v1.0 → v6.49
├── CONTRIBUTING.md              # Navodila za prispevanje
├── LICENSE                      # MIT
├── SECURITY.md                  # Security policy
└── package.json
```

### Coding standards
- TypeScript strict mode
- ESLint brez napak
- 0 TS napak
- Conventional Commits (`feat(v7.56): AI XYZ function`)
- Vsi AI endpointi sledijo istemu vzorcu (glej [CONTRIBUTING.md](./CONTRIBUTING.md))
- Vsi API route handlerji imajo try/catch z logger.error (422 routes)

▶️ **Glej [CONTRIBUTING.md](./CONTRIBUTING.md) za podrobnosti.**

---

## 🗺️ Roadmap

### v7.61 (trenutno — ~108 funkcij)
- [x] **Profit pipeline (49+ funkcij):** Deal Flow, Funnel, Sold Comps, Price History, Seller Intel, Make Offer, Quick Buy, Flip Workflow, Profit Maximizer v2, Niche Score, Deal Velocity, Bundle Detector, Capital Advisor, Threshold Optimizer, Deal Score Calibrator, Cross-border Arbitrage, Negotiation Auto-Responder, Seasonal Calendar, Profit Goal Tracker, Margin Guardian, Seller Response Predictor, Turnover Optimizer, Auto-Listing Draft, Photo Quality Analyzer, Refurb ROI Calculator, Loss Recovery Playbook, Monitor Suggestions, Tax-Aware Selling, Quick Sell Ladder, Risk Spread Calculator, Liquidation Strategist, Market Gap Finder, Listing Refresh Scheduler, Tax Report Generator, Reinvestment Advisor, Competitor Tracker, Deal Source ROI, Listing Performance, Auto-Relisting Scheduler, Negotiation Outcome Predictor, Portfolio Stress Test, Supplier CRM, Bundle Profit Optimizer, Demand Forecast AI, Margin Guardian Pro, Multi-Platform Listing Generator, Negotiation Script Generator, Inventory Insurance Calculator, Photo Enhancement Advisor
- [x] **Cron automatizacija (10):** Smart Deal Alert, Inventory Aging, Weekly Report, Auto Price Drop, Competitor Monitor, Scraper Recovery, Relisting Reminder, Daily Pulse, Heartbeat, Smart Notification Router
- [x] **Telegram 2-way (11 ukazi):** /deals /profit /inventory /status /run /alerts /listings /monitors /trades /stats /help
- [x] **Anti-scraping (9 tehnik):** Cookie jar, 429 retry, Referer, Gaussian delay, 12 UAs, Per-domain session, Proxy rotation, CAPTCHA solver, Auto-Recovery
- [x] **Anti-hallucination (5 slojev):** Prompt grounding, Numeric sanity, Cross-reference, Confidence threshold (30%), Pattern detection
- [x] **AI cost optimization:** AI Output Cache (6h TTL, ~60% prihranek) + Batch Deal Evaluator (50 oglasov/klic, ~98% prihranek)
- [x] **Security:** AES-256-GCM secrets encryption, Rate limiting, SSRF protection
- [x] **Analytics (30):** Deal Velocity, Sold Comps, Niche Score, Deal Funnel, Platform Performance, Source Quality, Net Profit (after tax), Reseller Blackbook, Time-to-Profit, Profit Heatmap, Market Trend, Cross-Platform Arbitrage, Deal Timing, Seasonal Calendar, Profit Goal Tracker, Weekly Trend Radar, Cash Flow Forecast, ROI Leaderboard, Missed Opportunities, Optimal Listing Time, Purchase Pattern, Tax Report, Competitor Tracker, Deal Source ROI, Listing Performance, Market Gap Finder, Portfolio Stress Test, Supplier CRM, Optimal Listing Time, Inventory Insurance Calculator
- [x] **Testing:** Vitest (37 tests), structured logger, try/catch na vseh 422 API routes
- [x] **0 vulnerabilities**, 0 TS errors, 0 ESLint errors

### Naslednji koraki
- [ ] UI komponente za v7.50-v7.61 funkcije v dashboard
- [ ] WebSocket real-time negotiation (SSE namesto polling)
- [ ] Playwright E2E testi za glavne flow-e
- [ ] TLS fingerprinting (curl-impersonate)
- [ ] AI photo analysis za prodajne slike (VLM)
- [ ] ML model za buyer matchmaker (fine-tuned na realnem data)
- [ ] PostgreSQL support za multi-user deployment
- [ ] Mobile app (React Native)
- [ ] Plugin sistem za custom scrapers
- [ ] Multi-language support (angleščina, nemščina)

### v8.0 (long-term)
- [ ] Cloud deployment option (Docker, Kubernetes)
- [ ] Team collaboration (multi-user z avtentikacijo)
- [ ] Marketplace za custom AI strategije
- [ ] API za third-party integracije

---

## 🤝 Contributing

Prispevki so dobrodošli! Preberi [CONTRIBUTING.md](./CONTRIBUTING.md) za:

- Development setup
- Coding standards
- AI endpoint konvencije
- Commit guidelines
- Pull Request proces
- Testing navodila

### Hitri prispevek
1. Fork repozitorija
2. Ustvari branch: `git checkout -b feat/v6.50-ai-xyz`
3. Commit: `feat(v6.50): AI XYZ function`
4. Push: `git push origin feat/v6.50-ai-xyz`
5. Odpri Pull Request

---

## 📄 License

Projekt je licenciran pod **MIT License** — glej [LICENSE](./LICENSE).

Lahko:
- ✅ Uporabljaš komercialno
- ✅ Modificiraš
- ✅ Distribuiraš
- ✅ Privatno uporabljaš

Z obveznostjo:
- ⚠️ Vključiti copyright notice in license v vse kopije

---

## 📋 Changelog

Popolna zgodovina verzij v [CHANGELOG.md](./CHANGELOG.md) — od v1.0 (25. junij 2026) do v7.61 (avgust 2026). Starejše verzije (v1.0–v6.x) so arhivirane v [ARCHIVE.md](./ARCHIVE.md).

### Zadnje verzije
- **v7.61.0** (avgust 2026) — AI Negotiation Script Generator, Inventory Insurance Calculator, AI Photo Enhancement Advisor
- **v7.60.0** (avgust 2026) — Demand Forecast AI, Margin Guardian Pro, Multi-Platform Listing Generator
- **v7.59.0** (avgust 2026) — Portfolio Stress Test, Supplier CRM, Bundle Profit Optimizer
- **v7.58.0** (avgust 2026) — Deal Source ROI Analyzer, Listing Performance Tracker, Auto-Relisting Scheduler
- **v7.57.0** (avgust 2026) — Tax Report Generator (FURS-ready), Reinvestment Advisor, Competitor Listing Tracker
- **v7.56.0** (avgust 2026) — Market Gap Finder, Listing Refresh Scheduler, Profit Maximizer v2 (ML compounding)
- **v7.55.0** (avgust 2026) — ROI Leaderboard, Negotiation Outcome Predictor, Inventory Liquidation Strategist
- **v7.54.0** (avgust 2026) — Missed Opportunity Tracker, Conversation Memory, Optimal Listing Time
- **v7.53.0** (avgust 2026) — AI Output Cache (6h TTL), Batch Deal Evaluator (50/klic), Smart Notification Router
- **v7.52.0** (avgust 2026) — Anti-Hallucination Layer (5 slojev) — prevent AI fabricating financial data
- **v7.51.0** (avgust 2026) — Cash Flow Forecaster, Search Keyword Optimizer, Purchase Pattern
- **v7.50.0** (avgust 2026) — Weekly Trend Radar, Risk Spread Calculator, Quick Sell Ladder
- **v7.49.0** (avgust 2026) — Margin Guardian, Seller Response Predictor, Turnover Optimizer

---

## 📞 Contact

- **GitHub Issues** — za bug reporte in feature requeste
- **GitHub Discussions** — za vprašanja in diskusije
- **Email** — security@markec.local (samo za security issues)

---

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org/) — React framework
- [Prisma](https://www.prisma.io/) — Database ORM
- [shadcn/ui](https://ui.shadcn.com/) — UI components
- [Ollama](https://ollama.com/) — Local AI models
- [Radix UI](https://www.radix-ui.com/) — Accessible primitives
- [Tailwind CSS](https://tailwindcss.com/) — Utility-first CSS
- [Bun](https://bun.sh/) — JavaScript runtime

---

<div align="center">

---

## ⭐ Če ti je ta projekt všeč

Če ti je **Markec AI Firm** všeč ali ti je bil v pomoč, pusti **⭐ zvezdico** zgoraj na GitHubu!
To pomaga pri prepoznavnosti open-source orodij in motivira za nadaljnji razvoj.

**[⭐ Star repozitorij](https://github.com/markec12345678/markecaifirm/stargazers)** · **[🐛 Prijavi bug](https://github.com/markec12345678/markecaifirm/issues)** · **[💡 Predlagaj funkcijo](https://github.com/markec12345678/markecaifirm/issues)** · **[🍴 Fork](https://github.com/markec12345678/markecaifirm/fork)**

---

**[⬆ Nazaj na vrh](#markec-ai-firm--ai-trading-firm-za-slovenske-oglase)**

Made with ❤️ by [markec12345678](https://github.com/markec12345678)

</div>

