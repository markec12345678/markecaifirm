
---
Task ID: v4.4
Agent: main
Task: Nadaljevanje razvoja aplikacije Markec AI Firm — Opportunity Monitor (v4.4)

Work Log:
- Branje obstoječega stanja (package.json, prisma schema, page.tsx verzija)
- Namestitev qrcode in @types/qrcode npm paketov (lokalno generiranje QR, zero-cloud)
- Prisma schema: dodana polja Listing.dealScore/dealScoreReason/dealScoreComputedAt in Monitor.tags
- prisma db push + prisma generate (additive, brez migration)
- src/lib/ai.ts: dodane izvožene funkcije scoreDeal, callProviderForRaw, parseJsonLooseExported + DealScoreResult interface + buildDealScorePrompt
- src/app/api/listings/[id]/score/route.ts: POST endpoint za AI Deal Score 0-100
- src/app/api/listings/[id]/qr/route.ts: GET endpoint za PNG QR kodo (qrcode npm, 64-1024px)
- src/app/api/monitors/[id]/route.ts: PUT podpira tags polje
- src/app/api/monitors/route.ts: POST podpira tags polje
- src/app/api/settings/route.ts: nova akcija 'test-fallback-ai' za preverjanje fallback providerja
- src/app/api/listings/route.ts: CSV export vključuje dealScore in dealScoreReason
- src/components/dashboard/listings-view.tsx: Listing interface + dealScore polja + prikaz v vrstici + Deal Score sekcija v detail modalu (progress bar, ponovni izračun) + QR koda sekcija v detail modalu
- src/components/dashboard/monitors-view.tsx: Monitor interface + tags polje + tag input v formi + tag filter chips nad seznamom + tag badge na karticah (klik za filter)
- src/components/dashboard/settings-view.tsx: testingFallbackAi state + testFallbackAi funkcija + Test fallback gumb z rezultatom
- src/app/page.tsx: verzija posodobljena na v4.4.0
- TypeScript check: nobenih novih napak (prejšnje napake ostajajo)
- Testiranje: dev server teče na :3000, /api/monitors vrača tags polje, /api/listings/[id]/qr vrača PNG (128x128), test-fallback-ai pravilno vrne napako ko fallback ni nastavljen
- Git commit: 'feat(v4.4): AI Deal Score 0-100, monitor tags, fallback AI test, listing QR share' (13 files changed, 600 insertions)

Stage Summary:
- 4 nove funkcionalnosti dodane v v4.4
- 2 novi API ruti (score, qr), 1 nova akcija v settings (test-fallback-ai)
- 3 nova polja v Prisma shemi (dealScore, dealScoreReason, dealScoreComputedAt na Listing; tags na Monitor)
- 1 nova npm odvisnost (qrcode + @types/qrcode)
- Skupno število vrstic kode: ~600 novih
- Commit uspešen lokalno; push na GitHub zahteva token (uporabnik mora pushati ročno ali priskrbeti token)
- Verzija aplikacije: v4.4.0

---
Task ID: v4.5
Agent: main
Task: Nadaljevanje razvoja aplikacije Markec AI Firm — Opportunity Monitor (v4.5)

Work Log:
- Prisma schema: dodana polja Listing.targetPrice, targetPriceSetAt, targetPriceAlertSent
- prisma db push + prisma generate (additive)
- src/app/api/listings/[id]/target/route.ts: PATCH endpoint za nastavitev ciljne cene (number | null)
- src/lib/pipeline.ts: dodana v4.5 target price alert logika v runMonitor() —
  po vsakem pregledu preveri listings s targetPrice in currentPrice <= target,
  generira alert (🎯 CILJNA CENA DOSEŽENA) + pošlje Telegram/Discord/Push,
  nastavi targetPriceAlertSent=true (anti-spam). Dodan v alertsSent count.
- src/components/dashboard/listings-view.tsx: Listing interface + targetPrice polja +
  badge v vrstici (🎯 XXX€) + detail modal sekcija z input poljem (Nastavi/Počisti),
  prikaz trenutne/ciljne cene + razlike
