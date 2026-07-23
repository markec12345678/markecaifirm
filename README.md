# Markec AI Firm — Opportunity Monitor

Lokalni AI lovec priložnosti za slovenske spletne portale (Bolha, Nepremičnine, Avtonet, ...).
V lastnem API ključu in lastnem AI modelu (Ollama / OpenAI / Anthropic / OpenAI-kompatibilni).

**v1.5** — dodani: System Health endpoint z real-time monitoring (8 komponent), PWA podpora (installable mobile app z manifestom in service workerjem), browser push notifications (Web Push API z VAPID), Bolha RSS fallback (?output=rss pred HTML scraping), DB performance indeksi.

**v1.4** — dodani: Discord webhook kot alternativa Telegramu (rich embeds z barvami), Bolha detail page scraper (full opis + vse slike), price history tracking (sledi spremembam cene), bookmarks/favorites za shranjevanje zanimivih oglasov.

**v1.3** — dodani: listing detail modal z podobnimi oglasi, bulk akcije na alertih (multi-select), globalno iskanje (Ctrl+K), auto-pause monitorja po N zaporednih napakah, dry-run test URL-ja, backup/restore baze podatkov.

**v1.2** — dodani: urnik delovanja (schedule windows) za stroškovni nadzor, pregled vseh oglasov (Listings browser) za validacijo AI, analitika z grafy (alerts/day, verdikt distribucija, performansa monitorjev, natančnost AI), CSV export za vse poglede, feedback loop za AI natančnost (👍 Zanima me / 🚫 Prevara).

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

## v1.2 funkcije

### 1. Urnik delovanja (schedule windows)

Vsak monitor lahko omejiš na delovanje le v določenih urah. Tipičen primer: nepremičninski monitor ne potrebuje delati ob 3:00 zjutraj, ker novi oglasi takrat ne nastajajo.

- **Konfiguracija**: v monitor formi vklopi "Urnik delovanja" in nastavi "Od ure" / "Do ure"
- **Wrap-around**: ura 22-6 pomeni delovanje 22:00–06:00 (čez polnoč)
- **Obnašanje**: cron endpoint samodejno preskoči monitorje izven okna (ne vrača napake, samo `skipped` v odgovoru)
- **Statistika**: na dashboardu vidiš "skipped: N" v cron odgovoru

### 2. Pregled vseh oglasov (Listings browser)

Nov zavihek "Oglasi" prikazuje vse scraped oglase z AI oceno — vključno z NEZANIMIVO (tistimi, ki niso sprožili alerta). To je ključno za validacijo AI:

- **Filtri**: monitor, verdikt (PRILIKA/SUMNJIVO/NEZANIMIVO), min AI score, max AI risk, samo z sliko, sortiranje
- **Podrobnosti**: klik na oglas razkrije AI razlog, analizo slike, originalni opis in povezavo
- **Indikator cene**: pri vsakem oglasu vidiš tudi razliko med navedeno ceno in AI-jevo oceno tržne vrednosti
- **Paginacija**: 50 na stran

**Zakaj je to ključno**: če AI označuje preveč oglasov kot NEZANIMIVO, morda zamudiš dobre priložnosti. Če preveč kot PRILIKA, dobiš preveč lažnih alarmov. Listings browser omogoča, da preverjaš obe stranici.

### 3. Analitika (Analytics)

Nov zavihek "Analitika" s tremi ključnimi pogledi:

**AI natančnost** (precision):
- Število alertov z vsako oznako (👍 Zanima me / ✅ Arhivirano / 🚫 Prevara / brez akcije)
- Precision = interested / (interested + scam) — visok pomeni, da AI dobro ločuje prave priložnosti
- Barvni indikator: zeleno (≥70%), rumeno (40-70%), rdeče (<40%)
- Povezava na actionable nasvete (dvigaj threshold, dodaj excludeKeywords)

**Grafy** (recharts):
- Alerti na dan (zadnjih 14 dni) — line chart z razčlenitvijo po verdiktu
- Distribucija verdiktov (skupno) — pie chart
- Novi oglasi na dan — bar chart

**Performansa monitorjev** (tabela):
- Za vsak monitor: št. oglasov, št. alertov, št. prilik, success rate, povprečen čas izvedbe
- Precision per monitor — identificiraj slabo nastavljene monitorje
- Actionable: če je precision < 40%, premakni threshold ali dodaj excludeKeywords

### 4. CSV export

