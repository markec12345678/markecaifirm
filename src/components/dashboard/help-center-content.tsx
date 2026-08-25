'use client';

/**
 * v9.52: Help Center Content — kategorizirani članki po vzoru Sellerboard.
 *
 * Navdih: help.sellerboard.com (6 kategorij + search + FAQ).
 *
 * Struktura:
 *   🔍 Search bar
 *   📚 7 kategorij:
 *     1. Začetek (Getting Started)
 *     2. Monitorji & iskanje
 *     3. AI analiza (Deal Score, Buy Score)
 *     4. Skladišče & trgovine
 *     5. Analitika & poročila
 *     6. Nastavitve & integracije
 *     7. Troubleshooting
 *   ❓ FAQ
 *   🎥 Video tutoriji
 *   ✉️ Kontakt
 *
 * Vsak članek: naslov + kratek povzetek + "Preberi več" → modal s podrobnostmi.
 */

import { useState, useMemo } from 'react';
import { Search, ChevronRight, X, BookOpen, HelpCircle, Video, Mail, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Article {
  id: string;
  title: string;
  summary: string;
  content: string;
  category: string;
}

interface Category {
  id: string;
  title: string;
  icon: string;
  accent: string;
  articles: Article[];
}

// ═══════════════════════════════════════════════════════════════════════
// ČLANKI — 27 člankov v 7 kategorijah (v slovenščini)
// ═══════════════════════════════════════════════════════════════════════

const CATEGORIES: Category[] = [
  {
    id: 'zacetek',
    title: 'Začetek',
    icon: '🚀',
    accent: 'text-emerald-500',
    articles: [
      {
        id: 'kaj-je',
        title: 'Kaj je Markec AI Firm?',
        summary: 'AI lovec priložnosti za slovenske in evropske portale.',
        category: 'zacetek',
        content: `Markec AI Firm je lokalna aplikacija (local-first, zero-cloud), ki avtomatsko spremlja oglase na slovenskih in evropskih portalih (Bolha, Nepremičnine, Vinted, Avtonet, mobile.de in drugi), jih analizira z AI in te opozori na priložnosti za nakup in prodajo (flipping).

**Glavne funkcije:**
- 432 AI endpointov za analizo oglasov
- 11 podprtih platform
- Real-time alerti preko SSE
- Telegram/Discord/Email obvestila
- AI Deal Score (0-100) za vsak oglas
- Skladišče trgovin z dobičkom
- Davčno poročilo PDF

**Zakaj local-first?**
Vsi podatki ostanejo na tvojem računalniku. Noben oblak. Edino kar zapusti tvoj sistem je AI API klic (če uporabljaš OpenAI/Anthropic) — ali pa uporabiš Ollama na localhostu za popolnoma zasebno analizo.`,
      },
      {
        id: 'prvi-koraki',
        title: 'Prvi koraki v 5 minutah',
        summary: 'Setup checklist: AI → Monitor → Cron → Poženi → Obvestila.',
        category: 'zacetek',
        content: `**Setup checklist (6 korakov):**

1. **Nastavi AI provider** — Nastavitve → AI → Ollama (brezplačno, localhost) ali OpenAI API ključ
2. **Ustvari prvi monitor** — Monitorji → Nov monitor → vstavi Bolha/Vinted URL
3. **Nastavi zunanji cron** — GET /api/cron/run-all vsakih 30 min (brez tega sistem ne deluje avtomatsko!)
4. **Poženi monitor** — Monitorji → Poženi (ali počakaj na cron)
5. **Omogoči Web Push** — Nastavitve → Web Push → Generiraj VAPID ključe
6. **Shrani iskanje v Iskalniku** — Iskalnik → išči → Shrani iskanje (postane auto-monitor)

**Naslednji koraki:**
- Dodaj trade v Skladišče (Dodaj trade gumb ali Mobile FAB)
- Pregleduj Decision Accuracy v AI tab-u za validacijo AI priporočil
- Mesečni cilj dobička v Pregled tab → Goal Tracker`,
      },
      {
        id: 'kako-delajo-monitorji',
        title: 'Kako delujejo monitorji?',
        summary: 'Monitor = iskalni URL + AI analiza + alerti.',
        category: 'zacetek',
        content: `**Monitor** je iskalni URL na enem od podprtih portalov. Vsakih 30 minut (ali po cron urniku) sistem:

1. **Pobere** nove oglase z iskalnega URL
2. **Analizira** vsak oglas z AI (Deal Score, verdikt PRILIKA/SUMNJIVO/NEZANIMIVO)
3. **Shrani** v bazo oglasov
4. **Pošlje alert** če je verdikt PRILIKA ali padec cene

**Tipičen primer:**
- Bolha iskanje "iPhone 13" → monitor najde 5 novih oglasov
- AI oceni vsakega: 3× PRILIKA, 1× SUMNJIVO, 1× NEZANIMIVO
- Prejmeš Telegram alert za 3 priložnosti
- Klikneš na alert → vidiš podrobnosti (cena, AI razlog, deal score)
- Označiš kot "Kontaktiran" → dodaj v Watchlist ali Skladišče

**Tag-iranje monitorjev:**
Vsak monitor ima lahko tags (npr. "elektronika", "hitri-flip"). Tags omogočajo filtriranje v UI in se uporabljajo za Restock Recommendations.`,
      },
      {
        id: 'cron-setup',
        title: 'Zunanji cron — zakaj in kako',
        summary: 'GET /api/cron/run-all vsakih 30 min za avtomatsko delovanje.',
        category: 'zacetek',
        content: `**Zakaj zunanji cron?**
Next.js aplikacija ne more vzdrževati cron job-a sama (serverless environment). Zato rabiš zunanji cron service, ki vsakih 30 minut pokliče \`GET /api/cron/run-all\`.

**Možnosti cron service-ov:**
- **cron-job.org** (brezplačno, enostavno)
- **EasyCron** (brezplačni tier)
- **GitHub Actions** (brezplačno za public repos)
- **VPS crontab** (če imaš lasten server)

**Setup na cron-job.org:**
1. Registriraj se na cron-job.org
2. Ustvari nov job
3. URL: \`https://tvoja-domena/api/cron/run-all\`
4. Interval: vsakih 30 minut
5. Shrani in aktiviraj

**Preverjanje delovanja:**
- Pregled → Zadnje izvedbe (vidiš zadnja poganjanja)
- Sistem → Zdravje (health status)
- Sistem → Obvestila (zgodovina izvedb)

**Brez cron-a:**
Aplikacija še vedno deluje — ročno poženeš monitorje z gumbom "Poženi vse monitorje".`,
      },
    ],
  },
  {
    id: 'monitorji',
    title: 'Monitorji & iskanje',
    icon: '🔍',
    accent: 'text-sky-500',
    articles: [
      {
        id: 'dodaj-monitor',
        title: 'Kako dodati monitor?',
        summary: 'Monitorji → Nov monitor → vstavi iskalni URL.',
        category: 'monitorji',
        content: `**Koraki za dodajanje monitorja:**

1. Pojdi v **Monitorji** (zavihek v navigaciji)
2. Klikni **"Nov monitor"**
3. Izpolni formo:
   - **Ime**: npr. "Bolha iPhone 13"
   - **URL**: vstavi poln iskalni URL iz Bolhe/Vinted/etc
   - **Platforma**: izberi (Bolha, Vinted, Nepremičnine, Avtonet, mobile.de...)
   - **AI analiza**: vklopi (privzeto)
   - **Tags**: dodaj tag-e za filtriranje (npr. "elektronika", "premium")
4. Shrani

**Po dodajanju:**
- Monitor se pojavi v seznamu z statusom "Aktiven"
- Po prvem cron-u (ali ročnem poganjanju) začne najti oglase
- AI analiza se zgodi avtomatsko za vsak najden oglas

**Tipi URL-jev, ki delujejo:**
- Bolha: iskanje po ključnih besedah, kategorijah
- Vinted: iskanje po kategorijah, blagovnih znamkah
- Nepremičnine: iskanje po lokaciji, ceni
- Avtonet: iskanje po modelih, letniku
- mobile.de: iskanje po vozilih

**Nasvet:** Uporabi specifične iskalne URL-je za boljše rezultate (npr. "iPhone 13 128GB" namesto samo "iPhone").`,
      },
      {
        id: 'podprti-portali',
        title: 'Kateri portali so podprti?',
        summary: '11 slovenskih in evropskih portalov.',
        category: 'monitorji',
        content: `**Podprti portali (11):**

**Slovenski:**
- Bolha.com (splošni oglasi)
- Nepremičnine.com (nepremičnine)
- Avtonet.si (avto-deli, vozila)
- Vinted (moda, obutev)

**Evropski:**
- mobile.de (vozila, Nemčija)
- Autoscout24 (vozila, EU)
- eBay (svetovni)
- Willhaben.at (Avstrija)
- Kijiji (Kanada)
- Leboncoin.fr (Francija)
- Subito.it (Italija)

**Dodajanje novih portalov:**
Aplikacija podpira dodajanje novih scraper-jev v \`src/lib/scraper.ts\`. Vsak scraper mora implementirati:
- \`scrapeListings(url)\` — pobere oglase z iskalne strani
- \`parseListing(html)\` — izlušči podatke (naslov, cena, slika, URL)

**Nasvet za tujino:**
Za mobile.de in druge tuje portale lahko omogočiš "Stealth mode" v Nastavitve → Anti-detekcija za bolj zanesljivo pobiranje.`,
      },
      {
        id: 'iskalnik',
        title: 'Iskalnik — ciljno iskanje',
        summary: 'Iskalnik najde specifične artikle po vseh portalih.',
        category: 'monitorji',
        content: `**Iskalnik** je napredna funkcija za ciljno iskanje artiklov:

1. Pojdi v **Več → Iskalnik** (ali uporabi bližnjico 'i')
2. Vnesi iskalni izraz (npr. "Sony A7III", "MacBook Pro M2")
3. Izberi portale (lahko vse ali specifične)
4. Določi filtre:
   - **Cena min/max**: omeji na tvoj budget
   - **Lokacija**: država/regija
   - **Kategorija**: elektronika, avto, moda...
5. Klikni "Išči"

**Rezultati:**
- Seznam oglasov z vseh izbranih portalov
- AI verdikt za vsak oglas (PRILIKA/SUMNJIVO)
- Deal Score (0-100)
- Cross-platform primerjava cen

**Shranjevanje iskanja:**
- Klikni "Shrani iskanje" → postane auto-monitor
- Vsakih 30 min preveri nove oglase za ta iskalni izraz
- Pošlje alert če najde PRILIKA

**Match Request:**
- Če si Iskalniku našel ujemanje (npr. isti artikel ceneje na drugem portalu), klikni "Match Request"
- Sistem ustvari trade povezavo za arbitrage tracking`,
      },
      {
        id: 'tags-filtri',
        title: 'Tags in filtri za monitorje',
        summary: 'Organiziraj monitorje z tags za Restock Recommendations.',
        category: 'monitorji',
        content: `**Tags** omogočajo organizacijo monitorjev in trade-ov:

**Dodajanje tags:**
- Pri ustvarjanju monitorja: polje "Tags" (več tagov loči z vejico)
- Pri dodajanju trade-a: Tags za kategorijo, vir, strategijo

**Uporaba tags:**
1. **Filtriranje v UI** — klik na tag chip prikazuje samo tiste monitorje/trade-e
2. **Restock Recommendations** — sistem analizira ROI po tag-ih in priporoča kaj kupiti naslednje
3. **Tag Performance** — v Analitika tab vidiš ROI per tag (npr. #bolha 25% ROI, #vinted 86% ROI)

**Priporočeni tags:**
- **Vir**: #bolha, #vinted, #avtonet, #mobile.de
- **Kategorija**: #elektronika, #avto, #moda, #orodje
- **Strategija**: #hitri-flip, #premium, #flip, #brand
- **Status**: #v-skladiscu, #prodano, #rezerva

**Primer:**
Monitor "Bolha iPhone 13" z tags "bolha, elektronika, premium" → sistem ve, da je to premium elektronika iz Bolhe in ga vključi v Restock analizo za to kategorijo.`,
      },
    ],
  },
  {
    id: 'ai-analiza',
    title: 'AI analiza',
    icon: '🤖',
    accent: 'text-amber-500',
    articles: [
      {
        id: 'deal-score',
        title: 'Kaj je Deal Score (0-100)?',
        summary: 'AI ocena kvalitete oglasa — višji = boljša priložnost.',
        category: 'ai-analiza',
        content: `**Deal Score** je AI ocena od 0 do 100 za vsak oglas, ki napoveduje kako dobra priložnost je za nakup in prodajo (flip).

**Kako deluje:**
AI analizira:
- **Ceno** glede na tržno povprečje za podobne artikle
- **Stanje** (novo, rabljeno, poškodovano)
- **Lokacijo** (dostopnost, transporte)
- **Prodajalca** (zgodovina, rating)
- **Slike** (VLM analiza — kaj je na sliki)
- **Ključne besede** v naslovu in opisu

**Verdikt:**
- **PRILIKA** (score 76-100) — močna kupnina, visok ROI
- **KUPÍ** (score 51-75) — dobra kupnina
- **PREMISLI** (score 26-50) — mejno, rabi več raziskave
- **IZOGIBAJ** (score 0-25) — slab deal, izguba

**Deal Score razlogi:**
AI ne vrne samo številke — vrne tudi razloge:
- "Cena je 35% pod tržnim povprečjem"
- "Stanje je novo, nepoškodovano"
- "Prodajalec ima 4.8★ rating (124 transakcij)"
- "Slike kažejo originalno embalažo"

**Kje vidiš Deal Score:**
- Oglasi → posamezen oglas → modal
- Alerti → AI verdikt
- Pregled → Buy Opportunity kartica (top 3 priložnosti)`,
      },
      {
        id: 'buy-score',
        title: 'Buy Score — kako deluje?',
        summary: 'Buy Score = predikcija dobička pred nakupom.',
        category: 'ai-analiza',
        content: `**Buy Score** je AI ocena (0-100), ki napoveduje dobiček pred nakupom trade-a. Razlika od Deal Score: Buy Score se računa specifično za tvoje trgovine (z upoštevanjem tvojega budget-a, kategorije, zgodovine).

**Kako se izračuna:**
AI upošteva:
- **Deal Score** oglasa (osnova)
- **Tvoja zgodovina** v tej kategoriji (ROI, win rate, hold čas)
- **Current inventory** (ali imaš že podobne artikle)
- **Tržni trend** (rastoče/padajoče povpraševanje)
- **Cena v razmerju do tvojega budget-a**

**Kdaj se izračuna:**
1. **Ob dodajanju trade-a** iz oglasa → avtomatsko
2. **Backfill** — za obstoječe trade-e brez Buy Score (glej skripte/backfill-*)
3. **Ročno** — v AI Hub → "Ponovno izračunaj"

**Verdikt:**
- STRONG_BUY (85-100) — izjemna priložnost
- BUY (51-84) — dobra kupnina
- RISKY (26-50) — mejno
- AVOID (0-25) — izguba

**Kje vidiš Buy Score:**
- Skladišče → posamezen trade → modal
- Trgovine tab → Trade Stats → stolpec "Buy Score"
- AI Hub → Buy Opportunity`,
      },
      {
        id: 'decision-accuracy',
        title: 'Decision Accuracy — validacija AI',
        summary: 'Ali Buy Score dejansko napoveduje dobiček? Preveri!',
        category: 'ai-analiza',
        content: `**Decision Accuracy** je meta-analiza, ki preverja ali tvoj AI buy scoring sistem dejansko deluje. To je funkcija, ki je nimajo konkurenti (BuyBotPro, Sellerboard).

**3 dimenzije analize:**

1. **Buy Score Accuracy** — ali visok buy score napoveduje visok outcome?
   - Pearson korelacija med buy score in outcome score
   - 0.5+ = STRONG (dober algoritem)
   - 0.3-0.5 = MODERATE (zmerno zanesljiv)
   - <0.3 = WEAK/NONE (potrebna kalibracija)
   - Negativna = INVERTED (algoritem je pokvarjen!)

2. **Smart Price Accuracy** — ali AI predlagana cena je bila blizu dejanske prodajne cene?
   - % trade-ov znotraj [suggestedMin, suggestedMax]
   - 80%+ = dobro kalibriran

3. **Overall Intelligence Health** (0-100, grade A-F)
   - A (90+): Odlična kalibracija
   - B (80-89): Dobro
   - C (70-79): Zmerno
   - D (60-69): Slabo
   - F (<60): Potrebna kalibracija

**Kje vidiš:**
- AI tab → "Decision Accuracy" kartica
- Pregled tab → Win Rate KPI (klik vodi v AI Hub)

**Bucket analiza:**
4 bucket-i (0-25, 26-50, 51-75, 76-100) z:
- Številom trade-ov v tem bucket-u
- Povprečnim outcome score
- Povprečnim profitom
- Win rate

**Idealno stanje:**
- Bucket 76-100 (STRONG_BUY): visok outcome, 100% win rate
- Bucket 0-25 (AVOID): nizek outcome, izguba

Če vidiš inversijo (visok buy score → nizek outcome), popravi algoritem v \`src/lib/trades/buy-opportunity.ts\`.`,
      },
      {
        id: 'smart-price',
        title: 'Smart Price kalkulacija',
        summary: 'AI predlaga optimalno prodajno ceno glede na trg.',
        category: 'ai-analiza',
        content: `**Smart Price** je AI kalkulacija optimalne prodajne cene za tvoj artikel:

**Vhodni podatki:**
- Tvoja nabavna cena + fees
- Tržna povprečna cena (iz komparabilnih prodaj)
- Kategorija (povprečni ROI, hold čas)
- Čas v skladišču (aging)

**Izhod:**
- **suggestedMin** — minimalna sprejemljiva cena
- **suggestedOptimal** — priporočena cena
- **suggestedMax** — maksimalna realna cena
- **razlog** (AI explanation)

**Kdaj uporabiti:**
1. **Ob prodaji** — preveri ali je tvoja cena znotraj [min, max]
2. **Za pricing strategijo** — določi začetno ceno
3. **Za pogajanja** — veš kdaj sprejeti ponudbo

**Kje vidiš:**
- Skladišče → posamezen trade → "Smart Price" sekcija
- Trgovine tab → Deal Calculator (hitra simulacija)
- Outcome Scorecard (post-sale analiza)

**Interpretacija:**
- Če si prodal **nad max** → imel si srečo (overpriced/lucky)
- Če si prodal **v obsegu** → dobro (84% je dober rezultat)
- Če si prodal **pod min** → podcenjeno (pustil denar na mizi)

**Decision Accuracy:**
Sistem preverja kako natančni so bili smart price predlogi. Če je withinRange > 80%, je AI dobro kalibriran.`,
      },
    ],
  },
  {
    id: 'skladisce',
    title: 'Skladišče & trgovine',
    icon: '🛒',
    accent: 'text-emerald-500',
    articles: [
      {
        id: 'dodaj-trade',
        title: 'Dodajanje trade-ov',
        summary: 'Dodaj trade ročno ali iz oglasa.',
        category: 'skladisce',
        content: `**Dodajanje trade-a — 3 načini:**

1. **Iz oglasa** (najboljše):
   - Oglasi → posamezen oglas → "Shrani kot trade"
   - Sistem avtomatsko izpolni: naslov, cena, URL, slika
   - Buy Score se izračuna avtomatsko

2. **Hitri dodaj (FAB)**:
   - Mobile: plavajoči + gumb na dnu
   - Desktop: "Dodaj trade" gumb v Pregled header
   - Hitra forma: naslov, buy cena, kategorija, vir

3. **Ročno v Skladišču**:
   - Skladišče → "Dodaj trade" → polna forma
   - Vsa polja: buy cena, buy fees, buy datum, buy lokacija, tags, opombe

**Status trade-a:**
- **held** — v skladišču, čaka prodajo
- **sold** — prodan (vnos sell cena + datum)

**Po prodaji:**
1. Odpri trade → "Označi kot prodano"
2. Vnesi: sell cena, sell datum, sell lokacija, sell fees
3. Sistem izračuna: profit, ROI, hold čas
4. Outcome Scorecard se avtomatsko generira (post-sale analiza)

**Import CSV:**
- Skladišče → Import CSV (za množični uvoz iz Excel/Google Sheets)
- Prenesi CSV template iz Skladišče → "CSV template"`,
      },
      {
        id: 'flip-status',
        title: 'Flip Status — aging alerts',
        summary: 'Opozorila za artikle, ki predolgo čakajo na prodajo.',
        category: 'skladisce',
        content: `**Flip Status** prikazuje artikle v skladišču z aging alerti:

**Aging kategorije:**
- 🟢 **0-9 dni** — sveže, normalno
- 🟡 **10-20 dni** — začni razmišljati o znižanju cene
- 🟠 **21-35 dni** — znižaj ceno! (15-20% popust priporočeno)
- 🔴 **36+ dni** — zastarelo! Ustavi izgubo, prodaj hitro

**Kako deluje:**
- Sistem preverja \`buyDate\` vs danes
- Auto-generira alert če je hold > 20 dni
- Predlaga novo ceno (15-20% nižje)

**Kje vidiš:**
- Trgovine tab → "Flip Status" widget
- AI tab → Daily Briefing (prioritetna prodaja)

**Akcije:**
1. **Znižaj ceno** — ročno v nastavitvah trade-a
2. **Premakni v drugo kategorijo** — reclassify
3. **Označi kot izguba** — prodi pod ceno, zapiši kot loss

**Preprečevanje zastaranja:**
- Vedno nastavi \`targetSellPrice\` ob nakupu
- Uporabi Smart Price za pravilno začetno ceno
- Preverjaj Flip Status vsaj 1× na teden`,
      },
      {
        id: 'deal-calculator',
        title: 'Deal Calculator',
        summary: 'Hitra ROI kalkulacija pred nakupom.',
        category: 'skladisce',
        content: `**Deal Calculator** je interaktivni widget za hitro ROI kalkulacijo:

**Vhodi:**
- Buy cena
- Sell cena (predvidena)
- Buy fees (Bolha provizija, transport)
- Sell fees (Bolha provizija, pakiranje, transport)
- Davki (opcijsko)

**Izhodi:**
- **Net profit** (€)
- **ROI** (%)
- **Marža** (%)
- **Break-even cena** (minimalna prodajna cena)
- **Na dan / teden / mesec** (projekcija)

**Verdikt:**
- 🟢 BUY — dober deal (>30% ROI)
- 🟡 RISKY — mejno (15-30% ROI)
- 🔴 AVOID — slab deal (<15% ROI)

**Kje vidiš:**
- Trgovine tab → "Deal Calculator" widget
- Pregled tab → Deal Calculator (na dnu)

**Shranjevanje:**
- Klik "Shrani kot trade (held)" → direkt v Skladišče
- Buy Score se izračuna avtomatsko

**Nasvet:**
Vedno vnesi realne fees! Bolha provizija je 5% + 0.50€, transport 5-15€. Brez fees boš razočaran.`,
      },
      {
        id: 'restock',
        title: 'Restock Recommendations',
        summary: 'AI predlaga kaj kupiti naslednje za maksimalen profit.',
        category: 'skladisce',
        content: `**Restock Recommendations** je AI funkcija, ki odgovarja na vprašanje: **"Kaj naj kupim naslednje?"**

**Kako deluje:**
1. Sistem analizira tvojo zgodovino prodaj (po kategorijah)
2. Primerja z current held inventory
3. Izračuna za vsako kategorijo:
   - Povprečni ROI
   - Povprečni hold čas
   - Win rate
   - Projected profit
4. Določi status: RESTOCK / MAINTAIN / REDUCE / AVOID

**Kategorije statusov:**
- 🟢 **RESTOCK** — visok ROI + 0 held → kupi več!
- 🔵 **MAINTAIN** — dober ROI + nekaj held → vzdržuj
- 🟡 **REDUCE** — mejni ROI + preveč held → zmanjšaj
- 🔴 **AVOID** — slab ROI / izguba → ne kupuj

**Top 5 priporočil:**
Vsaka priporočitev vsebuje:
- Kategorija (npr. "avto")
- Status (RESTOCK)
- Projected profit (€)
- ROI (%)
- Hold čas (povprečen)
- Suggested buy price range (npr. 45€-220€)
- Best source (npr. "mobile.de")
- Confidence level (HIGH/MEDIUM/LOW)

**Kje vidiš:**
- Trgovine tab → "Kaj naj kupim naslednje?" widget
- Pregled tab → Daily Briefing (vključuje restock predlog)

**Inventory Gaps:**
Prikazuje profitabilne kategorije z 0 held — priložnosti za širitev.`,
      },
    ],
  },
  {
    id: 'analitika',
    title: 'Analitika & poročila',
    icon: '📊',
    accent: 'text-sky-500',
    articles: [
      {
        id: 'deal-flow',
        title: 'Deal Flow analitika',
        summary: 'ROI, win rate, velocity, pipeline, cash flow.',
        category: 'analitika',
        content: `**Deal Flow** je glavna analitika trgovin v enem pregledu:

**Ključne metrike:**
- **Skupaj prodaj** (npr. 19)
- **ROI** (povprečni, npr. +34.65%)
- **Win rate** (% dobičkonosnih, npr. 94.7%)
- **Avg margin** (povprečni profit per trade, npr. +51.21€)
- **Velocity** (koliko flip-ov/leto, npr. 16.71×)
- **Pipeline** (vrednost held inventory, npr. 1687€)
- **Cash flow** (30d profit, YTD profit)
- **Hold čas** (povprečen, npr. 21.8 dni)

**Top kategorije:**
Prikaz ROI per kategorija:
- elektronika: +377€ (5×, +23.34%)
- avto: +353€ (5×, +60.86%)
- orodje: +109€ (3×, +43.43%)

**Kje vidiš:**
- Analitika tab → "Deal Flow" widget
- Pregled tab → Pinned KPI Row (skrajšana verzija)

**Interpretacija:**
- ROI > 30% = odlično
- Win rate > 90% = zelo dobro
- Velocity > 10×/leto = hitri flip-i
- Hold < 30 dni = učinkovito`,
      },
      {
        id: 'profit-forecast',
        title: 'Profit Forecast',
        summary: 'Napoved dobička do konca meseca.',
        category: 'analitika',
        content: `**Profit Forecast** napove tvoj dobiček do konca meseca:

**Vhodi:**
- Trenutni profit (do danes)
- Število prodaj do danes
- Povprečni dnevni profit
- Število dni do konca meseca

**Izhodi:**
- **Napoved konec meseca** (€)
- **Dnevni potrebnih** (€/dan za dosego cilja)
- **Cilj dosegljiv?** (da/ne)
- **Projiciran presežek** (€ nad ciljem)

**Held inventory potenial:**
- 5 held × projected 20% margin = 333€ potencial

**Kje vidiš:**
- Analitika tab → "Profit Forecast" widget

**Razdelitev dobička:**
- Pie chart: profit per kategorija
- Bar chart: profit po mesecih (zadnjih 6)
- Trend: MoM (month-over-month)

**Performance tagi:**
Prikaz ROI per tag:
- #bolha: +541€ (17×, +25%, 91% win) — TRDEN
- #vinted: +86% ROI (3×, 100% win) — ZVEZDA
- #hitri-flip: +70% ROI (10×, 100% win) — ZVEZDA`,
      },
      {
        id: 'porocila',
        title: 'Tedenski/mesečni/letni povzetek',
        summary: 'Avtomatska poročila za pregled poslovanja.',
        category: 'analitika',
        content: `**3 tipi poročil:**

**1. Tedenski povzetek (v8.41)**
- Avtomatsko vsak ponedeljek ob 09:00 (preko cron-a)
- Vsebuje: profit ta teden, MoM sprememba, top 3 trades, top 3 insights, priporočila za naslednji teden
- Pošlje se na Telegram + Email + Notification Center
- Ročni sprož: Trgovine tab → "Pošlji zdaj"

**2. Mesečni cilj (v8.39)**
- Pregled tab → Goal Tracker
- Realizacija / cilj (npr. 521€/500€ = 104%)
- Milestone-i: četrtina, polovica, tri četrtine, cilj
- Projiciran dobiček do konca meseca
- MoM trend (+15% vs prejšnji mesec)

**3. Letno poročilo (v8.43)**
- Trgovine tab → Letno poročilo
- Letni profit, število prodaj
- **Davek**: 22% poenostavljena stopnja (ZDoh-2)
- **Čist po davku** (profit - davek)
- **Četrtletni pregled** (Q1-Q4 bar chart)
- Najboljši/najslabši mesec
- Top trade leta
- **Prenesi PDF** (davčno poročilo za FURS/accountant)

**Kje vidiš:**
- Trgovine tab → vse 3 poročila
- Pregled tab → Goal Tracker (mesečni cilj)

**Nasvet:**
Prenesi PDF letno poročilo januarja za davčno napoved. Vsebuje vse kar rabi FURS.`,
      },
      {
        id: 'davcno-porocilo',
        title: 'Davčno poročilo PDF',
        summary: 'Letno poročilo za FURS in accountant.',
        category: 'analitika',
        content: `**Davčno poročilo PDF** je letni pregled tvojega poslovanja za davčne namene:

**Vsebina:**
- Letni dobiček (€)
- Število prodaj
- Davek: 22% poenostavljena stopnja (ZDoh-2)
- Čist dobiček po davku
- 20% marža
- Četrtletni pregled (Q1-Q4)
- Najboljši/najslabši mesec
- Win rate, povprečni ROI
- Top trade leta

**Kako dostopaš:**
1. Trgovine tab → "Letno poročilo" widget
2. Izberi leto (currentYear-1 do currentYear+1)
3. Klik "Prenesi PDF" → odpre se v novem zavihku

**Davčna stopnja:**
- **22% poenostavljena stopnja** (ZDoh-2) — za samostojne podjetnike, ki imajo manj kot 60.000€ letnega prometa
- Velja za flipping dejavnost v Sloveniji

**Pomembno:**
- Vsa prodaja naj bo zabeležena v Skladišču (z buyPrice + sellPrice + dates)
- Pred prenoso PDF-ja preveri, da so vsi trade-i pravilno označeni kot "sold"
- Če imaš druge dohodke, se morajo sešteti v letni davčni napovedi

**Disclaimer:**
Aplikacija poskyne informacije za orientacijo. Za uradno davčno napoved se posvetuj z accountant-om ali zaveži preko eDavki.`,
      },
    ],
  },
  {
    id: 'nastavitve',
    title: 'Nastavitve & integracije',
    icon: '⚙️',
    accent: 'text-muted-foreground',
    articles: [
      {
        id: 'ai-provider',
        title: 'AI provider konfiguracija',
        summary: 'Ollama (brezplačno), OpenAI, Anthropic, fallback.',
        category: 'nastavitve',
        content: `**AI provider** je srce aplikacije — brez njega AI analiza ne deluje.

**Možnosti:**

1. **Ollama (BREZPLAČNO, popolnoma lokalno)** ⭐ PRIPOROČENO
   - Namesti Ollama z [ollama.com](https://ollama.com)
   - Prenesi model: \`ollama pull llama3.1\` (ali manjši \`qwen2.5:7b\`)
   - Zaženi: \`ollama serve\` (localhost:11434)
   - Nastavitve → AI → Base URL: \`http://localhost:11434\`
   - Model: \`llama3.1\` ali \`qwen2.5:7b\`
   - API Key: prazno (Ollama ne rabi)

2. **OpenAI** (plačljivo, najboljša kvaliteta)
   - Dobi API ključ z [platform.openai.com](https://platform.openai.com)
   - Nastavitve → AI → Provider: OpenAI
   - API Key: vstavi ključ
   - Model: \`gpt-4o-mini\` (cenejši) ali \`gpt-4o\` (najboljši)

3. **Anthropic Claude** (plačljivo, močan za analizo)
   - API ključ z [console.anthropic.com](https://console.anthropic.com)
   - Provider: Anthropic
   - Model: \`claude-3-5-haiku\` (cenejši) ali \`claude-3-5-sonnet\`

4. **Fallback provider** (avtomatski backup)
   - Če glavni provider odpove (rate limit, downtime)
   - Nastavi drugačen provider kot fallback

**Testiranje:**
Nastavitve → AI → "Test" gumb → preveri povezavo

**Stroški:**
- Ollama: 0€ (lokalno)
- OpenAI gpt-4o-mini: ~0.15€ / 1M vhodnih tokenov, 0.60€ / 1M izhodnih
- Anthropic claude-3-5-haiku: ~0.80€ / 1M vhodnih, 4€ / 1M izhodnih

**Monthly AI calls quota:**
Aplikacija spremlja dnevne AI klice. V Nastavitve → AI vidiš \`aiCallsToday\` in datum reset-a.`,
      },
      {
        id: 'telegram-bot',
        title: 'Telegram bot setup',
        summary: 'Prejemaj alerte preko Telegram bot-a.',
        category: 'nastavitve',
        content: `**Telegram bot** pošilja alerte direktno v tvoj Telegram:

**Setup:**

1. **Ustvari bot**
   - Odpri Telegram → poišči \`@BotFather\`
   - Pošlji \`/newbot\`
   - Izberi ime (npr. "Markec AI Alerts")
   - Izberi username (npr. "markec_ai_alerts_bot")
   - **Kopiraj Bot Token** (npr. "123456:ABC-DEF...")

2. **Pridobi Chat ID**
   - Pošlji sporočilo svojemu novemu bot-u (npr. "test")
   - Odpri: \`https://api.telegram.org/bot<TOKEN>/getUpdates\`
   - Poišči \`"chat":{"id":123456789}\` v JSON odgovoru
   - **Kopiraj Chat ID**

3. **Nastavi v aplikaciji**
   - Nastavitve → Obvestila → Telegram
   - Bot Token: vstavi token
   - Chat ID: vstavi ID
   - Omogoči Telegram
   - Klik "Test" → prejmi testno sporočilo

**Funkcije:**
- Alerti za PRILIKA/SUMNJIVO
- Inline buttons (klik na gumb v Telegram → dejanje)
- Daily briefing (vsak dan ob 8:00)
- Weekly summary (vsak ponedeljek ob 9:00)
- Heartbeat (vsak dan ob izbrani uri — sistem živ)

**Nasvet:**
Za skupinske alerte ustvari Telegram skupino, dodaj bota v skupino, in uporabi skupinski Chat ID (negativen).`,
      },
      {
        id: 'email-push',
        title: 'Email in Web Push obvestila',
        summary: 'Email + browser push + PWA.',
        category: 'nastavitve',
        content: `**3 kanali obvestil:**

**1. Email**
- Nastavitve → Obvestila → Email
- SMTP konfiguracija:
  - Host (npr. smtp.gmail.com)
  - Port (587 za TLS, 465 za SSL)
  - User + Password
  - From / To email
- Test: klik "Pošlji testni email"

**2. Web Push (browser)**
- Nastavitve → Web Push → Generiraj VAPID ključe
- Kopiraj Public Key v manifest.json (če uporabljaš PWA)
- Browser te vpraša za dovoljenje
- Alerti se prikažejo tudi ko aplikacija ni odprta (PWA install)

**3. PWA (Progressive Web App)**
- Chrome/Edge: ikona "Namesti" v naslovni vrstici
- Po namestitvi deluje kot desktop aplikacija
- Podprt offline (ogledi zadnjih podatkov)
- Push obvestila tudi ko aplikacija zaprta

**PWA Shortcuts:**
- Desni klik na ikono → shortcuts za:
  - "Dodaj trade" → ?action=add-trade
  - "Monitorji" → ?view=monitors
  - "Nastavitve" → ?view=settings

**Digest Mode:**
- Nastavitve → Obvestila → Digest
- "Realtime" — vsak alert posebej
- "Digest" — zbrano sporočilo vsakih X ur
- "Quiet hours" — brez obvestil v nočnem času`,
      },
      {
        id: 'webhooks',
        title: 'Webhook endpoints',
        summary: 'Pošilji alerte v zunanje sisteme (Zapier, Make, custom).',
        category: 'nastavitve',
        content: `**Webhooks** omogočajo integracijo z zunanjimi sistemi:

**Uporaba:**
- **Zapier** → poveži z Gmail, Slack, Notion, Google Sheets
- **Make (Integromat)** → avtomatizacija workflow-ov
- **Custom server** → lasten endpoint za custom integracijo

**Setup:**
1. Sistem → Nastavitve → Webhooks → "Dodaj endpoint"
2. Izpolni:
   - **URL** (npr. \`https://hooks.zapier.com/hooks/catch/123/abc\`)
   - **Secret** (opcijsko — za HMAC podpis)
   - **Events** (katere dogodke pošiljati)
3. Shrani

**Event tipi:**
- \`alert.created\` — nov alert (PRILIKA/SUMNJIVO)
- \`listing.found\` — nov oglas najden
- \`listing.price_drop\` — padec cene
- \`trade.sold\` — trade prodan
- \`trade.added\` — nov trade v skladišče
- \`daily_briefing\` — dnevni briefing
- \`heartbeat\` — sistem živ signal

**Test:**
- Klik "Test" → pošlje testni payload
- Prikaz: zadnji HTTP status, število sprožitev, napake

**Payload format:**
\`\`\`json
{
  "event": "alert.created",
  "timestamp": "2026-08-24T12:00:00Z",
  "data": {
    "alertId": "abc123",
    "title": "iPhone 13 128GB - 280€",
    "aiVerdict": "PRILIKA",
    "dealScore": 77,
    "monitorName": "Bolha iPhone 13"
  }
}
\`\`\`

**Secret podpis (HMAC):**
Če si nastavil secret, webhook vključuje \`X-Signature\` header z HMAC-SHA256 podpisom payload-a. Preveri podpis na svojem serverju.`,
      },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    icon: '🔧',
    accent: 'text-amber-500',
    articles: [
      {
        id: 'ai-ne-odgovarja',
        title: 'AI ne odgovarja',
        summary: 'Preveri provider, API ključ, rate limit.',
        category: 'troubleshooting',
        content: `**AI ne odgovarja — diagnostika:**

**1. Preveri provider:**
- Nastavitve → AI → "Test" gumb
- Če faila: preveri Base URL, API Key, Model
- Ollama: zaženi \`ollama serve\` v terminalu
- OpenAI: preveri billing na platform.openai.com

**2. Rate limit:**
- Nastavitve → AI → "AI calls today" števec
- Če je visok, počakaj dan za reset
- OpenAI limit: Tier 1 = 500 RPM, Tier 2 = 5000 RPM

**3. Fallback provider:**
- Nastavitve → AI → "Fallback provider"
- Če glavni faila, fallback prevzame
- Preveri "Test fallback" gumb

**4. AI cache:**
- AI odgovori se cache-irajo 1 uro
- Če testa isti artikel, dobiš cached odgovor
- Reset cache: Nastavitve → AI → "Počisti cache"

**5. Dev log:**
- Sistem → Zdravje → zadnje napake
- Ali preberi \`dev.log\` v projektu

**6. Model ne obstaja:**
- Ollama: \`ollama list\` v terminalu (pokaže nameščene)
- Če modela ni: \`ollama pull llama3.1\`
- OpenAI: preveri model name (gpt-4o-mini, ne gpt4-o-mini)

**7. Network problems:**
- Če si za proxy/firewall, preveri HTTP_PROXY env
- OpenAI API je dostopen z vseh IP-jev
- Anthropic: preveri, da nisi v blokirani regiji`,
      },
      {
        id: 'monitor-ne-najde',
        title: 'Monitor ne najde oglasov',
        summary: 'Preveri URL, scraper, anti-detekcija.',
        category: 'troubleshooting',
        content: `**Monitor ne najde oglasov — diagnostika:**

**1. Preveri URL:**
- Odpri URL v browserju — ali sploh vrne oglase?
- Nekatere strani rabijo JavaScript (Bolha, Vinted)
- Preveri, da je URL iskalni (ne posamezen oglas)

**2. Scraper logika:**
- Bolha: \`src/lib/scraper.ts\` → \`scrapeBolha()\`
- mobile.de: \`src/lib/scraper-foreign.ts\` → \`scrapeMobileDe()\`
- Preveri če je CSS selector zastarel (strani se spreminjajo)

**3. Anti-detekcija:**
- Nastavitve → Anti-detekcija
- Omogoči: Stealth mode, Realistic headers, Request delays
- Proxy list: dodaj rotating proxys (residential najboljši)
- TLS fingerprinting: vklopi

**4. Captcha:**
- Če portal rabi captcha, omogoči captcha solver
- Nastavitve → Anti-detekcija → Captcha solver
- Podprti: Anti-Captcha, CapMonster, 2Captcha
- Potrebuješ API ključ od storitve

**5. Rate limiting:**
- Če pošiljaš preveč requestov, te portal blokira
- Povečaj request delay (1-3s med requesti)
- Zmanjšaj število hkratnih monitorjev

**6. Dev log:**
- Preberi \`dev.log\` — išči "scraper", "failed", "error"
- Sistem → Zdravje → zadnje izvedbe
- Pregled → Recent runs (status FAILED?)

**7. Ročni test:**
\`\`\`bash
curl -X POST http://localhost:3000/api/monitors/<id>/run
\`\`\`
Vrni rezultat — če \`newListings: 0\` ampak \`listingsFound: 0\`, je problem v scraper-ju. Če \`listingsFound > 0\` ampak \`newListings: 0\`, so vsi že v bazi.`,
      },
      {
        id: 'cache-problemi',
        title: 'Cache problemi',
        summary: 'AI cache, analytics cache — kako počistiti.',
        category: 'troubleshooting',
        content: `**Cache sistemi v aplikaciji:**

**1. AI Cache (\`src/lib/ai-cache.ts\`)**
- Cache-ira AI odgovore za 1 uro
- Key: hash(prompt + model)
- Če dobiš vedno isti odgovor → cache problem
- **Reset**: Nastavitve → AI → "Počisti AI cache"

**2. Analytics Cache (\`src/lib/analytics-cache.ts\`)**
- TTL: 120s (2 minuti)
- Cache-ira analitike (deal-flow, decision-accuracy, itd.)
- Če podatki ne osvežijo → počakaj 2 minuti ali:
- **Reset**: API klic \`/api/analytics?refresh=true\`

**3. Browser Cache**
- Next.jsTurbocharger cache-ira staticne assete
- Hard refresh: \`Ctrl+Shift+R\` (ali Cmd+Shift+R)
- Ali: DevTools → Network → "Disable cache"

**4. Service Worker (PWA)**
- Če imaš PWA nameščeno, SW cache-ira vse
- Reset: DevTools → Application → Service Workers → Unregister
- Ali: Nastavitve → PWA → "Počisti cache"

**5. Database cache**
- Prisma cache (če omogočena)
- Reset: \`bun run db:push\` (rebuild schema)

**Diagnostika:**
- Sistem → Zdravje → "Cache status"
- Ali: \`/api/health\` endpoint vrne cache statistiko

**Pogosti simptomi:**
- "AI odgovarja enako za različne artikle" → AI cache
- "Statistike ne osvežijo po novi prodaji" → analytics cache
- "Vidim stare oglase" → browser cache
- "PWA prikazuje stare podatke" → service worker`,
      },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════
// FAQ
// ═══════════════════════════════════════════════════════════════════════

const FAQ = [
  {
    q: 'Ali aplikacija deluje brez interneta?',
    a: 'AI analiza ne (rabi API klic). Toda ogled obstoječih podatkov, dodajanje trade-ov, in analitika delujejo offline.',
  },
  {
    q: 'Koliko stane aplikacija?',
    a: 'Aplikacija je brezplačna in open-source. Strošek je samo AI API (Ollama = 0€, OpenAI ~5€/mesec za povprečno uporabo).',
  },
  {
    q: 'Ali podatki zapustijo moj računalnik?',
    a: 'Ne. Aplikacija je local-first. Edino kar zapusti je AI API klic (če ne uporabljaš Ollama).',
  },
  {
    q: 'Kako pogosto naj teče cron?',
    a: 'Vsakih 30 minut za Bolha/Vinted. Za mobile.de/Avtonet vsakih 1-2 uri (počasneje spreminjanje).',
  },
  {
    q: 'Kaj pomeni "zero-cloud"?',
    a: 'Brez oblak. Vsi podatki, AI cache, baza — vse lokalno. Ni Google, ni AWS, ni Azure.',
  },
  {
    q: 'Ali podpira tudi prodajo na tujih portalih?',
    a: 'Da — mobile.de (Nemčija), Autoscout24 (EU), eBay (svet). Toda primarno je za slovenske portale.',
  },
  {
    q: 'Kako popravim AI če je Decision Accuracy slab?',
    a: 'Preveri AI tab → Decision Accuracy. Če je korelacija negativna, popravi uteži v src/lib/trades/buy-opportunity.ts. Glej tudi Decision Accuracy članek v Pomoč → AI analiza.',
  },
];

// ═══════════════════════════════════════════════════════════════════════
// KOMPONENTA
// ═══════════════════════════════════════════════════════════════════════

export function HelpCenterContent() {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [showFaq, setShowFaq] = useState(false);

  // Filter articles based on search
  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    const results: { category: Category; article: Article }[] = [];
    for (const cat of CATEGORIES) {
      for (const art of cat.articles) {
        if (
          art.title.toLowerCase().includes(q) ||
          art.summary.toLowerCase().includes(q) ||
          art.content.toLowerCase().includes(q)
        ) {
          results.push({ category: cat, article: art });
        }
      }
    }
    return results;
  }, [search]);

  const allArticlesCount = CATEGORIES.reduce((sum, c) => sum + c.articles.length, 0);

  return (
    <div className="space-y-4">
      {/* 🔍 Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Kako ti lahko pomagamo?"
          aria-label="Iskanje po pomoči"
          className="w-full pl-9 pr-3 py-2.5 bg-background border border-border rounded-md text-sm focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
          autoFocus
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
            aria-label="Počisti iskanje"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Search results */}
      {searchResults !== null && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            {searchResults.length > 0
              ? `${searchResults.length} rezultatov za "${search}"`
              : `Ni rezultatov za "${search}"`}
          </div>
          {searchResults.length > 0 && (
            <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
              {searchResults.map(({ category, article }) => (
                <button
                  key={article.id}
                  onClick={() => setSelectedArticle(article)}
                  className="w-full text-left p-3 rounded-md border border-border bg-card/50 hover:bg-card hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs">{category.icon}</span>
                    <span className={cn('text-[10px] uppercase font-bold', category.accent)}>
                      {category.title}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-foreground">{article.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{article.summary}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Default view — categories grid */}
      {searchResults === null && !selectedArticle && !showFaq && (
        <>
          <div className="text-xs text-muted-foreground">
            📚 {allArticlesCount} člankov v {CATEGORIES.length} kategorijah
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className="text-left p-3 rounded-md border border-border bg-card/50 hover:bg-card hover:border-primary/30 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{cat.icon}</span>
                  <span className={cn('text-sm font-bold', cat.accent)}>{cat.title}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{cat.articles.length} člankov</span>
                </div>
                <div className="text-xs text-muted-foreground line-clamp-1">
                  {cat.articles[0].summary}
                </div>
              </button>
            ))}
          </div>

          {/* Quick links */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-border">
            <button
              onClick={() => setShowFaq(true)}
              className="flex items-center gap-2 p-3 rounded-md border border-border bg-card/50 hover:bg-card hover:border-primary/30 transition-colors text-sm"
            >
              <HelpCircle className="w-4 h-4 text-amber-500" />
              <span className="font-medium">FAQ</span>
              <span className="text-[10px] text-muted-foreground ml-auto">{FAQ.length}</span>
            </button>
            <a
              href="https://youtube.com/playlist?list=PL_placeholder"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 p-3 rounded-md border border-border bg-card/50 hover:bg-card hover:border-primary/30 transition-colors text-sm"
              onClick={(e) => e.preventDefault()}
            >
              <Video className="w-4 h-4 text-red-500" />
              <span className="font-medium">Video tutoriji</span>
              <ExternalLink className="w-3 h-3 text-muted-foreground ml-auto" />
            </a>
            <a
              href="mailto:support@markec-ai-firm.local"
              className="flex items-center gap-2 p-3 rounded-md border border-border bg-card/50 hover:bg-card hover:border-primary/30 transition-colors text-sm"
            >
              <Mail className="w-4 h-4 text-sky-500" />
              <span className="font-medium">Kontakt</span>
              <span className="text-[10px] text-muted-foreground ml-auto">24h</span>
            </a>
          </div>
        </>
      )}

      {/* Category view */}
      {selectedCategory && !selectedArticle && (
        <div className="space-y-2">
          <button
            onClick={() => setSelectedCategory(null)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            ← Nazaj na kategorije
          </button>
          {CATEGORIES.filter((c) => c.id === selectedCategory).map((cat) => (
            <div key={cat.id}>
              <div className={cn('flex items-center gap-2 mb-3 pb-2 border-b border-border', cat.accent)}>
                <span className="text-xl">{cat.icon}</span>
                <h3 className="text-base font-bold">{cat.title}</h3>
                <span className="text-[10px] text-muted-foreground ml-auto">{cat.articles.length} člankov</span>
              </div>
              <div className="space-y-1.5">
                {cat.articles.map((art) => (
                  <button
                    key={art.id}
                    onClick={() => setSelectedArticle(art)}
                    className="w-full text-left p-3 rounded-md border border-border bg-card/50 hover:bg-card hover:border-primary/30 transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground flex items-center gap-1.5">
                          <BookOpen className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary" />
                          {art.title}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{art.summary}</div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 mt-0.5" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Article detail view */}
      {selectedArticle && (
        <div className="space-y-3">
          <button
            onClick={() => {
              setSelectedArticle(null);
              if (!search) setSelectedCategory(null);
            }}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            ← Nazaj
          </button>
          <article className="prose prose-sm dark:prose-invert max-w-none">
            <h3 className="text-base font-bold text-primary">{selectedArticle.title}</h3>
            <p className="text-xs text-muted-foreground italic">{selectedArticle.summary}</p>
            <div className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
              {selectedArticle.content}
            </div>
          </article>
        </div>
      )}

      {/* FAQ view */}
      {showFaq && (
        <div className="space-y-2">
          <button
            onClick={() => setShowFaq(false)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            ← Nazaj na kategorije
          </button>
          <div className={cn('flex items-center gap-2 mb-3 pb-2 border-b border-border', 'text-amber-500')}>
            <HelpCircle className="w-5 h-5" />
            <h3 className="text-base font-bold">Pogosta vprašanja</h3>
          </div>
          <div className="space-y-2">
            {FAQ.map((item, i) => (
              <details key={i} className="group border border-border rounded-md bg-card/50 overflow-hidden">
                <summary className="p-3 cursor-pointer text-sm font-medium hover:bg-card/50 flex items-center justify-between gap-2">
                  <span>{item.q}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-open:rotate-90 transition-transform shrink-0" />
                </summary>
                <div className="p-3 pt-0 text-xs text-muted-foreground leading-relaxed border-t border-border/50">
                  {item.a}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