- src/app/api/digest/ai-summary/route.ts: POST endpoint — AI generira POVzetek
  zadnjih N ur (6/24/72/168). Vzame top oglase (PRILIKA ali dealScore>=60),
  AI prompt za TOP 3 + trendi + priporočilo. Vrne JSON {summary, topPick, recommendation, listings, stats}.
  Bug fix: Number(undefined) = NaN (ne undefined) — uporabljen Number.isFinite check.
- src/components/dashboard/dashboard-view.tsx: nov 'AI POVzetek' gumb (Sparkles ikona)
  v quick action barju + modal s selectorjem obdobja (6h/24h/3d/7d), stats bar,
  markdown summary, TOP izbor, priporočilo, seznam listingov z deal score badgei
- src/app/api/trades/dashboard/route.ts: GET endpoint — vrača končne podatke za widget
  (totalRealizedProfit, heldCount, soldCount, totalInvested, thisMonthProfit, lastMonthProfit,
  trend, monthlyPnl z cumulative, topCategories z ROI, topTrades z ROI)
- src/components/dashboard/dashboard-view.tsx: nova SkladisceWidget komponenta —
  prikaz na dashboardu za ActivityFeed. 4 stat kartice + mesec trend + mini bar chart
  12 mesecev (z tooltip) + top 3 najbolj dobičkonosne prodaje. Samodejno skrivanje če ni tradeov.
- src/app/page.tsx: verzija posodobljena na v4.5.0
- TypeScript check: nobenih novih napak
- Testiranje:
  - target API: set 400 (above current) → alreadyBelow=true ✓
  - target API: set 200 (below current) → alreadyBelow=false ✓
  - target API: invalid (-50) → error "Ciljna cena mora biti pozitivno število" ✓
  - trades/dashboard: 2 testa tradea (1 sold +65€, 1 held 250€ investicije) ✓
  - ai-summary: deluje, fallback na tekstovno sporočilo ko ni priložnosti ✓
- Git commit: 'feat(v4.5): Target price alerts, AI daily summary, Skladišče dashboard widget'
  (8 files changed, 973 insertions)

Stage Summary:
- 3 nove funkcionalnosti dodane v v4.5
- 3 novi API ruti (target, ai-summary, trades/dashboard)
- 3 nova polja v Prisma shemi (targetPrice, targetPriceSetAt, targetPriceAlertSent)
- Pipeline nadgrajen z target price alert logiko (vključno z vsemi notification kanali)
- ~973 novih vrstic kode
- Verzija aplikacije: v4.5.0

---
Task ID: v4.6
Agent: main
Task: Nadaljevanje razvoja aplikacije Markec AI Firm — Opportunity Monitor (v4.6)

Work Log:
- src/app/api/listings/watchlist/route.ts: GET endpoint — vrača bookmarked + listings
  s targetPrice, z sortiranjem (recent/target/price/score), computed fields
  (distanceToTarget, distancePct, targetHit, lowestEver/highestEver),
  in stats (total, withTarget, bookmarked, targetsHit, totalValue,
  totalPotentialSavings)
- src/components/dashboard/watchlist-view.tsx: nova komponenta WatchlistView —
  4 stat kartice, sort dropdown, thumbnail prikaz, badges, visual target
  progress bar z min/max markers, gumbi za odstrani/počisti, empty state
- src/app/page.tsx: dodan 'watchlist' v View type, NAV array (Eye ikona),
  navMap (5=watchlist, 0=settings), render WatchlistView, help overlay posodobljen,
  verzija v4.6.0
- src/app/api/listings/[id]/negotiate/route.ts: dodana podpora za 'lang' paramter
  (sl/en/de/it/hr), langConfig z navodili za vsak jezik (npr. 'Kleinanzeigen.de'
  za nemščino), validation fallback na 'sl', lang/type vključena v error response