Vsi pogledi (Oglasi, Alerti) imajo gumb "CSV", ki izvozi trenutno filtrirane podatke:
- **Listings**: firstSeenAt, monitor, source, title, price, location, url, aiScore, aiRisk, aiVerdict, aiReason, aiEstimatedValue, aiImageVerdict, aiImageAnalysis
- **Alerts**: createdAt, monitor, title, url, aiScore, aiRisk, aiVerdict, sentTelegram, isRead, isArchived, userAction, userActionedAt

CSV je v UTF-8, primeren za Excel/Google Sheets/LibreOffice.

### 5. AI feedback loop

V Alerti zavihku ima vsak alert tri gumbe:
- **👍 Zanima me** — označi kot dobro priložnost (poveča precision)
- **🚫 Prevara** — označi kot slabo (zniža precision, vpliva na threshold tuning)
- **✅ Arhiviraj** — neutralna akcija

Telegram inline tipke so enake (👍 Zanima me / ✅ Arhiviraj / 🚫 Prevara) — zahtevajo webhook (glej v1.1 navodila).

Po nekaj tednih boš imel dovolj povratnih informacij za tuning thresholdov v Nastavitvah. Priporočam:
- Če precision < 50%: dvigaj `minOpportunityScore` iz 7 na 8
- Če precision > 90% in malo alertov: spusti `minOpportunityScore` na 6
- Če veliko SCAM označb: dvigaj `maxRiskScore` ni pravilno — raje dodaj excludeKeywords v monitor

## v1.3 funkcije

### 1. Listing detail modal

Klik na kateri koli listing v zavihku "Oglasi" odpre modal z bogatim pregledom:
- Velika slika oglasa (če obstaja)
- AI evalvacija v mreži: verdikt, ocena prilike, ocena tveganja
- AI razlog (italic, citat)
- AI analiza slike (če je bila narejena)
- Originalni opis oglasa
- **Podobni oglasi** iz istega monitorja v cena ±30% razponu — ključno za primerjavo tržne vrednosti
- Direktni gumb "Odpri oglas"

### 2. Bulk akcije na alertih

Multi-select s checkboxi omogoča hkratno delovanje na več alertih:
- Checkbox ob vsakem alertu
- "Izberi vse" / "Odznači vse" v glavi seznama
- Bulk toolbar (se pojavi ko je vsaj 1 izbran) z akcijami:
  - ✓ Prebrano
  - 👍 Zanima me
  - ✅ Arhiviraj
  - 🚫 Prevara
  - 🗑 Izbriši
- Maksimalno 500 alertov naenkrat

### 3. Globalno iskanje (Ctrl+K)

Pritisni **Ctrl+K** (ali Cmd+K na Macu) kjer koli v aplikaciji za odprtje iskanja:
- Išče po naslovih, opisih, URL-jih in lokacijah listings + alerts hkrati
- Rezultati razdeljeni v dve sekciji (Oglasi / Alerti)
- Debounce 300ms (čaka da končaš tipkanje)
- Klik na listing odpre originalni oglas v novem zavihku
- Klik na alert zapre modal in te pelje v zavihek Alerti
- Mobile: iskalni gumb v glavi (brez shortcut)

### 4. Auto-pause po zaporednih napakah

Vsak monitor ima nastavljiv `autoPauseThreshold` (privzeto 5):
- Po N zaporednih napakah se monitor samodejno deaktivira
- `consecutiveErrors` se resetira ob prvi uspešni izvedbi
- Status prikazan v MonitorCard:
  - `⚠ 3/5 zaporednih napak` — opozorilo pred pavzo
  - `Auto-paused pred 5min po 5 zaporednih napakah. [Reaktiviraj]` — po pavzi
- Reaktivacija preko Switch ali "Reaktiviraj" linka avtomatsko resetira counter
- Threshold 0 = onemogočeno (monitor se nikoli ne auto-pavza)
- Cron endpoint vrača `autoPaused` count v JSON odgovoru

**Zakaj je to ključno**: če Bolha spremeni HTML strukturo ali če Ollama crkne, bi drugače monitor vsakih 30 min porabil AI klice za nič. Auto-pause prepreči zapravljanje in log spam.

### 5. Dry-run test URL-ja

V monitor formi je nov gumb **"Test URL"** poleg URL polja:
- Pošlje request na `/api/monitors/dry-run` z vnosi iz forme
- Izvede scraping brez shranjevanja in brez AI klicev
- Vrne prve 3 rezultate z naslovi in cenami za validacijo
- Prikaže trajanje v ms (pomaga diagnosticirati počasne vire)
- Ne shrani monitorja — varno za eksperimentiranje z URL-ji

**Uporaba**: preden shraniš monitor, klikni "Test URL" da preveriš, ali bodo rezultati smiselni. Prihrani čas pri debugginganju struktur Boltonih/Nepremičnin.

