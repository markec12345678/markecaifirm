# Security Policy

## Supported Versions

Trenutno podpiramo samo najnovejjo verzijo. Varnostne popravke bomo izdajali samo za `main` branch.

| Version | Supported          |
|---------|--------------------|
| 9.32.x  | ✅ Active support   |
| 8.94.x - 9.31.x | ⚠️ Security fixes only |
| < 8.94  | ❌ No support       |

## Reporting a Vulnerability

Če najdeš varnostno ranljivost, **NE odpiraj javnega issue-ja**.

Namesto tega:
1. Pošlji email na: `security@markec.local` (private disclosure)
2. Vključi:
   - Opis ranljivosti
   - Koraki za reproduciranje
   - Možen impact
   - Predlagan fix (če ga imaš)

### Response time
- **Potrditev prejema**: 48 ur
- **Prvi assessment**: 7 dni
- **Fix release**: 30 dni (critical), 90 dni (high), 180 dni (medium/low)

### Disclosure policy
- Po fix release bomo objavili public advisory
- Credite bomo dali razkrivalcu (če želi)

## Security Best Practices za deployment

### 1. Environment spremenljivke
```bash
# .env (NI v git!)
DATABASE_URL="file:./prod.db"  # SQLite za local-first, PostgreSQL za production
AI_API_KEY="sk-..."  # nikoli ne commitaj
TELEGRAM_BOT_TOKEN="..."  # nikoli ne commitaj
DISCORD_WEBHOOK_URL="..."
EMAIL_SMTP_PASSWORD="..."
VAPID_PRIVATE_KEY="..."
```

### 2. AI Provider security
- API ključi so shranjeni samo v bazi (Settings tabelo)
- API ključi se nikoli ne vračajo v API response (samo `apiKeySet: boolean` in `apiKeyMasked`)
- Fallback provider ima ločen ključ
- Priporočeno: uporabi Ollama za lokalno AI (zero-cloud)

### 3. Web scraping
Projekt vključuje anti-detection funkcije za Bolha.com:
- **Spoštuj robots.txt** in ToS platforme
- **Rate limiting**: privzeto 1-5s delay med requesti
- **User-Agent rotation**: realni browser signaturi
- **Proxy rotation**: priporočeno za production scraping
- **CAPTCHA solving**: samo kadar nujno potrebno

### 3.5. SSRF zaščita (v6.92)
- Webhook URL in monitor sourceUrl so validirani preko `lib/url-safety.ts`
- Blokirani: privatni IP (10.x, 172.16-31.x, 192.168.x), localhost, AWS metadata (169.254.169.254), link-local (169.254.x), IPv6 ULA/link-local
- Dovoljeni samo http:// in https:// (http blokirano razen z `ALLOW_HTTP_URLS=1`)
- Test webhook (POST `/api/webhooks?test=`) naredi tudi DNS check prepreči DNS rebinding

### 3.6. API avtentikacija (v6.92)
- Vsi API endpoint-i zahtevajo `X-App-Key` header ali `app-key` cookie (enak `APP_API_KEY` env)
- Če `APP_API_KEY` env ni nastavljen, je avtentikacija izklopljena (za local dev)
- Javni (brez avtentikacije): `/`, PWA datoteke, `/api/health`, `/api/telegram/webhook` (ima svoj secret), `/api/push/subscribe`
- Za production: nastavi `APP_API_KEY` z `openssl rand -hex 32`
- Frontend (TODO): settings UI naj ima modal za vnos ključa, ki ga shrani v cookie

### 4. Database security
- SQLite za local-first (privzeto)
- Za multi-user: PostgreSQL z connection pool
- Vsi inputi validirani preko Prisma client
- SQL injection zaščita preko Prisma parameterized queries

### 5. Notification security
- Telegram bot token v bazi (encrypted at rest v production)
- Discord/Slack webhooks v bazi
- Email SMTP credentials v bazi
- VAPID keys za Web Push v bazi
- v6.92: Slack Block Kit popravljen (prej `mrkdwn_section` neveljaven — tiho zavrnil payload)
- v6.92: Email HTML-escape vseh uporabniških vsebin (XSS zaščita)
- v6.92: Telegram MarkdownV2 (prej Markdown V1 — zastarelo)
- v6.92: Rate-limit (429) handling za Telegram, Slack

