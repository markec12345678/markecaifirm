# Markec AI Firm — Opportunity Monitor

Lokalni AI lovec priložnosti za slovenske spletne portale (Bolha, Nepremičnine, Avtonet, ...).
V lastnem API ključu in lastnem AI modelu (Ollama / OpenAI / Anthropic / OpenAI-kompatibilni).

**v1.1** — dodani: heartbeat (dnevni povzetek na Telegram), AI analiza slik oglasov (multimodalni modeli), Bolha Playwright fallback za Cloudflare bypass, Telegram inline tipke z webhook callback podporo.

## Kar aplikacija počne

1. **Spremlja** konfigurirana iskanja na Bolhi, Nepremičninah, Avtonetu ali poljubnem RSS viru.
2. **AI oceni** vsak nov oglas — ali je priložnost (podcenjeno), sumljivo (morebitna prevara) ali nezanimivo.
3. **Pošlje alert** na Telegram in/ali dashboard, kadar oglas zadene kriterije (visoka ocena prilike + nizko tveganje).
4. **Teče v ozadju** preko cron endpointa, ki ga poganja Windows Task Scheduler / Linux cron.

## Tehnologija

- **Next.js 16** + TypeScript + Tailwind CSS 4 + shadcn/ui (terminal-dark tema)
- **Prisma** ORM + SQLite (lokalna datoteka — ni serverja)
- **AI providerji**: Ollama (lokalno), OpenAI, Anthropic, poljuben OpenAI-kompatibilni endpoint
- **Scraping**: cheerio (HTML) + native fetch (RSS) — za Bolho priporočamo Playwright, če Cloudflare blokira
- **Notifikacije**: Telegram Bot API

## Začetek

### 1. Inštalacija

```bash
bun install
bun run db:push
bun run dev
```

Aplikacija teče na `http://localhost:3000`.

### 2. Konfiguracija AI

Odpri **Nastavitve** v aplikaciji in izberi provider:

- **Ollama (priporočeno za slovenščino)**:
  ```bash
  # Najprej inštaliraj Ollama: https://ollama.com
  ollama pull qwen2.5:7b
  # Aplikacija se samodejno poveže na http://localhost:11434
  ```
- **OpenAI / Anthropic**: vnesi API ključ.
- **OpenAI-kompatibilni** (Groq, OpenRouter, Together, DeepSeek): vnesi base URL + API ključ.

Klikni "Testiraj povezavo" za validacijo.

### 3. Telegram (izbirno)

1. Ustvari bota prek `@BotFather` na Telegramu → dobiš **Bot Token**.
2. Pošlji botu sporočilo `/start`.
3. Obišči `https://api.telegram.org/bot<TOKEN>/getUpdates` in najdi `chat.id`.
4. Vnesi oba v nastavitveno formo in klikni "Test".

### 4. Dodaj monitor

V zavihku **Monitorji** klikni "Nov monitor". Izberi vir (Bolha / Nepremičnine / Avtonet / Custom RSS), prilepi URL iskanja, nastavi filtre (ključne besede, cena, interval).

**Primer RSS za Nepremičnine.net**:
1. Obišči `nepremicnine.net`, nastavi filtre (lokacija, cena, tip).
2. Kopiraj URL iz naslovne vrstice.
3. Dodaj `?output=rss` na konec.
4. Prilepi v polje "URL iskanja / RSS".

### 5. Avtomatsko poganjanje (cron)

Da bodo monitorji tekli samodejno, nastavi zunanji cron, ki vsakih 5–10 minut pokliče:

```bash
# Linux/Mac cron (vsakih 10 min):
*/10 * * * * curl -s http://localhost:3000/api/cron/run-all > /dev/null

# Windows Task Scheduler (PowerShell):
Invoke-WebRequest -Uri "http://localhost:3000/api/cron/run-all" -Method POST

# Z zaščito (nastavi .env: MONITOR_CRON_KEY=secret):
curl -s "http://localhost:3000/api/cron/run-all?key=secret"
```

## Arhitektura

```
src/
├── app/
│   ├── api/
│   │   ├── settings/          # GET/POST nastavitve + test povezav
│   │   ├── monitors/          # CRUD monitorji
│   │   ├── monitors/[id]/     # GET/PUT/DELETE/POST (ročni run)
│   │   ├── alerts/            # GET/PATCH/DELETE alerti
│   │   ├── stats/             # Dashboard statistike
│   │   ├── run/               # Ročni run enega monitorja
│   │   └── cron/run-all/      # Cron endpoint (run vseh zapadlih)
│   ├── page.tsx               # Glavni dashboard s 4 zavihki
│   ├── layout.tsx
│   └── globals.css            # Terminal-dark tema
├── components/
│   └── dashboard/
│       ├── dashboard-view.tsx # Pregled sistema (statistike, zadnje izvedbe)
│       ├── monitors-view.tsx  # Upravljanje monitorjev
│       ├── alerts-view.tsx    # Pregled alertov s filtri
│       └── settings-view.tsx  # AI provider / Telegram / thresholdi
└── lib/
    ├── ai.ts                  # AI provider abstrakcija (Ollama/OpenAI/Anthropic)
    ├── telegram.ts            # Telegram Bot API klient
    ├── scraper.ts             # Bolha / Nepremičnine / Avtonet / Custom RSS scraperji
    ├── pipeline.ts            # Orchestrator: scrape → dedup → AI eval → alert
    └── db.ts                  # Prisma klient
prisma/
└── schema.prisma              # Settings, Monitor, Listing, Alert, RunLog
```