- src/components/dashboard/listings-view.tsx: dodan negotiateLang in negotiateLangLabel
  state, generateMessage() posreduje lang, jezikovni switcher z zastavicami
  (🇸🇮🇬🇧🇩🇪🇮🇹🇭🇷), avtomatska regeneracija ob preklopu jezika,
  prikaz 'Generirano sporočilo (SLO):'
- src/lib/monitor-templates.ts: knjižnica 17 predlog v 7 kategorijah:
  - Elektronika (4): iPhone 13 Pro, MacBook M1, PS5, RTV komponente
  - Avto (3): VW Golf MK6, Audi A3 8L, Toyota Yaris Hybrid
  - Nepremičnine (3): 2-sobno LJ, hiša Bela krajina, garaža LJ
  - Moda (2): Nike Air Max, Levi's 501 (oba Vinted)
  - Orodje (2): Bosch, Makita
  - Sport (2): golf oprema, smuči
  - Drugo (1): kolesa
  Vsaka predloga vsebuje: source, URL, keywords, excludeKeywords, minPrice,
  maxPrice, intervalMinutes, customPrompt (AI navodila), tags
- src/app/api/monitors/from-template/route.ts: POST endpoint za kreiranje monitorja
  iz predloge, preprečitev duplikatov (ime ali URL), podpora za customName in
  override. GET endpoint za seznam predlog s kategorijami.
- src/components/dashboard/monitors-view.tsx: nov 'Predloge' gumb (Sparkles ikona),
  showTemplates state, TemplateModal komponenta z:
  - kategorije tabs (Vse/Elektronika/Avto/...)
  - grid kartic z ikono, imenom, opisom, badges (source, cena, interval, tags)
  - gumb 'Ustvari monitor' z loading state
  - preprečitev duplikatov prikazana kot toast.error
- TypeScript check: nobenih novih napak
- Testiranje:
  - GET /api/monitors/from-template: 17 predlog v 7 kategorijah ✓
  - POST /api/monitors/from-template: uspešno kreiran monitor z vsemi polji ✓
  - POST duplicate: pravilno zavrnjen z existingId ✓
  - POST s customName: deluje ✓
  - GET /api/listings/watchlist: stats pravilni (1 listing, 50€ prihranek,
    14% nad ciljem, targetHit=False) ✓
  - GET /api/listings/watchlist?sort=target: sortiranje deluje ✓
  - POST /api/listings/[id]/negotiate z lang=en: lang pravilno sprejet ✓
  - POST z invalid lang=fr: fallback na 'sl' ✓
  - Negotiate fallback na tekst ko AI ni dostopen ✓
- Git commit: 'feat(v4.6): Watchlist tab, multi-language AI Negotiator, Monitor templates library'
  (8 files changed, 1299 insertions, 30 deletions)

Stage Summary:
- 3 nove funkcionalnosti dodane v v4.6
- 3 novi API ruti (watchlist, from-template POST+GET)
- 1 nova knjižnica (monitor-templates.ts s 17 predlogami)
- 1 nov zavihek v navigaciji (Watchlist)
- ~1299 novih vrstic kode
- 10 zavihkov skupno (prej 9)
- Verzija aplikacije: v4.6.0

---
Task ID: v4.7
Agent: main
Task: Nadaljevanje razvoja aplikacije Markec AI Firm — Opportunity Monitor (v4.7)

Work Log:
- src/app/api/stats/advanced/route.ts: nov GET endpoint z obsežnimi statistikami:
  - keyMetrics (totalRealizedProfit, totalInvestedHeld, avgRoi, totalTrades, soldCount, heldCount, cancelledCount)
  - monthlyPnl (12 mesecev s profit, count, cumulative, invested)
  - conversion (totalListings, bookmarked, contacted, responded, closed, withTarget, targetsHit, tradesFromListings + 4 percentage metrics)
  - aiAccuracy (sampleSize, avgAbsErrorPct, within15Pct, within30Pct, prilikaAccuracyPct + top 5 best/worst predictions)
  - monitorPerformance (success rate, avg duration, total listings/alerts/runs, recent new listings/alerts)
  - sourceBreakdown (listings + monitors per source)
  - topCategories (profit, invested, sold, held, avgRoi, conversionRate)
