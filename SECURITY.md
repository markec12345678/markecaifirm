# Security Policy

## Supported Versions

Trenutno podpiramo samo najnovejjo verzijo. Varnostne popravke bomo izdajali samo za `main` branch.

| Version | Supported          |
|---------|--------------------|
| 6.49.x  | ✅ Active support   |
| < 6.49  | ❌ No support       |

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
- API ključi se nikoli ne vračajo v API response
- Fallback provider ima ločen ključ
- Priporočeno: uporabi Ollama za lokalno AI (zero-cloud)

### 3. Web scraping
Projekt vključuje anti-detection funkcije za Bolha.com:
- **Spoštuj robots.txt** in ToS platforme
- **Rate limiting**: privzeto 1-5s delay med requesti
- **User-Agent rotation**: realni browser signaturi
- **Proxy rotation**: priporočeno za production scraping
- **CAPTCHA solving**: samo kadar nujno potrebno

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