### 6. Known security considerations

#### Anti-detection uporaba
Anti-detection funkcije so namenjene **poštenemu scraping-u**. Ne uporabljaj za:
- Bypassing paywalls
- Scraping osebnih podatkov brez privolitve
- Prekomerno loadanje platform (DoS)
- Circumventing CAPTCHA za fraud

#### AI prompt injection
Vsi AI inputs so sanitizirani:
- User input nikoli direktno v prompt brez validacije
- JSON parsing je loose (parseJsonLooseExported) ampak validiran
- String slicing preprečuje overflow
- Math clamping preprečuje NaN/Infinity

#### Web Push notifications
- VAPID keys morajo biti generirane lokalno (glej README)
- Subscriptions so vezane na specifične VAPID keys
- Push notifications ne vsebujejo občutljivih podatkov

## Compliance

### GDPR (EU)
- Aplikacija je local-first (SQLite lokalno)
- Nobeni podatki ne zapustijo strežnika razen AI API calls
- AI provider-ji morajo biti GDPR compliant (OpenAI, Anthropic so)
- Za lokalno AI: Ollama (zero data leaves your machine)

### Slovenian law
- Scraping Bolha.com mora upoštevati njihov ToS
- Osebni podatki kupcev (sellLocation) se obdelujejo lokalno
- Ni tracking third-party oseb

## Dependency security

```bash
# Check for vulnerabilities
bun audit

# Update dependencies
bun update

# Specifically security updates
bun update --security
```

Vsa dependencie so zaklenjene v `bun.lock`. Pri update-ih preverjamo:
- Breaking changes
- Security advisories
- Bundle size impact

## Contact

- **Security issues**: security@markec.local
- **General questions**: GitHub Issues
- **Feature requests**: GitHub Issues z `[feat]` label

---

## v9.x Security Enhancements

### Modularna arhitektura (v8.94-v9.09)
- **193 modulskih datotek** v 17 direktorijeh — manjša attack surface per modul
- Vsak modul je samostojen z lastnim state-om — lažje auditiranje
- Shared types/utils centralizirani — eno mesto za varnostne preglede

### Dependency Cleanup (v9.31)
- **8 nepotrebnih paketov odstranjenih** (zod, zustand, @dnd-kit, react-syntax-highlighter, @mdxeditor/editor)
- Manj paketov = manj attack surface = manj varnostnih tveganj
- 86 → 78 paketov (−9.3%)

### Security Audit (v9.32)
- **1/2 vulnerabilities fixed** (deepmerge-ts — stack exhaustion)
- 1 remaining: nanoid (transitive od postcss — nizko tveganje, ne uporabljamo custom generators z size=0)
- 12 paketov posodobljenih na najnovejše varne verzije

### CI/CD Security (v9.26)
- **3 GitHub Actions workflow-i** avtomatsko preverjajo:
  1. `ci.yml`: lint + typecheck + build + `bun audit` (security audit)
  2. `ai-endpoints.yml`: auto-update endpoint dokumentacije
  3. `module-check.yml`: module count verification (prepreči accidental deletion)
- CI **ne tolerira napak** — `continue-on-error: true` je odstranjen
- Build/lint/typecheck failure ustavi CI

### Service Worker (v8.95)
- SW registracija samo v production (`process.env.NODE_ENV === 'production'`)
- V dev mode: SW se unregister-a + vsi cache-ji se izbrišejo
- Preprečuje ChunkLoadError v dev mode zaradi stale chunk cache

### Priporočila za deployment
1. **`.env` NI v git** — vse skrivnosti (API ključi, gesla) so lokalne
2. **API ključi** so shranjeni v SQLite z enkripcijo na aplikacijskem nivoju
3. **VAPID ključi** (Web Push) so P-256 ECDSA generirani
4. **Telegram webhook secret** je naključno generiran
5. **Cron key** (`MONITOR_CRON_KEY`) ščiti cron endpoint-e
6. **SSRF zaščita** (`isUrlSafe()`) na vseh outbound URL-jih
7. **HTML escape** na vseh uporabniških vsebinah v email HTML-ju
8. **Slack Block Kit** uporablja `type: 'mrkdwn'` (ne neveljaven `mrkdwn_section`)
9. **Telegram MarkdownV2** z `escapeMd()` na uporabniških tekstih
