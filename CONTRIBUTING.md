# Contributing to Markec AI Firm

Hvala za zanimanje za prispevek k projektu! 🎉

Ta dokument opisuje proces dodajanja novih funkcij, popravkov in izboljšav.

## 📋 Vsebina

- [Code of Conduct](#code-of-conduct)
- [Preden začneš](#preden-zzačneš)
- [Development setup](#development-setup)
- [Coding standards](#coding-standards)
- [AI endpoint konvencije](#ai-endpoint-konvencije)
- [Commit guidelines](#commit-guidelines)
- [Pull Request proces](#pull-request-proces)
- [Testing](#testing)
- [Issue reporting](#issue-reporting)

## Code of Conduct

Sodelovanje v projektu zahteva profesionalno in spoštljivo komunikacijo. Pričakujemo:
- Konstruktivno kritiko brez osebnih napadov
- Tehnično argumentacijo za predloge
- Pomoč novincem in začetnikom
- Spoštovanje različnih pristopov in mnenj

## Preden začneš

1. **Preveri obstoječe issue-je** — morda je tvoja ideja že v obravnavi
2. **Odpri issue pred velikimi spremembami** — da ne delamo konfliktno
3. **Preberi [README.md](./README.md)** — razumev arhitekturo in konvencije

## Development setup

```bash
# Kloniraj repo
git clone https://github.com/markec12345678/markecaifirm.git
cd markecaifirm

# Namesti dependencies (priporočeno bun)
bun install

# Setup database (SQLite, local-first)
cp .env.example .env  # če obstaja, sicer ustvari
bun run db:generate
bun run db:push

# Zaženi dev server
bun run dev
# Odpri http://localhost:3000
```

### Zahtevane verzije
- Node.js >= 20.0.0
- Bun >= 1.0.0 (priporočeno za hitrost)
- Git

### AI provider konfiguracija
V Settings UI (http://localhost:3000/settings) nastavi:
- AI provider (Ollama / OpenAI / Anthropic / OpenRouter / Gemini / OpenAI-compatible)
- Model (npr. `qwen2.5:7b` za Ollama, `gpt-4o-mini` za OpenAI)
- API ključe (kjer potrebno)

## Coding standards

### TypeScript
- **Strict mode** je omogočen
- Vsi endpointi morajo biti tipizirani (no `any` kadar se da)
- Uporabljaj `interface` za kompleksne objekte
- Preferiraj `const` pred `let`

### ESLint
```bash
bun run lint
```
Code mora biti brez ESLint napak. Warnings so dovoljeni.

### TypeCheck
```bash
bun run typecheck
```
Vsak PR mora imeti 0 novih TS napak (trenutno 24 obstoječih, postopoma odpravljamo).

## AI endpoint konvencije

Nov AI endpoint mora slediti temu vzorcu:

```typescript
// vX.Y: AI [Ime funkcije] — kratek opis
// POST /api/ai/[ime-funkcije]
// Body: { parametri }
// Returns: { ok, [glavni rezultat], [podporni rezultati], summary }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60-120; // odvisno od kompleksnosti

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // 1. Pridobi podatke iz baze
    const data = await db.model.findMany({ ... });

    if (data.length === 0) {
      return NextResponse.json({ ok: true, result: null, message: 'Ni podatkov.' });
    }

    // 2. Pripravi AI settings z fallback
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // 3. Konstruiraj prompt
    const prompt = `Si AI [funkcija]. ...`;

    // 4. Kliči AI z fallback
    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    // 5. Parsiraj in validiraj
    const parsed: any = parseJsonLooseExported(raw);
    const result = { /* mapped fields z Math.max/min in String().slice() validacijo */ };

    // 6. Update AI call counter
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    // 7. Return
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
```

### Konvencije
- Vsi string iz AIja morajo biti `String(x).slice(0, maxDolzina)` validirani
- Vsi številski iz AIja morajo biti `Math.max(0, Math.min(maxVal, Number(x)))` validirani
- Enumi morajo biti `['a','b','c'].includes(String(x)) ? String(x) : 'default'`
- ID-ji iz AIja morajo biti preverjeni proti `validIds` Set iz baze
- Vračaj `{ ok: true, ... }` za uspeh, `{ ok: true, result: null, message: '...' }` za prazne rezultate

## Commit guidelines

Sledimo [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Tipi
- `feat`: nova funkcija (`feat(v6.50): AI XYZ function`)
- `fix`: popravki bugov (`fix(negotiation): handle empty messages`)
- `docs`: dokumentacija (`docs: update README with v6.50 features`)
- `style`: formatiranje, brez logike
- `refactor`: refaktoriranje brez sprememb funkcionalnosti
- `perf`: performance izboljšave
- `test`: dodajanje testov
- `chore`: maintenance (deps, config)

### Scope (neobvezno)
- verzija (`v6.50`)
- modul (`negotiation`, `dashboard`, `ai`)
- endpoint ime

### Primeri
```
feat(v6.50): AI Listing Performance Forecaster with seasonal trends

fix(listing-rotation): handle null imageUrl case

docs: update CHANGELOG for v6.49 release

chore(deps): bump prisma to 6.20.0
```

## Pull Request proces

1. **Fork + branch**
   ```bash
   git checkout -b feat/v6.50-ai-xyz-function
   ```

2. **Commit logične enote** — ne mešaj več funkcij v en PR

3. **Testiraj lokalno**
   ```bash
   bun run lint
   bun run typecheck
   bun run build
   ```

4. **Push + odpravi PR**
   ```bash
   git push origin feat/v6.50-ai-xyz-function
   ```

5. **PR template** (samodejno se naloži):
   - Jasen opis funkcije
   - Screenshot (če UI sprememba)
   - Breaking changes opozorilo
   - Povezani issue-ji (`Closes #123`)

6. **Code review** — vsi PR-ji morajo biti reviewani pred merge

7. **Squash merge** — da ima main čisto zgodovino

### PR checklist
- [ ] Code sledi coding standards
- [ ] ESLint brez napak
- [ ] TypeScript brez novih napak
- [ ] Endpoint dokumentiran v glavi datoteke
- [ ] README posodobljen (če je nova funkcija)
- [ ] CHANGELOG.md posodobljen
- [ ] Verzija v `package.json` in `page.tsx` posodobljena

## Testing

Trenutno projekt nima avtomatskih testov, a načrtujemo:
- Unit testi za `lib/ai.ts` (provider switching, fallback)
- Integration testi za AI endpointe z mock LLM
- E2E testi za glavne user flow-e (Playwright)

Do takrat testiraj ročno:
1. Zaženi dev server
2. Testiraj vsak nov endpoint z realnimi podatki
3. Preveri da fallback deluje (izklopi primary AI)
4. Preveri edge cases (prazna baza, null vrednosti)

## Issue reporting

### Bug report
- **Title**: `[bug] kratek opis`
- **Description**: kaj se zgodi, kaj bi moralo
- **Koraki za reproduciranje**: 1. 2. 3.
- **Environment**: Node verzija, OS, AI provider
- **Screenshot/Log**: če relevantno

### Feature request
- **Title**: `[feat] AI XYZ funkcija za ...`
- **Use case**: zakaj to rabimo
- **Predlagana implementacija**: kratek opis
- **Alternativne rešitve**: kaj si še premislil

### Endpoint request
- **Ime**: `/api/ai/ime-funkcije`
- **Input**: kaj sprejme
- **Output**: kaj vrne
- **AI logika**: kaj naj AI naredi

## Verzija

Trenutna verzija: **v7.09.0**

### v6.92 Security fixes (obvezno preberi)

Pri v6.92 so popravljene resne varnostne težave. Pri dodajanju novih funkcij **upostevaj**:

1. **SSRF zaščita**: vsi outbound URL-ji (webhook, monitor sourceUrl) morajo iti skozi `isUrlSafe()` iz `@/lib/url-safety`. Nikoli ne kliči `fetch()` z uporabniško podanim URL-jem brez validacije.
2. **Email XSS**: vsi uporabniški vsebinski deli v email HTML-ju morajo biti HTML-escape-ani z `escapeHtml()` iz `@/lib/email`. Naslov oglasa pride iz scraper-ja — ne zaupamo mu.
3. **Slack Block Kit**: uporabljaj `type: 'mrkdwn'` (ne `mrkdwn_section` — neveljaven). Fields v `section` bloku: `{ type: 'mrkdwn', text: '...' }`.
4. **Telegram MarkdownV2**: `parse_mode: 'MarkdownV2'` (ne `Markdown`). Vsi uporabniški teksti morajo biti escape-ani z `escapeMd()`.
5. **CI ne tolerira napak**: `continue-on-error: true` je odstranjen. Build/lint/typecheck failure bo ustavil CI.
6. **TypeScript**: `ignoreBuildErrors: false` in `reactStrictMode: true` v `next.config.ts`. TS napake bodo lomile build.
Verzija je v formatu `vMAJOR.MINOR.PATCH` kjer:
- MAJOR: velike arhitekturne spremembe
- MINOR: nove AI funkcije (vsak sprint ~3 nove funkcije)
- PATCH: bug fixi in male izboljšave

---

Hvala za tvoj prispevek! 🚀

— markec12345678