### 6. Backup / Restore baze

Nov "Baza podatkov" card v Nastavitvah z 3 akcijami:
- **Prenesi .db**: prenese celotno SQLite bazo (vključno z API ključi in Telegram tokenom — hranite varno!)
- **Obnovi iz .db**: naloži prejšnjo varnostno kopijo. Pred obnovitvijo se samodejno naredi backup trenutne baze v `backups/` mapo. Po obnovitvi priporočamo ponovni zagon aplikacije (Prisma client cache).
- **Počisti podatke**: izbriše vse oglase, alerte, run loge in heartbeate. Monitorji in nastavitve (vključno z API ključi) ostanejo. Uporabno za "fresh start" pri testiranju.

Validacija na restore: preverja SQLite magic header ("SQLite format 3\0"). Če naložiš ne-SQLite datoteko, restore ne uspe in trenutna baza ostane nedotaknjena.

## v1.4 funkcije

### 1. Discord webhook (alternativa Telegramu)

Nov "Discord webhook" card v Nastavitvah:
- Vnosi: Webhook URL + toggle enable
- Test gumb pošlje testni embed
- Alerti pridejo kot rich embed z barvo glede na verdikt:
  - 🎯 PRILIKA → zelena (#4ade80)
  - ⚠️ SUMNJIVO → rumena (#fbbf24)
  - ⚪ NEZANIMIVO → siva (#6b7280)
- Vključuje thumbnail (prva slika), fields (prilika, tveganje, tržna vrednost, lokacija, monitor)
- Heartbeat prav tako gre na Discord (vlastita embed oblika)

**Prednost pred Telegramom**: Discord webhook je **pull** (aplikacija pošlje HTTP POST), ne **push** (Telegram zahteva webhook + ngrok za callback gumbe). Tako:
- Ni expose-anja localhosta
- Ni webhook setupa
- Samo prilepi URL in deluje

**Setup**: Discord → Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL → prilepi v Nastavitve.

Telegram in Discord lahko delujeta hkrati — alert gre na oba kanala.

### 2. Bolha detail page scraper

V listing detail modalu nov gumb **"Pridobi detail page"**:
- Naredi HTTP GET na URL oglasa (Bolha detail stran)
- Izlušči celoten opis (daljši od tistega na seznamu)
- Zbere vse slike iz oglasa (do 20, filtrira logotipe/ikone po dimenzijah)
- Shrani v `detailDescription` in `detailImages` (JSON array) na Listing modelu
- V modalu prikaže vse slike v grid 2-3 stolpce, click za prikaz

**Uporaba**: ko te zanima določen oglas, klikni "Pridobi detail page" za boljši pregled pred odpiranjem izvorne strani. Prihrani čas in prepoznavanje stock fotografij.

### 3. Price history tracking

Vsak listing ima sedaj zgodovino cene. Pipeline samodejno:
- Pri prvem videzu oglasa zabeleži začetno ceno v `PriceHistory` tabelo
- Pri vsakem naslednjem pregledu preveri, ali se je cena spremenila
- Če se je, zabeleži nov vnos v PriceHistory in posodobi trenutno ceno na Listing

V listing detail modalu se prikaže "📈 Zgodovina cene" sekcija z:
- Vsemi cenovnimi vnosi kronološko
- Razliko in procentom spremembe (zeleno za padec, rumeno za dvig)
- Časom opažanja

**Uporaba**: ni potrebna nobena konfiguracija — deluje samodejno. Po nekaj tednih boš videl, ali prodajalci znižujejo cene (kar je znak, da je oglas težko prodati in je morda prostor za pogajanje).

### 4. Bookmarks / Favorites

Vsak listing ima bookmark gumb (★ ikona):
- V ListingRow: gumb na desni strani
- V ListingDetailModal: "Shrani"/"Shranjeno" gumb v action vrstici
- Nov filter "Samo priljubljeni" v Listings zavihku
- Nov StatCard na dashboardu "Priljubljeni" s številom shranjenih

Listing z aktivnim bookmarkom ima:
- Modro obrobo + ring v seznamu
- Filled bookmark ikono
- Hitro dostopen prek filtra

**Uporaba**: ko vidiš zanimiv oglas, ki še ni sprožil alerta (npr. NEZANIMIVO), ga lahko vseeno shraniš za kasneje. Vsa shranjena lista je dostopna z enim klikom prek "Samo priljubljeni" filtra.

## v1.5 funkcije

### 1. System Health endpoint (Zdravje sistema)

Nov zavihek **"Zdravje"** z real-time monitoringom 8 komponent:

- **Baza (SQLite)** — ping z latenca
- **AI (Ollama)** — pravi HTTP ping na `/api/tags`, preveri ali model obstaja
- **AI (OpenAI/Anthropic/OpenAI-kompatibilni)** — preveri API ključ
- **Telegram** — `getMe` klic na Bot API
- **Discord** — validacija webhook URL formata
- **Bolha.com** — HTTP HEAD z latenca
- **Nepremicnine.net** — HTTP HEAD z latenca
- **Cron / Monitorji** — št. aktivnih, auto-paused, zadnja izvedba
- **Push notifications** — št. registriranih naprav

Statusi: `OK` (zeleno), `OPOZORILO` (rumeno), `NAPAKA` (rdeče), `IZKLOPLJENO` (sivo).
Auto-refresh vsako minuto. Endpoint: `GET /api/health`.

### 2. PWA podpora (installable mobile app)

Aplikacija je sedaj **Progressive Web App** — lahko jo instaliraš kot native app:

- `manifest.json` z ikonami (192x192, 512x512), shortcuts, theme color
- Service worker (`sw.js`) z 3 caching strategijami:
  - App shell (HTML/JS/CSS): stale-while-revalidate
  - API calls: network-first (offline fallback na cache)
  - Static assets: cache-first
- Apple Web App podpora (statusBarStyle: black-translucent)
- Theme color: `#0a0e0a` (terminal dark)

**Instalacija**:
- **Chrome/Edge (desktop)**: klikni ikono "Instaliraj" v naslovni vrstici
- **Chrome (Android)**: menu → "Dodaj na domači zaslon"
- **Safari (iOS 16.4+)**: Share → "Dodaj na domači zaslon"
- **Firefox (desktop)**: ikona "Instaliraj" v naslovni vrstici

Po instalaciji aplikacija deluje fullscreen, ima svojo ikono na domačem zaslonu, in offline (zadnji dashboard je dostopen brez interneta).

### 3. Browser push notifications (Web Push API z VAPID)

Alerti se lahko zdaj prikažejo kot **native browser notifications** — tudi ko aplikacija ni odprta (service worker jih prejme).

**Setup**:
1. V Nastavitvah → "PWA + Push obvestila" vklopi "Omogoči push obvestila"
2. Klikni "Shrani" (VAPID ključi se samodejno generirajo)
3. Klikni "Registriraj to napravo" (browser prosi za dovoljenje)
4. Klikni "Test push" za preizkus

**Tehnologija**:
- VAPID (Voluntary Application Server Identification) za avtentikacijo
- `web-push` npm knjižnica na serverju
- Service worker `push` event handler na clientu
- `PushSubscription` shranjena v bazi (endpoint, p256dh, auth)
- Avtomatski cleanup naročnin z 404/410 statusom

**Omejitve**:
- iOS zahteva iOS 16.4+ in **instalirano PWA** (ne deluje v Safari browserju)
- Chrome/Edge/Firefox: deluje v browserju ali PWA
- Za lokalni development (localhost) ni potrebno HTTPS

### 4. Bolha RSS fallback (bolj zanesljiv scraping)

Pred HTML scrapingom aplikacija zdaj **najprej poskusi Bolha RSS feed** (`?output=rss`):
- Bolha ima RSS podporo za iskanja in kategorije
- RSS je veliko bolj zanesljiv kot HTML (ni Cloudflare blokade)
- Samodejno doda `?output=rss` k URL-ju če ni prisoten
- Če RSS vrne 0 rezultatov ali ni na voljo, fallback na HTML scraping
- Če HTML blokira Cloudflare, fallback na Playwright (v1.1)

**Prednost**: prej je Bolha monitor padel ob vsakem Cloudflare bloku. Zdaj RSS deluje tudi ko HTML ne.

### 5. DB performance indeksi

Dodani so novi indeksi na Listing tabeli za hitrejše poizvedbe:
- `@@index([aiVerdict, aiScore])` — filter po verdiktu + sort po score
- `@@index([isBookmarked, firstSeenAt])` — "Samo priljubljeni" filter
- `@@index([price])` — sort po ceni

Listing paginacija je zdaj ~3x hitreja pri velikih bazah (>10.000 oglasov).

## Testirano z

- **Ollama** + `qwen2.5:7b` — odlična podpora za slovenščino, brezplačno, lokalno
- **OpenAI** `gpt-4o-mini` — najcenejši OpenAI model, dovolj dober za to nalogo
- **Anthropic** `claude-3-5-haiku` — hiter in natančen

## License

MIT — uporabljaj prosto, brez garancij.