## AI evalvacijski prompt

AI dobi vsak nov oglas in vrne strukturiran JSON:

```json
{
  "prilika": true,
  "ocena_tveganja": 2,
  "ocena_prilike": 8,
  "razlog": "Cena 350€ za iPhone 13 Pro 256GB je znatno pod tržno (450-550€). Opis specifičen, omenja polnilnik in razlog prodaje.",
  "predvidena_trzna_vrednost": 500,
  "verdict": "PRILIKA"
}
```

Alert se sproži, kadar `ocena_prilike >= minOpportunityScore` IN `ocena_tveganja <= maxRiskScore` (oba nastavljiva v nastavitvah).

## Varnost

- Vsi API ključi in Telegram tokeni se shranjujejo **lokalno** v SQLite datoteki.
- Aplikacija teče izključno na `localhost` — ni cloud komponent.
- Za cron zaščito nastavi `MONITOR_CRON_KEY` v `.env` in dodaj `?key=...` v URL.

## v1.1 funkcije

### 1. Heartbeat — dnevno poročilo

Ob uri, ki jo nastaviš (privzeto 22:00), aplikacija samodejno pošlje Telegram sporočilo s povzetkom zadnjih 24 ur:
- Število aktivnih monitorjev
- Število uspešnih/neuspešnih izvedb
- Število novih oglasov in alertov
- Razdelitev alertov po verdiktu (PRILIKA/SUMNJIVO)

Heartbeat se proži prek istega cron endpointa kot monitorji (`/api/cron/run-all`), ki se klice vsakih 5-10 minut. Aplikacija sama preveri, ali je ura za heartbeat in ali ni bil že poslan v zadnjih 23 urah.

V nastavitvah lahko ročno sprožiš testni heartbeat z gumbom "Pošlji testni heartbeat".

### 2. AI analiza slik oglasov (multimodalno)

Če je v nastavitvah omogočena "AI analiza slik", aplikacija za vsak nov oglas:
1. Prenese prvo sliko oglasa (max 5 MB, 8s timeout)
2. Pošlje sliko AI modelu skupaj z opisom
3. AI dodatno oceni: `image_analysis` (kratek opis slike v slovenščini) in `image_verdict` (AUTHENTIC / SUSPICIOUS / STOCK_PHOTO / NO_IMAGE)

**Zahtevani multimodalni modeli:**
- **Ollama**: `ollama pull llava:7b` ali `minicpm-v:8b`
- **OpenAI**: `gpt-4o` ali `gpt-4o-mini` (oba podpirata slike)
- **Anthropic**: `claude-3-5-sonnet` ali `claude-3-5-haiku`

Analiza slik poveča čas obdelave za ~5-15s na oglas in porabi več tokenov. Priporočamo, da jo omogočiš samo za monitorje, kjer je kakovost slike ključna (npr. preprodaja elektronike).

### 3. Bolha Playwright fallback

Bolha.com uporablja Cloudflare zaščito, ki pogosto blokira navadne HTTP zahteve. Ko cheerio scraping vrne 0 rezultatov ali zazna Cloudflare challenge, aplikacija samodejno ponovi z birskalnikom (Playwright).

**Namestitev Playwrighta:**
```bash
bun add playwright
bunx playwright install chromium
```

Nato v nastavitvah omogoči "Bolha Playwright fallback".

### 4. Telegram inline tipke

Alerti na Telegramu dobijo 2 vrsti tipk:

**URL tipke** (delujejo brez setupa):
- 🔗 Odpri oglas — odpre URL oglasa
- 📊 Dashboard — odpre localhost:3000/alerts

**Callback tipke** (zahtevajo webhook):
- ✅ Arhiviraj — označi alert kot arhiviran
- 🚫 Označi prevaro — arhivira in označi kot SUMNJIVO

**Namestitev webhooka za callback tipke:**

```bash
# 1. Expose localhost (izberi eno)
ngrok http 3000
# ali
cloudflared tunnel --url http://localhost:3000

# 2. V .env dodaj:
TELEGRAM_WEBHOOK_SECRET=nek_nakljucen_niz

# 3. V aplikaciji Nastavitve → Telegram inline tipke → vnesi enak secret

# 4. Nastavi webhook (zamenjaj URL in token):
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<tvoj-tunnel>/api/telegram/webhook?secret=nek_nakljucen_niz"

# 5. Test - pošlji sporočilo botu, klikni "Arhiviraj" na alertu
```

Za odstranitev webhooka: `curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook"`

## Testirano z

- **Ollama** + `qwen2.5:7b` — odlična podpora za slovenščino, brezplačno, lokalno
- **OpenAI** `gpt-4o-mini` — najcenejši OpenAI model, dovolj dober za to nalogo
- **Anthropic** `claude-3-5-haiku` — hiter in natančen

## License

MIT — uporabljaj prosto, brez garancij.