- src/components/dashboard/statistics-view.tsx: nova StatisticsView komponenta z:
  - 4 key metric karticami
  - P&L AreaChart (profit vs invested vs cumulative) z recharts
  - Conversion funnel z bar visualization + 4 percentage cards
  - AI accuracy sekcija (4 stats + PRILIKA accuracy badge + top 5 best/worst predictions)
  - Source breakdown z bar charts
  - Top categories horizontal bar chart
  - Monitor performance tabela (success rate, avg čas, listings, alerti)
- src/app/page.tsx: dodan 'statistics' v View type, NAV array (PieChart ikona),
  render StatisticsView, verzija v4.7.0
  - v4.7 Mobile: hamburger meni (md:hidden) z drawer-style navigacijo
  - Skrčen terminal naslov na mobilcu (sm:inline za full path)
  - Nav tabs hidden na mobilcu (md:block)
  - Mobile drawer z vsemi zavihki + search button + clock
  - Main content: py-4 md:py-6 za manj padding na mobilcu
- src/components/dashboard/dashboard-view.tsx: flex-wrap na action baru za mobilce
- src/components/dashboard/listings-view.tsx:
  - Modal: mx-4 sm:mx-6 p-4 sm:p-6 za mobilne robove
  - AI evaluation grid: sm:gap-3 za mobilne razmike
  - Target price input: flex-col sm:flex-row za stacking na mobilcu
  - QR section: flex-col sm:flex-row za stacking na mobilcu
- src/app/api/backup/json/route.ts: nov GET in POST endpoint za JSON backup/restore
  - GET: export vseh tabel (settings, monitors, listings, alerts, trades, runLogs,
    heartbeats, priceHistory, digestLogs, pushSubs) kot JSON
  - Sanitizacija: aiApiKey, fallbackApiKey, telegramBotToken, telegramWebhookSecret,
    discordWebhookUrl, slackWebhookUrl, emailSmtpPassword, vapidPrivateKey so
    REDACTANA v exportu
  - POST: upsert (ustvari ali posodobi) vse zapise iz JSON
  - Validacija: _meta.app === 'markec-ai-firm' required
  - Safe fields whitelist za settings (brez sensitive fields)
  - Skip orphans (listings brez monitorjev, alerti brez monitorjev)
- src/components/dashboard/settings-view.tsx: nova JsonBackupControls komponenta
  z 'Izvozi JSON' in 'Uvozi JSON' gumboma, import result prikaz z count per tabela,
  confirmation dialog pred importom. Vstavljena v BackupSection.
- TypeScript check: nobenih novih napak (prejšnje existing napake ostajajo)
- Testiranje:
  - GET /api/stats/advanced: pravilno vrača vse statistike (keyMetrics, conversion,
    aiAccuracy, monitorPerformance, sourceBreakdown, topCategories, monthlyPnl) ✓
  - GET /api/backup/json: pravilno exportira settings, monitors, listings, itd.
    aiApiKey je pravilno REDACTAN kot '***REDACTED***' ✓
  - POST /api/backup/json: uspešen upsert z restored counts ✓
  - Validacija: _meta.app check deluje ✓
  - Skip orphans: listings brez monitorjev so skipped ✓
- Git commit: 'feat(v4.7): Statistics dashboard, mobile responsive, JSON backup/restore'
  (8 files changed, 1536 insertions, 20 deletions)

Stage Summary:
- 3 nove funkcionalnosti dodane v v4.7
- 2 novi API ruti (stats/advanced, backup/json)
- 1 nov zavihek (Statistike, skupno 11)
- 2 novi komponenti (StatisticsView, JsonBackupControls)
- ~1536 novih vrstic kode
- Mobile responsive izboljšave po vsej aplikaciji
- Verzija aplikacije: v4.7.0
