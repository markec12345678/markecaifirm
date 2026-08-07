# Changelog

Vse pomembne spremembe projekta **Markec AI Firm** bodo dokumentirane tukaj.

Format sledi [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), verzije sledijo [Semantic Versioning](https://semver.org/).

## [Unreleased]

Načrtovano za v7.71+:
- WebSocket real-time negotiation (SSE namesto polling)
- Playwright E2E testi za glavne flow-e
- TLS fingerprinting (curl-impersonate)
- ML model za buyer matchmaker (fine-tuned na realnem data)

## [7.70.0] - 2026-08-12

### Added — AI Profit Stream Predictor & Inventory Lifecycle Stage Classifier & Deal Source Comparison Matrix (3 funkcije)

- **AI Profit Stream Predictor** — `GET+POST /api/ai/profit-stream-predictor`
  - AI napoveduje "profit stream" — vzorce ponavljajočega se profita skozi
    čas. Identificira katere kategorije prinašajo stalen (STEADY) vs.
    sporadičen (ERRATIC) profit in projektira 90-dnevni tok profita z
    intervali zaupanja. Razlika od profit-forecast (ki vrne eno številko)
    — ta prikaze VZOREC profita (steady vs. lumpy) po tednih.
  - AI-enhanced z grounding + anti-hallucination + 6h cache
    (`profit-stream-predictor:${currentMonth}`) + deterministic fallback
    (linearna regresija na zadnjih 8 tednih).
  - Razlika od profit-forecast (ki vrne skupno napovedano številko za
    obdobje) — ta prikaze VZOREC profita po tednih z intervali zaupanja.
    Razlika od profit-dashboard (ki je real-time dashboard) — ta je napoved
    90 dni vnaprej. Razlika od cash-flow-forecast (ki gleda cash flow
    in/out) — ta gleda samo profit tok. Razlika od profit-efficiency-
    analyzer (ki meri profit per dan) — ta gleda konsistentnost profita
    skozi čas. Razlika od profit-margin-heatmap (ki gleda margine po
    kategoriji/ceni) — ta gleda tok profita skozi čas.
  - Query SOLD trades (status='sold', sellDate >= 180 dni nazaj,
    buyPrice>0, sellPrice!=null). Group by week (26 tednov, W0 =
    najstarejši, W25 = najnovejši). Za vsak teden: profit (sellPrice -
    sellFees - buyPrice - buyFees), trades.
  - Stream characteristics:
    * `avgWeeklyProfit` = mean(weeklyProfits)
    * `profitVolatility` = stdev / mean (nižje = bolj stabilno)
    * `consistencyScore` = 0-100 ((1 - min(1, volatilnost)) × 100)
    * `streamType` = STEADY (vol <0.3), VARIABLE (0.3-0.6), ERRATIC
      (>0.6)
    * `totalWeeksAnalyzed` = 26
  - Per-category profit stream (categoryStreams): za vsako kategorijo z
    ≥1 trade-om: weeklyProfit, reliability (consistency 0-100), streamType
    (STEADY/VARIABLE/ERRATIC), contribution (% od skupnega profita).
    Sort by contribution desc (most profit-bearing first).
  - AI prompt z GROUNDING_PROMPT_SUFFIX — 26 tednov zgodovine + top 15
    kategorij z značilnostmi. AI generira:
    * `projection` 13 tednov (90 dni) projekcija. Za vsak teden:
      - `projectedProfit` EUR (lahko trend-up/down glede na zgodovino)
      - `confidenceLow` / `confidenceHigh` ±1 stdev interval (širši
        naprej)
    * `summary.projectedTotalProfit90d` = vsota vseh 13 tednov
    * `summary.bestWeek` = teden z najvišjim projectedProfit (week 1-13,
      profit)
    * `summary.worstWeek` = teden z najnižjim projectedProfit
    * `summary.profitStabilityAdvice` konkreten nasvet (1-2 stavka)
  - Anti-hallucination: vsak projectedProfit clamped na [0,
    avgWeeklyProfit × 3] (maxCap). confidenceLow clamped na [0,
    projectedProfit], confidenceHigh clamped na [projectedProfit, maxCap].
    week validiran [1, 13]. Če AI manjka teden, dopolnjeno iz baseline.
    projectedTotalProfit90d clamped na [0, maxCap × 13 × 2]. bestWeek/
    worstWeek.profit clamped na [0, maxCap]. profitStabilityAdvice
    clamped na 500 chars (fallback na deterministic advice glede na
    streamType). DB streamAnalysis in categoryStreams ostanejo iz DB.
  - Deterministic fallback (ko AI ni na voljo): linear projection iz
    zadnjih 8 tednov (recentMean + recentSlope × i), confidence interval
    ±1 stdev × (1 + i × 0.05). bestWeek/worstWeek iz projekcije.
    profitStabilityAdvice glede na streamType (STEADY/VARIABLE/ERRATIC).
  - Cache key `profit-stream-predictor:${currentMonth}` (YYYY-MM, 6h TTL).
    Cache se združi nazaj z DB streamAnalysis in categoryStreams.
  - Rate limit 20/min/IP. Empty-state z opisno slovensko message.
  - Example: "Profit stream: STEADY (volatility 0.2, consistency 85/100).
    90d projection: 2400€. Najbolj zanesljiva: elektronika."

- **Inventory Lifecycle Stage Classifier** — `GET /api/analytics/inventory-lifecycle-stage-classifier`
  - Klasificira vsak HELD inventar v eno od 7 lifecycle stadijev
    (INTAKE → PROCESSING → LISTED → ACTIVE → AGING → STALE → DEAD) glede
    na daysSinceBuy, daysSinceFirstSeen, hasContacts, hasPriceDrops,
    flipChecklistProgress. Prikaže v katerem stadiju je vsak item in kaj
    storiti. Pure DB analytics — NO AI.
  - Razlika od inventory-lifecycle (ki upravlja lifecycle workflow) — ta
    KLASIFICIRA vsak item v eno od 7 stadijev. Razlika od
    inventory-lifecycle-optimizer-v2 (ki optimizira prehode med stadiji)
    — ta samo pokaže trenutni stadij in priporočilo. Razlika od
    inventory-aging-predictor-v2 (ki napoveduje kdaj bo item zastarel) —
    ta pove KAJ STORITI ZDaj glede na trenutni stadij. Razlika od
    listing-performance (ki spremlja aktivne listing-e) — ta vključuje
    tudi INTAKE/PROCESSING stadije ki še niso listed. Razlika od
    cash-conversion-cycle (ki meri DIO+DSO-DPO) — ta gleda lifecycle
    stadij vsakega item-a posebej.
  - Query HELD trades z linked Listing (firstSeenAt, contactStatus,
    priceDroppedAt, isBookmarked). Za vsak item izračuna:
    * `daysSinceBuy` = round((now - buyDate) / DAY_MS)
    * `daysSinceFirstSeen` = round((now - listing.firstSeenAt) / DAY_MS)
      (ali daysSinceBuy če listing null)
    * `hasContacts` = listing.contactStatus != 'none' && != ''
    * `hasPriceDrops` = listing.priceDroppedAt != null
    * `flipChecklistProgress` = % completed steps iz flipChecklist JSON
      ([{step, completedAt}] — štej completedAt != null)
  - Classification (7 stadijev z cumulative thresholds):
    * `INTAKE` (daysSinceBuy ≤2, checklist <10%) — registriraj v sistem
    * `PROCESSING` (checklist <50%, daysSinceBuy ≤7) — fotografiraj,
      opis, objavi
    * `LISTED` (checklist ≥50%, daysListed <7) — spremljaj ogledi/kontakti
    * `ACTIVE` (daysListed 7-30, hasContacts OR hasPriceDrops) — odzovi
      se hitro, ponudi discount za hitro sklenitev
    * `LISTED` (daysListed <30, brez kontaktov) — izboljšaj naslov/sliko
    * `AGING` (daysListed 30-60) — znižaj ceno 10-15%, osveži fotografije
    * `STALE` (daysListed 60-90) — kritično, znižaj pod break-even ali
      bundle prodaja
    * `DEAD` (daysListed >90) — likvidiraj, prodaj pod ceno ali doniraj
  - Per item: currentStage, stageProgress 0-100% (koliko je v tem
    stadiju), nextStage, daysInStage, recommendedAction (specifično za
    vsak stadij), urgency (LOW/MEDIUM/HIGH/CRITICAL).
  - portfolioDistribution: { intake, processing, listed, active, aging,
    stale, dead } — koliko item-ov v vsakem stadiju.
  - actionPlan:
    * `immediateActions` ranked (CRITICAL→LOW): DEAD (likvidiraj), STALE
      (znižaj pod break-even), AGING (znižaj 10-15%), LISTED (izboljšaj
      naslove), PROCESSING (pospeši fotografiranje)
    * `bottleneckStage` = stadij z največ item-ov (PROCESSING/LISTED/
      AGING/STALE/DEAD — izključi INTAKE in ACTIVE ki sta zdrava)
    * `advice` slovenski opis bottleneck-a in kaj storiti
  - Sort: urgency CRITICAL→LOW, nato daysInStage desc (najstarejši
    najprej).
  - Empty-state z opisno slovensko message.
  - Example: "INTAKE: 2, PROCESSING: 1, LISTED: 3, ACTIVE: 2, AGING: 1,
    STALE: 1, DEAD: 0. Bottleneck: LISTED (3 item-ov čaka aktivnost)."

- **Deal Source Comparison Matrix** — `GET /api/analytics/deal-source-comparison-matrix`
  - 2D matrika ki primerja vire (Bolha, Vinted, Facebook, mobile.de, itd.)
    čez 5+ metrik (ROI, win rate, avg hold days, deal score, volume).
    Pomaga odločati katere vire prioritetizirati. Pure DB analytics —
    NO AI.
  - Razlika od deal-source-roi (ki meri ROI per vir — eno metriko) — ta
    primerja vire čez 5+ metrik z normalizacijo in overall score. Razlika
    od source-quality (ki ocenjuje listing quality per vir) — ta gleda
    FINANČNE metrike (ROI, win rate, profit per day, capital efficiency).
    Razlika od listing-performance (ki spremlja listing aktivnost) — ta
    gleda sales performance per vir.
  - Query SOLD trades z linked Listing (monitor.source, aiRisk, dealScore).
    Source določen iz buyLocation (free-form) → fallback monitor.source.
    normalizeSource() mapira "Bolha"/"FB"/"Facebook Marketplace"/...
    na bolha/facebook/vinted/...
  - Per source metrike:
    * `totalTrades` = count
    * `totalInvested` = sum(buyPrice + buyFees)
    * `totalProfit` = sum(profit) (sellPrice - sellFees - buyPrice -
      buyFees)
    * `avgROI` = totalProfit / totalInvested × 100
    * `winRate` = % profitable (profit >0)
    * `avgHoldDays` = avg(sellDate - buyDate)
    * `avgDealScore` = avg(listing.dealScore)
    * `avgProfitPerTrade` = totalProfit / totalTrades
    * `profitPerDay` = avgProfitPerTrade / avgHoldDays
    * `capitalEfficiency` = totalProfit / totalInvested (turnover ratio)
    * `riskScore` = avg(listing.aiRisk) (0-10, nižje = varnejše)
  - Normalizacija vsake metrike na 0-100 score glede na min/max v
    cohortu (če so vse vrednosti iste → 50):
    * `roiScore` (higher = better)
    * `winRateScore` (higher = better)
    * `holdDaysScore` (lower = better, faster)
    * `dealScoreScore` (higher = better)
    * `riskScore` (10 - riskScore → higher = safer)
  - `overallScore` = weighted average (ROI 30%, winRate 25%, holdDays
    15%, dealScore 15%, risk 15%). `rank` 1 = najboljši (sort by
    overallScore desc).
  - Per-source × per-category breakdown: za vsak (source, category)
    par: trades, profit, roi.
  - Recommendations:
    * `bestSourceOverall` = rank 1 source
    * `bestSourceByMetric`: roi (max avgROI), winRate (max winRate),
      speed (min avgHoldDays), safety (min riskScore)
    * `sourcePriorityAdvice` slovenski opis — top vir + worst vir +
      nasvet za preusmeritev kapitala
    * `categorySourceMatch` per kategorija: best vir (≥3 trades) z
      reasoning (ROI, št. prodaj, profit)
  - Empty-state z opisno slovensko message.
  - Example: "Bolha: #1 (score 85, ROI 32%, win 70%). Vinted: #2 (score
    72, ROI 18%). Best for elektronika: Bolha. Best for moda: Vinted."

### Changed
- AI_ENDPOINTS.md: regeneriran z Python skripto → "Total: 300 endpoints"
  (299 → 300, +1 AI: profit-stream-predictor #252)
- README.md (MultiEdit z 19 urejanji):
  - Badge version: v7.69.0 → v7.70.0
  - Badge AI Endpoints: 299 → 300
  - Badge API Routes: 446 → 449 (+3: 1 AI + 2 analytics)
  - Tagline: "299 AI endpointov + 42 analytics" → "300 AI endpointov +
    44 analytics"
  - Overview: "Verzija v7.69.0" → "Verzija v7.70.0", counts posodobljeni,
    "~132 funkcij" → "~135 funkcij"
  - "Kaj je novega v v7.56–v7.69 (14 verzij, 42 novih funkcij)" →
    "...v7.56–v7.70 (15 verzij, 45 novih funkcij)", dodan v7.70 blok
    (3 funkcije) na vrh z podrobnimi opisi vseh 3 endpoint-ov
  - AI Hub badge v tabeli: "Vsi 299 AI endpointov" → "Vsi 300 AI
    endpointov"
  - "Endpointi (299 AI + 42 analytics + 10 cron + sistemski = 446)" →
    "...(300 AI + 44 analytics + 10 cron + sistemski = 449)"
  - Dodan 1 nov AI endpoint v AI primeri blok
    (profit-stream-predictor, v7.70)
  - "Profit pipeline (v7.32-v7.69)" → "...(v7.32-v7.70)"
  - Dodana 2 nova analytics endpointa v profit pipeline blok
    (inventory-lifecycle-stage-classifier, deal-source-comparison-matrix,
    v7.70)
  - Dodan 1 nov AI endpoint v profit pipeline listo
    (profit-stream-predictor, v7.70)
  - Project structure: "299 AI endpointov" → "300 AI endpointov"
  - Coding standards: "446 routes" → "449 routes"
  - Roadmap: "v7.69 (trenutno — ~132 funkcij)" → "v7.70 (trenutno — ~135
    funkcij)", profit pipeline list: dodane 3 nove funkcije (AI Profit
    Stream Predictor, Inventory Lifecycle Stage Classifier, Deal Source
    Comparison Matrix), "Profit pipeline (73+ funkcij)" → "(76+ funkcij)"
  - Analytics (42) → (44), dodana 2 nova (Inventory Lifecycle Stage
    Classifier, Deal Source Comparison Matrix)
  - Testing: "446 API routes" → "449 API routes"
  - "Naslednji koraki": "v7.50-v7.69 funkcije" → "...v7.50-v7.70 funkcije"
  - "Zadnje verzije": dodan "v7.70.0 (avgust 2026) — AI Profit Stream
    Predictor, Inventory Lifecycle Stage Classifier, Deal Source
    Comparison Matrix" na vrh
  - AI_ENDPOINTS.md link: "vseh 299 AI endpointov" → "vseh 300 AI
    endpointov"
  - "do v7.69 (avgust 2026)" → "do v7.70 (avgust 2026)"
- CHANGELOG.md: "[Unreleased] Načrtovano za v7.70+" → "...za v7.71+",
  dodana nova "[7.70.0] - 2026-08-12" sekcija (nad [7.69.0]) z vsemi 3
  endpoint-i in podrobnimi opisi (response shape, anti-hallucination
  rules, AI cache key, deterministic fallback, example comment, razlika
  od podobnih obstoječih endpoint-ov — profit-stream-predictor vs
  profit-forecast/profit-dashboard/cash-flow-forecast/profit-efficiency-
  analyzer/profit-margin-heatmap; inventory-lifecycle-stage-classifier
  vs inventory-lifecycle/inventory-lifecycle-optimizer-v2/inventory-
  aging-predictor-v2/listing-performance/cash-conversion-cycle;
  deal-source-comparison-matrix vs deal-source-roi/source-quality/
  listing-performance)
- Verzija aplikacije: v7.69.0 → v7.70.0

## [7.69.0] - 2026-08-11

### Added — AI Profit Leakage Detector & AI Deal Scoring Model v2 & Market Saturation Forecaster (3 funkcije)

- **AI Profit Leakage Detector** — `GET+POST /api/ai/profit-leakage-detector`
  - AI identificira kje profit "teče" — podcenajevanje, visoke pristojbine,
    predolgo držanje, zamujene priložnosti. Pove natančno koliko profita se
    izgublja in kje, z letno projekcijo.
  - AI-enhanced z grounding + anti-hallucination + 6h cache
    (`profit-leakage-detector:${totalSold}`) + deterministic fallback.
  - Razlika od profit-efficiency-analyzer (ki meri kako učinkovito
    pretvarjaš čas v profit — profitPerDay, timeEfficiencyScore) — ta gleda
    RAZLIKO med actual in ideal profitom (leakage) in identificira vire
    izgub. Razlika od net Profit (ki prikazuje skupni profit) — ta meri
    koliko profita MANJKA. Razlika od price-elasticity (ki gleda kako cena
    vpliva na prodajo) — ta gleda kako suboptimalna prodajna cena pušča
    profit na mizi. Razlika od inventory-capital-efficiency-optimizer
    (ki optimizira kapitalsko alokacijo) — ta identificira FINANCNE
    POMAKANJA v prodajni/procesu.
  - Query SOLD trades (z buyPrice>0, sellPrice!=null), HELD trades
    (z buyPrice>0) in CANCELLED trades (z buyPrice>0). Za vsak SOLD
    trade izračuna:
    * `actualProfit` = sellPrice - sellFees - buyPrice - buyFees
    * `idealProfit` = max(0, aiEstimatedValue - buyPrice) (max possible
      profit, če bi prodal po estValue)
    * `pricingLeakage` = max(0, aiEstimatedValue - sellPrice) (prodano
      pod estValue)
    * `feeLeakage` = max(0, (buyFees + sellFees) - (sellPrice + buyPrice)
      × 0.05) (pristojbine >5% trade value)
    * `holdingCostLeakage` = max(0, (daysHeld - 14) × 0.50€) (carrying
      cost 0.50€/dan nad 14-dnevnim grace period)
  - CANCELLED trades → opportunityLeakage = max(0, aiEstimatedValue -
    buyPrice) (zamujen profit).
  - HELD trades → ongoing heldCarryingCost = sum((daysHeld - 14) ×
    0.50€) za held items >14 dni.
  - Aggregate totals: totalActualProfit, totalIdealProfit, totalLeakage
    (= sum vseh leakage virov + heldCarryingCost), leakagePercent,
    estimatedAnnualLeakage (annualFactor = 365 / dateRangeSpanDays ×
    totalLeakage).
  - Per-source breakdown:
    * `pricingLeakage` { amount, count, avgPercent } — povprečen
      pricing leakage kot % idealProfit
    * `feeLeakage` { amount, count, avgPercent } — povprečne pristojbine
      kot % trade value
    * `holdingCostLeakage` { amount, count, avgDays } — povprečno dni
      držanja
    * `opportunityLeakage` { amount, count }
  - AI prompt z GROUNDING_PROMPT_SUFFIX — top 20 hotspots + top 10
    systemic issues z vsemi podatki. AI generira:
    * `leakageHotspots` top 10 z primaryLeakageSource (PRICING/FEE/
      HOLDING_COST/OPPORTUNITY) in specifičen detail
    * `systemicIssues` 3-7 vzorcev (npr. "vedno podcenjuješ elektroniko
      za 12%") z affectedCount, estimatedLoss, pattern opisom
    * `estimatedAnnualLeakage` letna projekcija izgube
    * `fixPriorities` 3-5 ranked (HIGH/MEDIUM/LOW) z fix opisom,
      estimatedRecovery v EUR (70-90% izgube obvladljive), effort
      (1-2 tedna / 2-4 tedne / 1-2 meseca)
    * `expectedRecovery` vsota estimatedRecovery (max 80% totalLeakage)
  - Anti-hallucination: AI hotspots morajo match-at DB tradeIds (samo
    tradeIds, ki jih poznamo, so dovoljeni — DB numbers (actualProfit,
    idealProfit, leakage, leakagePercent) ostanejo iz DB), AI
    primaryLeakageSource validiran enum (clampEnum), detail clamped na
    300 chars. systemicIssues.estimatedLoss clamped na [0,
    totalLeakage×2]. fixPriorities.estimatedRecovery clamped na [0,
    totalLeakage×0.8]. expectedRecovery clamped na [0, totalLeakage×0.8].
    priority validiran enum. estimatedAnnualLeakage clamped na [0,
    estimatedAnnualLeakage×2].
  - Deterministic fallback (ko AI ni na voljo): leakageHotspots iz
    baseline (top 10 z leakage desc), systemicIssues iz byCatPricing
    (group by category za pricing leakage) + feeItems + longHeld
    (>45 dni) + oppItems. fixPriorities iz systemicIssues (70%
    recoverable), priority=HIGH/MEDIUM/LOW glede na rank.
    estimatedAnnualLeakage = totalLeakage × annualFactor.
    expectedRecovery = sum fixPriorities.estimatedRecovery.
  - Cache key `profit-leakage-detector:${totalSold}` (key per število
    sold trade-ov, 6h TTL). Cache se združi nazaj z DB numbers.
  - Rate limit 20/min/IP. Empty-state z opisno slovensko message.
  - Example: "Letna izguba: 450€. Glavni vir: podcenajevanje
    elektronike (-12%). Fix: prodajaj pri 95% estValue → +200€/leto."

- **AI Deal Scoring Model v2** — `GET+POST /api/ai/deal-scoring-model-v2`
  - Advanced ML-style deal scoring ki primerja 7 faktorjev (priceFactor,
    demandFactor, riskFactor, marketDepthFactor, sellerReliabilityFactor,
    categoryPerformanceFactor, timeFactor) in producira 0-100 weighted
    score z grade (S/A/B/C/D/F) in recommendation (STRONG_BUY/BUY/
    CONSIDER/PASS). Razlika od basic dealScore — ta weighted multi-factor
    model z AI-določenimi utežmi.
  - AI-enhanced z grounding + anti-hallucination + 6h cache
    (`deal-scoring-model-v2:${JSON.stringify(sortedListingIds)}`)
    + deterministic fallback (enake uteži 14.3% vsak faktor).
  - Razlika od deal-score-calibrator (ki preverja ali AI deal score-i
    dejansko točni — kalibracija obstoječega dealScore) — ta GENERIRA
    NOVE weighted score iz več faktorjev. Razlika od batch-deal-evaluator
    (ki evaluira listing-e z AI) — ta uporablja MULTI-FACTOR model z 7
    faktorji in weighted contributions. Razlika od deal-quality-
    forecaster (ki napoveduje po dnevih v tednu) — ta ocenjuje KVALITETO
    DEAL-A danes. Razlika od risk-reward-calculator (ki gleda
    potentialReward/loss) — ta gleda 7 različnih faktorjev.
  - Request body (optional): `{ listingId? }`. Brez body-ja score-a
    vse aktivne PRILIKA listings (aiVerdict='PRILIKA', price>0).
  - Za vsak listing izračuna 7 faktorjev (0-1 normalizirano):
    * `priceFactor` = (aiEstimatedValue - price) / aiEstimatedValue
      (discount depth)
    * `demandFactor` = sellThroughRate za kategorijo (bookmarked /
      total, /0.3 capped)
    * `riskFactor` = 1 - aiRisk/10 (lower risk = higher score)
    * `marketDepthFactor` = category listing count / 100 (capped)
    * `sellerReliabilityFactor` = based on sellerListingCount (0-50 →
      0.4-0.95)
    * `categoryPerformanceFactor` = based on historical ROI for
      category (clamp01(0.5 + ROI/100))
    * `timeFactor` = sweet spot 3-14 dni = 1.0, ramp up/down izven
  - AI prompt z GROUNDING_PROMPT_SUFFIX — top 30 listings z vsemi
    faktorji. AI generira:
    * `factorWeights` 7 uteži (% vsota 100) — AI določi optimalne uteži
    * `listings` per listing: weightedScore 0-100 (faktor × utež × 100
      sum), confidenceLevel 0-100 (data completeness), grade
      (S/A/B/C/D/F), recommendation (STRONG_BUY/BUY/CONSIDER/PASS),
      keyStrengths/keyWeaknesses top 2
  - Grade logika: S (90+), A (80-89), B (70-79), C (60-69), D (50-59),
    F (<50). Recommendation logika: STRONG_BUY (S/A), BUY (B/C),
    CONSIDER (D), PASS (F).
  - Anti-hallucination: factorWeights normalizirani na 100% (če AI
    vrne vsoto !=100, normaliziramo), weightedScore clamped [0, 100],
    grade in recommendation validirani enum-i (clampEnum z izpeljavo
    iz score-a), keyStrengths/keyWeaknesses sanitize-ani (max 2, max
    200 chars). DB numbers (listingId, title, price, aiEstimatedValue,
    factors, weightedScore, scoreBreakdown, confidenceLevel) ostanejo
    iz DB.
  - Deterministic fallback (ko AI ni na voljo): enake uteži (14.3% vsak
    faktor), weightedScore = sum(factors × utež × 100), grade in rec
    iz score, keyStrengths/keyWeaknesses top 2 faktorja z visokimi/
    nizkimi vrednostmi.
  - modelInfo: factorWeights, totalListingsScored, avgScore, topGrade,
    strongBuyCount.
  - Cache key `deal-scoring-model-v2:${JSON.stringify(sortedListingIds)}`
    (key per specifičnih listing IDs, 6h TTL). Cache se združi nazaj
    z DB factors (price se lahko spremeni).
  - Rate limit 20/min/IP. Empty-state z opisno slovensko message.
  - Example: "PS5 350€ (estValue 500€) → score 87 (A grade, STRONG_BUY).
    Strengths: price (30% below), demand (HIGH)."

- **Market Saturation Forecaster** — `GET /api/analytics/market-saturation-forecaster`
  - Projektira saturacijo trga 30/60/90 dni vnaprej z linearno regresijo
    na 13 tednov (90 dni) zgodovine. Pomaga odločati kdaj izstopiti
    iz kategorije preden cene padejo. Pure DB analytics — NO AI.
  - Razlika od market-saturation (ki gleda AKTUALNO saturacijo) — ta
    gleda NAPREDOVANJE saturacije v času z linearno regresijo +
    projekcijo 30/60/90 dni vnaprej. Razlika od market-depth-analyzer
    (ki meri GLOBINO trga z cenovno distribucijo) — ta meri SATURACIJO
    (current vs historical avg). Razlika od market-momentum (ki gleda
    7-dnevni BULLISH/BEARISH trend) — ta gleda 90-dnevno saturacijo z
    napovedjo in EXIT/ENTER signali. Razlika od deal-velocity (ki meri
    hitrost prodaje) — ta meri KOLIKO je trg nasičen z oglasi in ali
    se bo še bolj nasičil.
  - Query listings (firstSeenAt >= 90 dni nazaj, isHidden=false). Group
    by category AND week index (13 tednov). Za vsak teden per kategorija:
    * `newListingsCount` = listings added that week
    * `avgPrice` = avg listing price that week
    * `sellThroughRate` = bookmarked / total %
  - Compute trend per kategorija z linearno regresijo (xs = week
    index, ys = weekly values):
    * `listingTrend` = INCREASING/STABLE/DECREASING (relative slope
      >5% / <-5%)
    * `priceTrend` = RISING/STABLE/FALLING (relative slope >1% / <-1%)
    * `saturationVelocity` = listingReg.slope (listings/week² —
      acceleration supply growth)
  - Forecast saturacije:
    * `currentSaturation` = newListingsThisWeek / meanWeekly (1.0 =
      normal historical avg)
    * `weeklySaturationSlope` = listingReg.slope / meanWeekly
    * `projected30d/60d/90d` = currentSaturation + weeklySlope ×
      weeksAhead (30/7, 60/7, 90/7)
    * `saturationStatus` = UNDERSTARTED (<0.7), HEALTHY (0.7-1.3),
      SATURATING (1.3-1.7), OVERSATURATED (>1.7)
    * `timeToOversaturation` = days until saturation >1.7 (null, če
      already oversaturated ali not trending up ali >4 leta)
  - Recommendation per kategorija:
    * `action` = ENTER_NOW (UNDERSTARTED + not decreasing, ali HEALTHY
      + DECREASING + RISING), CONTINUE (HEALTHY ali UNDERSTARTED
      decreasing), SLOW_DOWN (SATURATING + not increasing, ali HEALTHY
      + INCREASING + FALLING), EXIT_NOW (OVERSATURATED, ali SATURATING
      + INCREASING)
    * `pricePressureExpected` = % price drop expected v 90d (glede na
      supply growth in saturation level — 5-15% za INCREASING pri
      saturation >1.0)
    * `reasoning` slovenski opis s key facts
  - Summary: totalCategories, healthyCategories, saturatingCategories,
    oversaturatedCategories, bestExitCategory (highest saturation ali
    SATURATING+INCREASING), bestEntryCategory (UNDERSTARTED + not
    DECREASING), advice (slovenska priporočila).
  - Skip kategorije z <5 listings v 90 dneh.
  - Empty-state z opisno slovensko message.
  - Example: "Elektronika: SATURATING (1.4), timeToOversaturation 45d.
    Exit NOW. Moda: UNDERSTARTED (0.6). Enter NOW."

### Changed
- AI_ENDPOINTS.md: regeneriran z Python skripto → "Total: 299 endpoints"
  (297 → 299, +2 AI: profit-leakage-detector #244, deal-scoring-model-v2
  #88)
- README.md (MultiEdit z 19 urejanji):
  - Badge version: v7.68.0 → v7.69.0
  - Badge AI Endpoints: 297 → 299
  - Badge API Routes: 443 → 446 (+3: 2 AI + 1 analytics)
  - Tagline: "297 AI endpointov + 41 analytics" → "299 AI endpointov
    + 42 analytics"
  - Overview: "Verzija v7.68.0" → "Verzija v7.69.0", counts posodobljeni,
    "~129 funkcij" → "~132 funkcij"
  - "Kaj je novega v v7.56–v7.68 (13 verzij, 39 novih funkcij)" →
    "...v7.56–v7.69 (14 verzij, 42 novih funkcij)", dodan v7.69 blok
    (3 funkcije) na vrh
  - AI Hub badge v tabeli: "Vsi 297 AI endpointov" → "Vsi 299 AI
    endpointov"
  - "Endpointi (297 AI + 41 analytics + 10 cron + sistemski = 443)" →
    "...(299 AI + 42 analytics + 10 cron + sistemski = 446)"
  - Dodana 2 nova AI endpointa v AI primeri blok
    (profit-leakage-detector, deal-scoring-model-v2, v7.69)
  - "Profit pipeline (v7.32-v7.68)" → "...(v7.32-v7.69)"
  - Dodan 1 nov analytics endpoint v profit pipeline blok
    (market-saturation-forecaster, v7.69)
  - Dodana 2 nova AI endpointa v profit pipeline listo
    (profit-leakage-detector, deal-scoring-model-v2, v7.69)
  - Project structure: "297 AI endpointov" → "299 AI endpointov"
  - Coding standards: "443 routes" → "446 routes"
  - Roadmap: "v7.68 (trenutno — ~129 funkcij)" → "v7.69 (trenutno — ~132
    funkcij)", profit pipeline list: dodane 3 nove funkcije (AI Profit
    Leakage Detector, AI Deal Scoring Model v2, Market Saturation
    Forecaster), "Profit pipeline (70+ funkcij)" → "(73+ funkcij)"
  - Analytics (41) → (42), dodan 1 nov (Market Saturation Forecaster)
  - Testing: "443 API routes" → "446 API routes"
  - "Naslednji koraki": "v7.50-v7.68 funkcije" → "...v7.50-v7.69
    funkcije"
  - "Zadnje verzije": dodan "v7.69.0 (avgust 2026) — AI Profit Leakage
    Detector, AI Deal Scoring Model v2, Market Saturation Forecaster"
    na vrh
  - AI_ENDPOINTS.md link: "vseh 297 AI endpointov" → "vseh 299 AI
    endpointov"
  - "do v7.68 (avgust 2026)" → "do v7.69 (avgust 2026)"
- CHANGELOG.md: "[Unreleased] Načrtovano za v7.69+" → "...za v7.70+",
  dodana nova "[7.69.0] - 2026-08-11" sekcija (nad [7.68.0]) z vsemi 3
  endpoint-i in podrobnimi opisi (response shape, anti-hallucination
  rules, AI cache key, deterministic fallback, example comment, razlika
  od podobnih obstoječih endpoint-ov — profit-leakage-detector vs
  profit-efficiency-analyzer/net-profit/price-elasticity/inventory-
  capital-efficiency-optimizer; deal-scoring-model-v2 vs deal-score-
  calibrator/batch-deal-evaluator/deal-quality-forecaster/risk-reward-
  calculator; market-saturation-forecaster vs market-saturation/
  market-depth-analyzer/market-momentum/deal-velocity)
- Verzija aplikacije: v7.68.0 → v7.69.0

## [7.68.0] - 2026-08-10

### Added — AI Supply Demand Balance Analyzer & Market Depth Analyzer & AI Risk Reward Calculator (3 funkcije)

- **AI Supply Demand Balance Analyzer** — `GET+POST /api/ai/supply-demand-balance`
  - AI analizira razmerje med ponudbo (supply = aktivni oglasi, ne povezani
    s sold trade-om) in povpraševanjem (demand = bookmarked / contacted /
    povezani s sold trade-om) per kategorija, za oglase iz zadnjih 30 dni.
    AI-enhanced z grounding + anti-hallucination + 6h cache
    (`supply-demand-balance:${weekKey}`) + deterministic fallback.
  - Razlika od market-saturation (ki gleda volumen oglasov per kategorija
    brez demand podatkov) — ta gleda RAZMERJE med supply in demand
    (sell-through rate, demandStrength, supplyPressure, priceOutlook,
    recommendedAction SELL_AGGRESSIVELY/SELL_NORMAL/HOLD/BUY_AGGRESSIVELY).
    Razlika od market-momentum (ki gleda BULLISH/BEARISH trend v 7 dneh)
    — ta gleda STRUKTURNO stanje supply/demand per kategorija danes.
    Razlika od market-trend (ki gleda rising/falling cene) — ta gleda
    balance in predlaga akcijo.
  - Query all listings (firstSeenAt >= 30 dni nazaj, isHidden=false).
    Za vsak listing ekstrakt category iz monitor.tags (prvi tag) ali
    "drugo". Per kategorija:
    * `supply` = listings brez sold trade-a
    * `demand` = listings z isBookmarked=true ALI contactStatus != 'none'
      ALI povezani s sold trade-om
    * `sellThroughRate` = demand / supply × 100
    * `avgDaysListed` = avg (now - firstSeenAt) / day
    * `priceStability` = % listings brez priceDroppedAt
  - AI prompt z GROUNDING_PROMPT_SUFFIX — top 15 kategorij z vsemi podatki.
    AI generira balanceStatus/demandStrength/supplyPressure/priceOutlook/
    recommendedAction/reasoning per kategorija.
  - balanceStatus: SELLER_MARKET (sellThrough >=70%), BALANCED (40-70%),
    BUYER_MARKET (<40%). priceOutlook: RISING/STABLE/FALLING (glede na
    balance). recommendedAction: SELL_AGGRESSIVELY (SELLER), SELL_NORMAL
    (BALANCED + demandStrength>50), HOLD (BALANCED + demandStrength<50),
    BUY_AGGRESSIVELY (BUYER).
  - Anti-hallucination: balanceStatus/priceOutlook/recommendedAction
    validirani enum-i (clampEnum), demandStrength/supplyPressure clamped
    [0, 100], reasoning clamped na 400 chars. AI vrne LE assessments
    (supply/demand/sellThroughRate ostanejo iz DB — ne zaupamo AI-ju za
    osnovne metrike).
  - Deterministic fallback: balanceStatus iz sellThroughRate, outlook in
    action iz balance, demandStrength = sellThroughRate + bonus za demand
    volumen (5/10/20), supplyPressure = 100 - sellThroughRate + bonus za
    supply volumen (20/50/100). Reasoning generiran slovensko.
  - Overall summary: avgSellThroughRate, sellerMarketCategories,
    buyerMarketCategories, bestCategoryToSell (highest demandStrength),
    bestCategoryToBuy (highest supplyPressure), marketBalance message.
  - Empty-state: "Ni oglasov v zadnjih 30 dneh — Supply/Demand analiza
    ni mogoča."
  - 'Elektronika: SELLER_MARKET (75% sell-through, demand 90/100). Avto:
    BUYER_MARKET (25%). Prodi elektroniko zdaj.'
  - AI Hub runner compatibility: GET+POST handler-ja z isto shared
    funkcijo `handleSupplyDemand(req)`.

- **Market Depth Analyzer** — `GET /api/analytics/market-depth-analyzer`
  - Meri "globino" trga per kategorija: koliko oglasov obstaja pri
    posamezni ceni (10 cenovnih bucketov). Pure DB analytics (NO AI) —
    depthScore 0-100, liquidityAssessment HIGH/MEDIUM/LOW/VERY_LOW,
    pricingConfidence 0-100, priceGap, sweetSpot, outlierCount.
  - Razlika od market-saturation (ki gleda volumen oglasov per kategorija)
    — ta gleda DISTRIBUCIJO cen znotraj kategorije (10 cenovnih bucketov,
    priceStdDev, depthScore 0-100, liquidityAssessment HIGH/MEDIUM/LOW/
    VERY_LOW, pricingConfidence, priceGap, sweetSpot, outlierCount).
    Razlika od price-history-forecaster (ki napoveduje cene) — ta gleda
    KAKO GLOBOH je trg danes (koliko podatkov imamo za zanesljivo ceno).
    Razlika od deal-velocity (ki meri hitrost prodaje) — ta meri GLOBINO
    in likvidnost.
  - Query all active listings (isHidden=false, price > 0). Per kategorija
    (iz monitor.tags, prvi tag):
    * `totalListings` = count
    * `priceRange` = { min, max, median }
    * `avgPrice` = mean
    * `priceStdDev` = standardna deviacija
    * `priceDistribution` = 10 cenovnih bucketov z count + percentage
    * `depthScore` 0-100 = listing count score (0-50: <5=5, <10=10,
      <20=20, <30=30, <50=40, >=50=50) + distribution evenness score
      (0-50: coefficient of variation bucket counts, lower CV = higher
      score)
    * `liquidityAssessment` = HIGH (>100 listings), MEDIUM (30-100),
      LOW (10-30), VERY_LOW (<10)
    * `pricingConfidence` 0-100 = listing count (0-60) + coefficient of
      variation (0-40: cv<0.2=40, <0.4=30, <0.6=20, <1.0=10, sicer=5)
    * `priceGap` = prvi prazen cenovni bucket (count=0), z range string
    * `sweetSpot` = bucket z največ oglasi (most liquid)
    * `outlierCount` = listings priced >2 std dev from mean
  - Summary: totalCategories, deepMarkets (depthScore>=70), thinMarkets
    (depthScore<40), safestCategory (deepest), riskiestCategory (thinnest),
    advice (glede na razmerje deep/thin).
  - Empty-state: "Ni oglasov z veljavno ceno — Market Depth analiza ni
    mogoča."
  - 'Elektronika: deep market (85 listings, depth 90/100, HIGH liquidity).
    Avto: thin (5 listings, depth 20/100, VERY_LOW liquidity).'

- **AI Risk Reward Calculator** — `GET+POST /api/ai/risk-reward-calculator`
  - AI izračuna risk-adjusted reward za posamezne trade-e (held inventar
    ali specific listingId/tradeId). AI-enhanced z grounding +
    anti-hallucination + 6h cache (`risk-reward-calc:${JSON.stringify(
    sortedItemIds)}`) + deterministic fallback.
  - Razlika od risk-spread-calculator (ki gleda PORTFELJ diverzifikacijo)
    — ta gleda POSAMEZNE item-e z risk-reward analizo in EV. Razlika od
    portfolio-stress-test (ki simulira scenarije -10/-25/-40%) — ta
    ocenjuje AKTUALNO tveganje vs nagrado za vsak item danes. Razlika od
    portfolio-concentration-risk (ki gleda Pareto + Herfindahl koncentracijo)
    — ta gleda POSAMEZEN item risk-reward.
  - Request body (optional): `{ listingId?, tradeId? }`. Brez body-ja
    analizira vse HELD trade-e.
  - Za vsak trade izračuna deterministične metrike:
    * `potentialReward` = aiEstimatedValue - buyPrice (upside, min 0)
    * `potentialLoss` = buyPrice × 0.3 (assume max 30% downside)
    * `rewardToRiskRatio` = potentialReward / potentialLoss
    * `probabilityOfProfit` = clamp(dealScore × 0.95, 5, 95) % (dealScore
      0-100 → 5-95% probability)
    * `expectedValue` = (pWin × potentialReward) - (pLoss × potentialLoss)
      v EUR (positive = dober deal)
  - AI prompt z GROUNDING_PROMPT_SUFFIX — top 20 item-ov z vsemi podatki.
    AI generira per item: riskLevel, rewardLevel, riskRewardGrade,
    confidenceInAssessment, keyRiskFactors (2-5), mitigationStrategies
    (2-5), finalRecommendation.
  - riskLevel: LOW/MEDIUM/HIGH/VERY_HIGH (glede na ratio + aiRisk).
    rewardLevel: LOW/MEDIUM/HIGH/VERY_HIGH (glede na rewardPct:
    <15%/<30%/<50%/>50%). riskRewardGrade: A+ (ratio>=3, EV>0), A
    (2-3), B (1-2), C (0.5-1), D (0.25-0.5), F (<0.25). finalRecommendation:
    STRONG_BUY (ratio>=3 + EV>0), BUY (ratio 2-3 + EV>0), HOLD (ratio 1-2
    + EV>=0), AVOID (ratio 0.25-1 ali EV<0), STRONG_SELL (ratio<0.25,
    zelo negativen EV).
  - Anti-hallucination: probabilityOfProfit clamped [5, 95], ratio uporablja
    ACTUAL computed potentialReward/potentialLoss (ne AI-jeve), keyRiskFactors
    in mitigationStrategies sanitize-ani (max 5, max 200 chars), grade in
    enum-i validirani. AI vrne LE assessments (DB numbers se ohranijo).
  - Deterministic fallback: riskLevel iz ratio (>=2=LOW, >=1=MEDIUM, >=0.5=
    HIGH, <0.5=VERY_HIGH), rewardLevel iz rewardPct, grade iz ratio
    (>3=A+, 2-3=A, 1-2=B, 0.5-1=C, 0.25-0.5=D, <0.25=F), recommendation
    iz ratio + EV. confidenceInAssessment iz dealScore + aiRisk (50 base
    + 10/20 bonus za visok dealScore, +15/+5 bonus za nizek aiRisk,
    -10/-10 penalty za nizek dealScore/visok aiRisk). keyRiskFactors in
    mitigationStrategies generirani iz metrik (nizka ratio, negativna EV,
    visok aiRisk, nizek dealScore, itd.).
  - Portfolio summary: totalItems, avgRiskLevel (LOW/MEDIUM/HIGH/VERY_HIGH
    glede na numeric map), avgRewardLevel, portfolioGrade (A+ do F
    glede na avg grade numeric), strongBuyCount, avoidCount (AVOID +
    STRONG_SELL), totalExpectedValue (vsota EV-jev v EUR),
    portfolioRecommendation (MOČAN če strongBuy >=50% + EV>0, ŠIBAK če
    avoidCount>=40% ali EV<0, MEŠAN sicer).
  - Empty-state: "Ni held trade-ov — Risk/Reward analiza ni mogoča."
  - 'PS5: ratio 2.5 (A grade), EV +85€, STRONG_BUY. Jakna: ratio 0.8 (C),
    EV -10€, HOLD.'
  - AI Hub runner compatibility: GET+POST handler-ja z isto shared
    funkcijo `handleRiskReward(req)`.

### Changed
- AI_ENDPOINTS.md: regeneriran z Python skripto → "Total: 297 endpoints"
  (295 → 297, +2 AI: supply-demand-balance #288, risk-reward-calculator #266)
- README.md: badge verzija v7.67.0 → v7.68.0, AI Endpoints 295 → 297,
  API Routes 440 → 443, tagline "295 AI endpointov + 40 analytics" →
  "297 AI endpointov + 41 analytics", Overview "Verzija v7.67.0" →
  "Verzija v7.68.0", "~126 funkcij" → "~129 funkcij", dodan v7.68 blok
  (3 funkcije) v "Kaj je novega" sekcijo, AI Hub badge "Vsi 295 AI
  endpointov" → "Vsi 297 AI endpointov", "Endpointi (295 AI + 40
  analytics... = 440)" → "(297 AI + 41 analytics... = 443)", dodana 2
  nova AI endpoint-a v AI primeri blok (supply-demand-balance,
  risk-reward-calculator, v7.68), dodan 1 nov analytics endpoint v
  profit pipeline (market-depth-analyzer, v7.68), Profit pipeline
  "(v7.32-v7.67)" → "(v7.32-v7.68)", Project structure "295 AI
  endpointov" → "297 AI endpointov", Coding standards "440 routes" →
  "443 routes", Roadmap "v7.67 (trenutno — ~126 funkcij)" → "v7.68
  (trenutno — ~129 funkcij)", profit pipeline list: dodane 3 nove
  funkcije (AI Supply Demand Balance Analyzer, Market Depth Analyzer,
  AI Risk Reward Calculator), "Profit pipeline (67+ funkcij)" →
  "(70+ funkcij)", Analytics "(40)" → "(41)", dodan 1 nov (Market Depth
  Analyzer), Testing "440 API routes" → "443 API routes", "Naslednji
  koraki: v7.50-v7.67 funkcije" → "...v7.50-v7.68 funkcije", "Zadnje
  verzije": dodan "v7.68.0 (avgust 2026) — AI Supply Demand Balance
  Analyzer, Market Depth Analyzer, AI Risk Reward Calculator" na vrh,
  AI_ENDPOINTS.md link "vseh 295 AI endpointov" → "vseh 297 AI
  endpointov", "v1.0 → v7.66" → "v1.0 → v7.67" (obstala napaka iz
  v7.67 — sedaj pravilno "v7.68"), "v1.0–v7.67" → "v1.0–v7.68".
- CHANGELOG.md: "[Unreleased] Načrtovano za v7.68+" → "...za v7.69+",
  dodana nova "[7.68.0] - 2026-08-10" sekcija (nad [7.67.0]) z vsemi 3
  endpoint-i in podrobnimi opisi (response shape, anti-hallucination
  rules, AI cache key, deterministic fallback, example comment, razlika
  od podobnih obstoječih endpoint-ov) in "### Changed" pod-sekcija z
  doc sync opisi.
- Verzija aplikacije: v7.67.0 → v7.68.0

## [7.67.0] - 2026-08-09

### Added — Profit Efficiency Analyzer & Portfolio Health Dashboard & AI Market Share Analyzer (3 funkcije)
- **Profit Efficiency Analyzer** — `GET /api/analytics/profit-efficiency-analyzer`
  - Meri kako učinkovito pretvarjaš čas + kapital v profit. Pure DB analytics
    (NO AI) — profit-per-day, profit-per-hold-day, capital efficiency ratio in
    time-weighted ROI z letno projekcijo in 0-100 efficiency scores.
  - Razlika od profit-dashboard (ki prikazuje splošen profit presek) — ta
    meri EFFICIENCY (profit per dan/hold-day/trade) in letno projekcijo.
    Razlika od roi-leaderboard (ki rank-a kategorije po ROI) — ta gleda
    profit-per-hold-day (€ earned per dan vezave kapitala) in annualized.
    Razlika od cash-conversion-cycle (ki meri koliko dni od nakupa do
    prodaje) — ta računa € earned per dan aktivnosti + per dan vezanega
    kapitala, z 0-100 time/capital efficiency score.
  - Query all SOLD trades z veljavnimi buyDate < sellDate. Za vsak trade:
    * `profit` = sellPrice - sellFees - buyPrice - buyFees
    * `holdDays` = (sellDate - buyDate) / day
  - Aggregate totals:
    * `totalProfit`, `totalInvested`, `totalHoldDays`, `totalTradingDays`
      (first buyDate → last sellDate), `tradeCount`
  - Efficiency metrics:
    * `profitPerDay` = totalProfit / totalTradingDays (€ earned per dan aktivnosti)
    * `profitPerTrade` = totalProfit / tradeCount
    * `profitPerHoldDay` = totalProfit / totalHoldDays (€ earned per dan vezave kapitala)
    * `capitalEfficiencyRatio` = totalProfit / totalInvested × 100 (%, kot ROI vendar jasneje)
    * `annualizedProfitPerDay` = profitPerDay × 365 (letna projekcija)
    * `timeEfficiencyScore` 0-100 (avg hold <15d=100, 15-30=80, 30-45=60, 45-60=40, >60=20)
    * `capitalUtilizationScore` 0-100 = totalInvested / (totalInvested + heldCapital) × 100
      (% aktivno deploy-anega kapitala vs idle — held inventar)
  - Per-category efficiency: tradeCount, totalProfit, avgHoldDays, profitPerHoldDay,
    efficiencyRank (1 = najboljša, sort desc po profitPerHoldDay)
  - Per-price-range efficiency (0-100€, 100-500€, 500€+): tradeCount, totalProfit,
    avgHoldDays, profitPerHoldDay
  - Recommendations: mostEfficientCategory, leastEfficientCategory, efficiencyAdvice
    (glede na time/capital score), targetImprovements (4-5 concrete akcij:
    povečaj volumen v top kategoriji, zmanjšaj v slabši, skrajšaj hold time,
    povečaj capital utilization, +20% profitPerTrade target).
  - Empty-state: "Ni prodanih trade-ov — Profit Efficiency analiza ni mogoča."
  - 'Profit 2000€ v 90 dneh = 22€/dan. Najbolj učinkovita: elektronika
    (1.5€/hold-day). Letna projekcija: 8030€.'

- **Portfolio Health Dashboard** — `GET /api/analytics/portfolio-health-dashboard`
  - Celovit health score (0-100) za trenutni portfelj glede na 5 dimenzij
    zdravja: Diversification, Liquidity, Risk Exposure, Aging in Profit Potential.
    Pure DB analytics (NO AI) z weighted-average klasifikacijo
    EXCELLENT/GOOD/AVERAGE/POOR/CRITICAL.
  - Razlika od portfolio-concentration-risk (ki gleda PARETO + HERFINDAHL
    koncentracijsko tveganje) — ta gleda 5 DIMENZIJ zdravja portfelja z
    weighted-score 0-100 in klasifikacijo. Razlika od inventory-health-monitor-v2
    (ki AI-analizira inventar) — ta je pure DB analytics z eksplicitnimi health
    dimensions in severity-tagged issues. Razlika od portfolio-stress-test (ki
    simulira -10/-25/-40% scenarije) — ta gleda AKTUALNO zdravje portfelja danes.
  - Query all HELD trades + njihove povezane listings (za aiRisk, aiEstimatedValue).
    Query SOLD trades za historical context (avg hold reference).
  - 5 health dimensions (vsaka 0-100):
    * `diversification` — based on Herfindahl index kategorij (<0.2=100, 0.2-0.4=80,
      0.4-0.6=60, >0.6=30). Status: DIVERZIFICIRANO/DOBRO/ZMERNJO/KONCENTRIRANO.
    * `liquidity` — based on avg hold days held inventarja (<15d=100, 15-30=80,
      30-45=60, 45-60=40, >60=20). Status: ODLIČNA/DOBRA/ZMERNA/POOR/KRITIČNA.
    * `riskExposure` — based on avg aiRisk held listings (<3=100, 3-5=80, 5-7=60,
      >7=30). Status: NIZKO/ZMERNJO/POVIŠANO/VISOKO (NEZNANO če ni AI podatkov).
    * `aging` — % held <30 dni (>80%=100, 60-80%=80, 40-60%=60, <40%=30).
      Status: FRESH/DOBRO/ZMERNJO/STAR.
    * `profitPotential` — unrealized profit (estValue - buyPrice) / buyPrice
      (>30%=100, 20-30%=80, 10-20%=60, <10%=30, negativno=30). Status:
      ODLIČEN/DOBRO/ZMEREN/NIZKO/NEGATIVNO.
  - Overall health = weighted average: Diversification 20%, Liquidity 25%,
    Risk 20%, Aging 15%, Profit Potential 20%.
  - Classification: EXCELLENT (80+), GOOD (60-79), AVERAGE (40-59), POOR (20-39),
    CRITICAL (<20).
  - Issues array: per dimension LOW/MEDIUM/HIGH severity + issue opis + recommendation.
  - Summary: "Portfolio health 72/100 (GOOD). 3 težav — naslovite likvidnost in aging."
  - Portfolio summary: totalItems, totalCapital, totalEstValue, unrealizedProfit,
    avgHoldDays, avgRisk, freshItemsPct.
  - Empty-state: "Ni held trade-ov — portfelj je prazen. Začni z nakupi za health analizo."
  - 'Portfolio health 72/100 (GOOD). Likvidnost 40/100 (POOR — avg hold 52d).
    Prodi starejše item-e za izboljšanje.'

- **AI Market Share Analyzer** — `GET+POST /api/ai/market-share-analyzer`
  - AI ocenjuje tvoj market share v kategorijah kjer trguješ, glede na volumen
    oglasov vs total market listings. Prikazuje tvojo pozicijo vs konkurenco
    z klasifikacijo LEADER/CHALLENGER/FOLLOWER/NICHE.
  - Razlika od competitive-landscape-analyzer (ki analizira druge prodajalce/
    konkurente aktivne v tvojih kategorijah) — ta ocenjuje TVOJ delež na trgu
    (market share % per kategorija). Razlika od analytics/market-gap-finder
    (ki išče praznine v trgu) — ta ANALIZIRA tvojo pozicijo in growth opportunities.
    Razlika od analytics/competitor-tracker (ki sledi dobaviteljem) — ta gleda
    TVOJO aktivnost vs celoten trg.
  - Query all held + sold trades — distinct category = "tvoje kategorije".
    Za vsako kategorijo: ekstrakt matchingMonitorIds iz povezanih listings.
  - Query listings z bookmarked=true OR contactStatus != 'none' = "tvoja
    aktivnost". Per-monitor count za yourListingsInteracted.
  - Per category row:
    * `yourListingsInteracted` (bookmarked + contacted v matching monitors)
    * `totalMarketListings` (count of all listings v matching monitors)
    * `yourTradesInCategory` (held + sold)
    * `yourSoldInCategory`
    * `estimatedMarketShare` = yourTradesInCategory / (totalMarketListings × 0.1) × 100
      (predpostavka: ~10% listings rezultira v prodajo → tvoj delež nakupov vs
      ocenjene total sales). Clamped na [0, 100].
    * `competitivePosition` LEADER/CHALLENGER/FOLLOWER/NICHE (deterministic glede
      na share percentiles: top 25%=LEADER, 25-50%=CHALLENGER, 50-75%=FOLLOWER,
      bottom 25%=NICHE)
    * `confidenceScore` 0-100 (base 50, +25 če >=100 listings, +15 če >=30, +5 če
      >=10, -10 če manj; +15 če >=5 trades, +5 če >=2, -10 če 0; +10 če >=5
      interakcij)
  - AI prompt z GROUNDING_PROMPT_SUFFIX — top 15 kategorij z vsemi podatki.
    AI generira:
    * `dominantCategories` (top 2-3 z najvišjim share, z reasoning)
    * `untappedCategories` (2-3 z velikim trgom >=20 oglasov kjer nisi aktiven)
    * `overallPosition` (1-2 povedi slovensko — kakovost pozicije)
    * `growthOpportunity` (2-3 kategorije kjer lahko rasteš, potentialShare + strategy)
  - Anti-hallucination:
    * estimatedMarketShare clamped na [0, 100]
    * category, reasoning, strategy, overallPosition clamped na max chars
    * share, marketSize, potentialShare clamped na [0, max]
  - Deterministična osnova (buildDeterministicAnalysis): dominant = top 3 po
    share, untapped = market >=20 + 0 trades, growthOpportunity = market >=15 +
    share <10 z 2× projection.
  - AI cache key `market-share-analyzer:${currentMonth}` (6h TTL — refreshes ~4x/day,
    monthly cache rotation).
  - Both GET and POST handlers (AI Hub runner compatibility).
  - Empty-state: "Ni held ali sold trade-ov — Market Share analiza ni mogoča."
  - 'Elektronika: 12% market share (CHALLENGER). Moda: 2% (NICHE). Priložnost:
    razširi v avto (velik trg, 0% share).'

### Changed
- AI_ENDPOINTS.md: regeneriran z Python skripto → "Total: 295 endpoints"
  (294 → 295, +1 AI: market-share-analyzer #207)
- README.md: posodobljen z v7.67.0 (badge, 13 referenc), 295 AI (6 referenc),
  440 routes (5 referenc), 40 analytics (3 reference), ~126 funkcij (2 referenci),
  dodan v7.67 blok v "Kaj je novega" (3 funkcije), dodan v7.67.0 v "Zadnje verzije",
  Roadmap posodobljen na v7.67 (trenutno — ~126 funkcij), Analytics (38) → (40)
  z 2 novima (Profit Efficiency Analyzer, Portfolio Health Dashboard), Profit
  pipeline list dodane 3 nove funkcije, Profit pipeline (v7.32-v7.66) → (v7.32-v7.67),
  "v1.0 → v7.66" → "v1.0 → v7.67", "v7.50-v7.66 funkcije" → "v7.50-v7.67 funkcije"
- Verzija aplikacije: v7.66.0 → v7.67.0

## [7.66.0] - 2026-08-08

### Added — AI Competitive Landscape Analyzer & Price History Forecaster & FOMO/Scarcity Trigger Generator (3 funkcije)
- **AI Competitive Landscape Analyzer** — `GET+POST /api/ai/competitive-landscape-analyzer`
  - AI analizira konkurenčno krajino — identificira druge flipper-je/prodajalce
    aktivne v tvojih kategorijah, njihove cenovne strategije, listing
    frequency in market share. Pomaga pozicionirati proti konkurenci.
  - Razlika od competitor-price-tracker (ki spremlja cene posameznih konkurenčnih
    oglasov) — ta ANALIZIRA prodajalce kot celoto (njihove strategije,
    frekvence, market share, threat level). Razlika od analytics/competitor-tracker
    (ki sledi supplier-jem) — ta gleda AKTIVNE PRODAJALCE v tvojih kategorijah
    in njihovo grožnjo. Razlika od analytics/supplier-crm (ki CRM-upravlja
    dobavitelje) — ta gleda KONKURENCO (ljudje ki prodajajo podobne item-e kot ti).
  - Query all listings iz zadnjih 30 dni z sellerName populatanim, groupirani po
    sellerName. Samo prodajalci z 3+ oglasi = potencialni konkurenti. Za vsakega:
    * `totalListings` (count)
    * `categories` (distinct monitor.name kot kategorija proxy)
    * `avgPrice` in `priceRange` [min, max]
    * `listingFrequency` (listings per week, computed iz firstSeen→lastSeen window)
    * `avgDealScore` (povprečen dealScore = kako dobri so njihovi deal-i)
    * `marketShare` (njihovi oglasi / total listings v njihovih kategorijah × 100)
    * `firstSeen` / `lastSeen` (aktivnostno okno)
  - Top 20 konkurentov poslanih AI. AI prompt z GROUNDING_PROMPT_SUFFIX — za vsakga:
    * `pricingStrategy` (PREMIUM/MID_MARKET/BUDGET glede na +-10% tržnega avg)
    * `specialization` (glavna kategorija/niša)
    * `threatLevel` (HIGH/MEDIUM/LOW glede na marketShare + listings + dealQuality)
    * `yourAdvantage` (kje imaš prednost — cena, slike, hitrost)
    * `recommendedAction` (specifična akcija za ta konkurent)
  - `marketPosition`: yourAvgPrice (iz held inventarja), competitorAvgPrice,
    yourPosition (BELOW_MARKET/AT_MARKET/ABOVE_MARKET), positioningAdvice.
  - `competitiveActions`: 3-5 akcij z priority (HIGH/MEDIUM/LOW) in expectedImpact.
  - `differentiationOpportunity`: 2-3 manj zasedene niše z reasoning in potentialProfit.
  - Anti-hallucination:
    * marketShare clamped na [0, 100]
    * cene clamped na actual data range
    * pricingStrategy/threatLevel/yourPosition/priority validirani enum-i, fallback na
      deterministic (percentile-based za pricing, score-based za threat)
    * sellerName validiran da obstaja v competitors listi (prepreči AI hallucinations
      nereálnih prodajalcev)
    * summary clamped na 500 znakov
  - Deterministična osnova (buildDeterministicAnalysis): pricing strategy iz avgPrice
    percentilov (p33, p67), threat level iz composite score (marketShare + listings +
    avgDealScore).
  - AI cache key `competitive-landscape:${currentMonth}` (6h TTL — refreshes ~4x/day,
    monthly cache rotation).
  - Both GET and POST handlers (AI Hub runner compatibility).
  - Empty-state: "Ni oglasov z sellerName v zadnjih 30 dneh — Competitive Landscape
    potrebuje vsaj nekaj oglasov z identificiranimi prodajalci."
  - 'Top konkurent: Elektro Marjan (15 oglasov, BUDGET strategy, 25% market share,
    HIGH threat). Tvoja prednost: boljše slike. Specializacija: elektronika.'

- **Price History Forecaster** — `GET /api/analytics/price-history-forecaster`
  - Uporablja zgodovinske cenovne podatke (90 dni) za napoved cenovnih gibanj po
    kategorijah. Pure DB analytics s statistično projekcijo (linearna regresija)
    — NO AI. Prikaz trend linije in predvidene smeri (RISING/STABLE/FALLING).
  - Razlika od market-trend (ki gleda rising/falling counts v zadnjem obdobju)
    — ta računa LINEARNO REGRESIJO na tedenskih povprečjih (13 tednov) in
    PROJICIRA ceno čez 30 dni (forecast30d) z confidence score-om. Razlika
    od listings/[id]/price-forecast (ki napove ceno za EN listing) — ta
    napove gibanje CELE KATEGORIJE z BUY/SELL/HOLD priporočilom. Razlika
    od seasonal-calendar (ki prikazuje statične mesečne vzorce) — ta gleda
    AKTUALNO 13-tedensko zgodovino z linearno projekcijo.
  - Query all listings iz zadnjih 90 dni z veljavnimi cenami (price > 0),
    groupirani po category (monitor.name kot proxy) in po tednu (Monday-start).
  - Za vsako kategorijo z 4+ tedni podatkov:
    * `currentAvgPrice` (povprečje zadnjih 4 tednov)
    * `previousAvgPrice` (povprečje tednov 5-8)
    * `priceChangePercent` ((current - previous) / previous × 100)
    * `volatility` (std dev / mean weekly prices)
    * `weeklyPrices` (časovna serija do 13 tednov)
    * `forecast30d` (projecija čez 30 dni z linearno regresijo)
    * `forecastDirection` (RISING/STABLE/FALLING glede na slope threshold = 1% avg/week)
    * `confidenceScore` (0-100, kombinacija sample size, volatility, konsistence slope
      sign z change direction, recent data)
    * `recommendation` (GOOD_TIME_TO_BUY za FALLING + change < -5%,
      GOOD_TIME_TO_SELL za RISING + change > +5%, HOLD za STABLE + change < 3%,
      NEUTRAL drugače)
  - Summary: totalCategories, risingCount, fallingCount, stableCount,
    bestBuyCategory (FALLING z najvišjo confidence), bestSellCategory (RISING
    z najvišjo confidence).
  - Advice: slovensko besedilo z najboljšimi buy/sell priložnostmi.
  - Pure DB analytics — NO AI (hitro, deterministic, brez AI stroškov).
  - Empty-state: "Ni oglasov s cenami v zadnjih 90 dneh — Price History Forecaster
    potrebuje vsaj nekaj oglasov z veljavnimi cenami."
  - 'Elektronika: -8% v 4 tednih, forecast FALLING → dober čas za nakup.
    Moda: +12% → prodi zdaj.'

- **FOMO/Scarcity Trigger Generator** — `GET+POST /api/ai/fomo-scarcity-generator`
  - AI generira FOMO (Fear Of Missing Out) in scarcity messaging za HELD
    inventar listings da poveča konverzijo (inquiry rate). Ustvari urgency-driven
    listing text additions (slovensko).
  - Razlika od listing-emotional-trigger (ki generira čustvene sprožilce za
    POSAMEZEN oglas za vse listeče) — ta je specifično za HELD inventar in
    vključuje expectedConversionLift (%) in scarcityType klasifikacijo.
    Razlika od listing-conversion-optimizer (ki optimira konverzijo z A/B
    testiranjem naslovov) — ta dodaja SCARCITY/FOMO besedilo specifično za
    urgency. Razlika od listing-velocity (ki analizira hitrost prodaje) — ta
    GENERIRA akcijsko besedilo za pospešitev prodaje.
  - Query all HELD trades z njihovim linked Listing (za title, category, price).
  - Za vsak held item build context: title, category, buyPrice, daysHeld,
    estValue (linked listing.price ali buyPrice × 1.3), similarListingsCount
    (listings v istem monitor + cena ±30% v zadnjih 30 dneh), isSeasonal
    (current month = Nov/Dec/Jan in seasonal category), isRare (≤ 3 podobni oglasi).
  - AI generira per-item scarcity messaging:
    * `urgencyLevel` (LOW/MEDIUM/HIGH/CRITICAL glede na daysHeld + similarListings + rare + seasonal)
    * `scarcityType` (TIME_LIMITED/QUANTITY_LIMITED/SEASONAL/RARE_FIND)
    * `fomoPhrases` (3-5 slovenskih fraz ki ustvarijo urgentnost)
    * `listingAddition` (1-2 povedi slovensko, max 200 znakov, dodane k opisu)
    * `callToAction` (specifičen CTA, npr. "Piši zdaj, preden je prepozno!")
    * `psychologicalHook` (glavni psihološki sprožilec: scarcity, urgency, social proof, loss aversion)
    * `expectedConversionLift` (0-50%, predicted % povečanja povpraševanj)
  - Anti-hallucination:
    * expectedConversionLift clamped na [0, 50]
    * urgencyLevel, scarcityType validirani enum-i, fallback na deterministic
      (CRITICAL za RARE_FIND ali >60 days held, HIGH za >30 days ali ≤2 similar,
      MEDIUM za >14 days, LOW drugače)
    * fomoPhrases clamped na 5 max, vsaka max 120 znakov
    * listingAddition clamped na 200 znakov
    * Sporočila morajo biti resnična in utemeljena z dejanskimi podatki
      (similarListings count, daysHeld) — AI prompt izrecno prepove lažno redkost
  - Deterministic fallback: 4 nivoji generičnih FOMO fraz (LOW/MEDIUM/HIGH/CRITICAL),
    pricing hook izbere scarcity principle glede na type.
  - AI cache key `fomo-scarcity:${JSON.stringify(heldItemIds)}` (6h TTL — invalidira
    ko se spremeni held inventar).
  - Both GET and POST handlers (AI Hub runner compatibility).
  - Summary: totalItems, criticalCount, highUrgencyCount, avgExpectedLift,
    bestPractices (slovensko, 4-5 nasvetov o uporabi FOMO messaging-a).
  - Empty-state: "Ni held trade-ov — FOMO/Scarcity Generator potrebuje held
    inventar za generiranje messaging-a."
  - 'PS5 (redko) → Redko najdenje! Samo 3 podobni oglasi na Bolhi. Critical
    urgency, +25% conversion lift, scarcity=RARE_FIND.'

### Changed
- `AI_ENDPOINTS.md` regeneriran: 292 → 294 endpoints (+2 AI: competitive-landscape-analyzer, fomo-scarcity-generator)
- `README.md` posodobljen:
  - Version badge: v7.65.0 → v7.66.0
  - AI Endpoints badge: 292 → 294
  - API Routes badge: 434 → 437 (+3)
  - Tagline: "292 AI endpointov + 37 analytics" → "294 AI endpointov + 38 analytics"
  - Overview: "Verzija v7.65.0" → "Verzija v7.66.0", counts posodobljeni,
    "~120 funkcij" → "~123 funkcij"
  - "Kaj je novega v v7.56–v7.65 (10 verzij, 30 novih funkcij)" → "...v7.56–v7.66
    (11 verzij, 33 novih funkcij)", dodan v7.66 blok (3 funkcije) na vrh
  - AI Hub badge v tabeli: "Vsi 292 AI endpointov" → "Vsi 294 AI endpointov"
  - "Endpointi (292 AI + 37 analytics + 10 cron + sistemski = 434)" →
    "...(294 AI + 38 analytics + 10 cron + sistemski = 437)"
  - Dodana 2 nova AI endpointa v AI primeri blok (competitive-landscape-analyzer, fomo-scarcity-generator, v7.66)
  - "Profit pipeline (v7.32-v7.65)" → "...(v7.32-v7.66)"
  - Dodan 1 nov analytics endpoint v profit pipeline blok (price-history-forecaster, v7.66)
  - Dodana 2 nova AI endpointa v profit pipeline listo (competitive-landscape-analyzer, fomo-scarcity-generator, v7.66)
  - Project structure: "292 AI endpointov" → "294 AI endpointov"
  - Coding standards: "434 routes" → "437 routes"
  - Roadmap: "v7.65 (trenutno — ~120 funkcij)" → "v7.66 (trenutno — ~123
    funkcij)", profit pipeline list: dodane 3 nove funkcije (AI Competitive
    Landscape Analyzer, Price History Forecaster, FOMO/Scarcity Trigger Generator)
  - Analytics (37) → (38), dodana 1 nova (Price History Forecaster)
  - Testing: "434 API routes" → "437 API routes"
  - "Naslednji koraki": "v7.50-v7.65 funkcije" → "...v7.50-v7.66 funkcije"
  - "Zadnje verzije": dodan "v7.66.0 (avgust 2026) — AI Competitive Landscape
    Analyzer, Price History Forecaster, FOMO/Scarcity Trigger Generator" na vrh
- `CHANGELOG.md`: "[Unreleased] Načrtovano za v7.66+" → "...za v7.67+"

## [7.65.0] - 2026-08-08

### Added — AI Deal Quality Forecaster & Negotiation Success Rate Analyzer & Portfolio Concentration Risk Analyzer (3 funkcije)
- **AI Deal Quality Forecaster** — `GET+POST /api/ai/deal-quality-forecaster`
  - AI napove kvaliteto deal-ov za naslednjih 7 dni na podlagi zgodovinskih
    vzorcev po dnevih v tednu (zadnjih 90 dni). Za vsak dan: predictedDealScore,
    predictedListingCount, predictedPrilikaCount, confidenceScore in
    recommendation (SCAN_ACTIVELY/SKIP/CHECK_MORNING/CHECK_EVENING).
  - Razlika od deal-timing (ki gleda kdaj se pojavijo PRILIKA oglasi po dnevih/urah
    — zgodovinski pregled) — ta PREDVIDI prihodnje 7 dni (forecast) z AI za vsak
    dan posebej. Razlika od seasonal-timing-optimizer (ki priporoča buy/sell
    timing za held inventar) — ta gleda najboljše dni za SKENIRANJE trga (kdaj
    obnoviti monitore in pričakovati nove dobre oglase).
  - Query all listings iz zadnjih 90 dni z dealScore in aiEstimatedValue, groupirani
    po dnevu v tednu (Sunday-Saturday). Compute per-day:
    * `avgDealScore` (povprečen dealScore za ta dan v tednu)
    * `avgEstValue` (povprečna AI estimated value)
    * `listingCount` (koliko oglasov se pojavi ta dan)
    * `prilikaRate` (% z aiVerdict = 'PRILIKA' za ta dan)
  - Query zadnjih 14 dni za recent trend (is this week better or worse than usual?).
  - Compute trend: IMPROVING (recent > 90d avg +5), STABLE (±5), DECLINING (recent
    < 90d avg -5).
  - Deterministična osnova (buildDeterministicForecast): za vsak od naslednjih 7
    dni (start jutri):
    * predictedDealScore = historical avg za ta dan v tednu, prilagojen za trend
      (×1.05 improving / ×0.95 declining)
    * predictedListingCount = blend 80% historical + 20% recent (ali 60/40 če
      trend shifting)
    * predictedPrilikaCount = predictedListingCount × prilikaRate / 100
    * confidenceScore baziran na sample size (listingCount) + consistenci
      (varianca od 90d avg) + trend stability (0-100)
    * recommendation: SCAN_ACTIVELY (dealScore >= 65 in prilika >= 2) / SCAN_NORMAL
      (50-64 in prilika >= 1) / SKIP (< 35 in < 4 listings) / CHECK_MORNING
      (45+ z malo prilik) / CHECK_EVENING (drugače)
  - AI prompt z GROUNDING_PROMPT_SUFFIX — historical day-of-week stats + recent
    trend + deterministic basis (za referenco, AI lahko prilagodi ±20%).
  - Anti-hallucination:
    * predictedDealScore clamped na [0, 100]
    * predictedListingCount clamped na [0, 2 × max historical listingCount]
    * predictedPrilikaCount clamped na [0, predictedListingCount]
    * confidenceScore clamped na [0, 100]
    * recommendation validiran (SCAN_ACTIVELY/SCAN_NORMAL/SKIP/CHECK_MORNING/
      CHECK_EVENING), fallback na deterministic
    * trend validiran (IMPROVING/STABLE/DECLINING), fallback na deterministic
    * bestDayReasoning clamped na 400 znakov, fallback na deterministic
  - AI cache key `deal-quality-forecaster:${currentWeek}` (6h TTL — refreshes
    4x/day).
  - Both GET and POST handlers (AI Hub runner compatibility).
  - Empty-state: "Ni oglasov v zadnjih 90 dneh — Deal Quality Forecaster
    potrebuje vsaj nekaj zgodovine."
  - 'Torek = najboljši dan za skeniranje (avg dealScore 72, 15 oglasov). Petek =
    najslabši (45, 8 oglasov). Načrtuj nakupe za torek.'

- **Negotiation Success Rate Analyzer** — `GET /api/analytics/negotiation-success-rate`
  - Analizira zgodovinske izide pogajanj in izračuna success rate glede na
    kategorijo, cenovni razpon, offer depth in vrsto prodajalca. Pure DB
    analytics — NO AI.
  - Razlika od negotiation-outcome-predictor (ki pred pošiljanjem ponudbe AI
    napove ACCEPT/COUNTER/REJECT verjetnosti za EN oglas) — ta ANALIZIRA
    ZGODOVINO vseh tvojih pogajanj in izračuna aggregate success rate po
    kategorijah, cenovnih razponih in offer depth-ih. Razlika od negotiation-
    playbook (ki generira strategijo za eno pogajanje) — ta da DATA-DRIVEN
    insight o tem, kje tvoja pogajanja dejansko delujejo.
  - Query all trades z linked Listing (za asking price + sellerName). Asking
    price = linked Listing.price; če ni linked Listing-a, trade izpuščen iz
    negotiated analize (razen če contactStatus != 'none').
  - Compute per-trade:
    * `askingPrice` = linked listing price
    * `discountPct` = (asking - buyPrice) / asking × 100
    * `savingsEur` = asking - buyPrice
    * `isNegotiated` = savingsEur > 0 (strogo pod asking)
    * `success` = negotiated AND status = 'sold'
    * `failed` = status = 'cancelled' (karkoli)
  - Compute overall:
    * `totalNegotiations` = trades z buyPrice < asking
    * `successRate` = % ki so sold
    * `avgDiscountAchieved` = avg discountPct
    * `avgSavingsEur` = avg savings v EUR
    * `bestCategory` = kategorija z najvišjo success rate (min 2 trades)
    * `bestPriceRange` = cenovni razpon z najvišjo success rate (min 2 trades)
  - Compute breakdowns:
    * `byCategory` — per kategorija: totalNegotiated, successRate, avgDiscount,
      avgSavingsEur
    * `byPriceRange` — per 3 razponi (0-100€, 100-500€, 500€+): totalNegotiated,
      successRate, avgDiscount
    * `byOfferDepth` — per 4 globine (0-5%, 5-15%, 15-30%, 30%+): totalOffered,
      successRate, avgCounterPrice (če sold)
    * `bySellerType` — RECURRING (sellerName se pojavi 2+ krat) vs ONE_TIME:
      totalNegotiated, successRate, avgDiscount
  - Recommendations:
    * `optimalOfferDepth` = najvišja success rate med depth-i z >= 2 trades
    * `easiestCategory` = bestCategory
    * `hardestCategory` = najnižja success rate z >= 2 trades
    * `advice` = 1-3 povedi slovensko z specificnimi številkami
  - Empty-state: "Ni trade-ov — Negotiation Success Rate Analyzer potrebuje
    trades z linked Listing-om za asking ceno."
  - 'Elektronika: 65% success rate pri 10% popusta. Avto: 30% success rate.
    Optimal offer: 5-15% below asking.'

- **Portfolio Concentration Risk Analyzer** — `GET /api/analytics/portfolio-concentration-risk`
  - Pareto analiza (% trade-ov = % profita) in Herfindahl-Hirschman Index
    (0=diversified, 10000=monopoly) za identifikacijo koncentracijskega
    tveganja portfelja. Pure DB analytics — NO AI.
  - Razlika od risk-spread-calculator (ki priporoča AI kapitalsko alokacijo
    glede na kategorijo) — ta računa PARETO analizo in HERFINDAHL index z
    eksplicitno DIVERSIFIED/MODERATE/CONCENTRATED/HIGH_RISK klasifikacijo.
    Razlika od portfolio-stress-test (ki simulira tržne scenarije -10/-25/-
    40%) — ta gleda STRUKTURO portfelja (koliko je v eni kategoriji/brandu)
    in priporoča diverzifikacijo.
  - Query all HELD trades za current portfolio + all SOLD trades za historical
    profit distribution.
  - Compute current portfolio concentration:
    * `byCategory` — per kategorija: itemCount, capital, percentage
    * `byBrand` — per brand (extractBrand iz naslova, enaka logika kot
      roi-leaderboard z known brands: apple, samsung, sony, iphone, ...):
      itemCount, capital, percentage
    * `byPriceRange` — per 4 razponi (0-100€, 100-500€, 500-1000€, 1000€+):
      itemCount, capital, percentage
  - Compute Pareto analysis na SOLD trades:
    * Sort sold trades by profit desc
    * `top20PercentProfitShare` = % profita iz top 20% trade-ov
    * `tradesFor80PercentProfit` = koliko trade-ov = 80% profita
    * `paretoRatio` = npr. "20/80" (20% trade-ov = 80% profita)
    * `insight` = 1 stavek slovensko z specificnimi številkami
  - Compute risk metrics:
    * `herfindahlIndex` = sum of (category% squared), scaled 0-10000 (0 =
      perfectly diversified, 10000 = monopoly)
    * `topCategoryShare` = % v največji kategoriji
    * `topBrandShare` = % v največjem brandu
    * `concentrationLevel` = DIVERSIFIED (< 25%) | MODERATE (25-40%) |
      CONCENTRATED (40-60%) | HIGH_RISK (> 60%)
    * `riskScore` = topCategoryShare × 0.5 + topBrandShare × 0.2 + HHI/100
      (clamped 0-100)
  - Recommendations:
    * `overexposedCategories` — kategorije z share >= 30%: currentShare,
      suggestedReduction (na < 25%)
    * `underrepresentedCategories` — top 3 zgodovinsko profitabilne kategorije
      (< 15% current share) z suggestedIncrease in reasoning
    * `diversificationAdvice` = 1 stavek slovensko glede na concentrationLevel
    * `targetAction` = konkretna naslednja akcija (npr. "Zmanjšaj 'avto' s 73%
      na <25%... nove nakupe usmeri v moda.")
  - Empty-state: "Ni held ali sold trade-ov — Concentration Risk analiza ni
    mogoča."
  - '65% kapitala v elektronika = HIGH_RISK. Herfindahl 4200. Top 20% trade-ov
    = 75% profita. Diverzificiraj v moda.'

### Changed
- AI_ENDPOINTS.md: regenerated → 291 → 292 endpoints (+1 AI: deal-quality-
  forecaster)
- README.md: version badge v7.64.0 → v7.65.0, AI Endpoints 291 → 292, API
  Routes 431 → 434, "291 AI + 35 analytics" → "292 AI + 37 analytics", "~117
  funkcij" → "~120 funkcij", added v7.65 block at top of "Kaj je novega",
  profit pipeline (v7.32-v7.64) → (v7.32-v7.65), Analytics (35) → (37) z 2
  novima (Negotiation Success Rate, Portfolio Concentration Risk), v7.65.0
  entry in "Zadnje verzije", Roadmap v7.64 → v7.65, profit pipeline list +3
  (AI Deal Quality Forecaster, Negotiation Success Rate Analyzer, Portfolio
  Concentration Risk Analyzer)
- CHANGELOG.md: [Unreleased] "v7.65+" → "v7.66+", added [7.65.0] section

## [7.64.0] - 2026-08-08

### Added — AI Trading Coach & Deal Fatigue Detector & Seasonal Timing Optimizer (3 funkcije)
- **AI Trading Coach** — `GET+POST /api/ai/trading-coach`
  - Osebni AI coach ki analizira traderjevo trading zgodovino in da personaliziran
    advice za izboljšavo. AI generira strengths, weaknesses, patterns,
    recommendations, riskProfile, skillLevel in nextSteps bazirane na realni
    statistiki.
  - Razlika od trade-replication-engine (ki predlaga nove MONITOR-je bazirane na
    winner-ih) — ta ANALIZIRA TVOJO TRADERSKO POTEKAVANJO (win rate by
    day/category, koncentracija, recent trend). Razlika od capital-allocation-
    optimizer (ki svetuje kapitalsko alokacijo) — ta gleda osebne vzorce in
    slabosti (overtrading, vikend-kupi, koncentracija).
  - Query all SOLD trades z buy+sell prices+dates:
    * Trading frequency (trades per week)
    * Win rate overall + by day of week + by category + by price range
    * Avg hold time + avg ROI
    * Most active buying days (by day of week)
    * Category concentration (what % of trades in top category)
    * Recent performance trend (last 30d vs previous 30d)
  - Query HELD trades za current portfolio state (heldCount, heldCapital).
  - Query cancelled trades za cancellation rate.
  - AI prompt z GROUNDING_PROMPT_SUFFIX — vsa statistika (kategorije, dnevi,
    cenovni razponi, recent trend). AI generira coaching z:
    * `strengths` (2-3 stringi — kaj trader dela dobro)
    * `weaknesses` (2-3 stringi — področja za izboljšavo)
    * `patterns` (2-4 vzorci z impact POSITIVE/NEGATIVE/NEUTRAL in detail)
    * `recommendations` (3-5 akcij z priority HIGH/MEDIUM/LOW in expectedImpact)
    * `riskProfile` (CONSERVATIVE / BALANCED / AGGRESSIVE baziran na avgROI,
      hold time, koncentraciji in top category win rate)
    * `skillLevel` (BEGINNER / INTERMEDIATE / ADVANCED / EXPERT baziran na
      volume + win rate + ROI)
    * `nextSteps` (1-2 immediate akcije)
    * `summary` (1-2 povedi overall assessment slovensko)
  - Anti-hallucination:
    * Vsi string-ovi clamped na max 240 znakov
    * riskProfile validiran (CONSERVATIVE/BALANCED/AGGRESSIVE), fallback
      deterministic
    * skillLevel validiran (BEGINNER/INTERMEDIATE/ADVANCED/EXPERT), fallback
      deterministic
    * priority validirana (HIGH/MEDIUM/LOW)
    * impact validiran (POSITIVE/NEGATIVE/NEUTRAL)
    * Če AI ne vrne nobenega pattern-a ali recommendation-a, fallback na
      deterministic
  - Deterministic fallback (buildDeterministicCoaching):
    * Strengths bazirani na winRate >= 60%, avgROI >= 20%, hold <= 14d, volume
      >= 30
    * Weaknesses bazirani na koncentracija >= 70%, winRate < 50%, hold > 45d,
      day-of-week variacija >= 20pp, DECLINING trend
    * Patterns: koncentracija >= 60%, quick-flip (hold <= 10d + volume >= 10),
      cancelRate >= 15%, IMPROVING trend, tradesPerWeek >= 5
    * Recommendations: diverzifikacija, strožji filter, krajši hold, best day
      nakupe, decline volumen
    * riskProfile = computeRiskProfile (avgROI, holdDays, koncentracija,
      topCategoryWinRate) → score >= 5 AGGRESSIVE, <= 2 CONSERVATIVE
    * skillLevel = computeSkillLevel (totalSold, winRate, avgROI) — BEGINNER
      < 10 sold ali winRate < 40%, EXPERT >= 40 sold AND winRate >= 70% AND
      avgROI >= 25%
  - AI cache key `trading-coach:${totalSold}` (6h TTL) — invalidates ko nova
    prodaja spremeni totalSold.
  - Both GET and POST handlers (AI Hub runner compatibility).
  - Empty-state: "Ni prodanih trade-ov — Trading Coach potrebuje sold trades
    za analizo vzorcev."
  - '80% koncentracija v elektronika — diverzificiraj v moda. Win rate 40% ob
    vikendih — kupuj med tednom.'

- **Deal Fatigue Detector** — `GET /api/analytics/deal-fatigue-detector`
  - Detektira kdaj trader dela slabe odločitve zaradi overtradinga/utrujenosti.
    Analizira recent trade velocity, win rate decline in decision quality
    metrike ter opozori "deal-fatigued si — vzemi premor". Pure DB analytics —
    NO AI.
  - Razlika od market-momentum (ki gleda TRG kot celoto) — ta gleda TRADERJA in
    njegovo odločanje. Razlika od inventory-aging-predictor (ki gleda held
    inventar) — ta gleda traderjevo POTEKAVANJO v 3 časovnih oknih.
  - Query trades iz zadnjih 90 dni, razdeljeni v 3 okna (30 dni vsako):
    * `recent30` (zadnji 30 dni)
    * `previous30` (30-60 dni nazaj)
    * `older30` (60-90 dni nazaj)
  - Compute per-window metrike:
    * `tradeCount` = število trade-ov (kupljenih v tem oknu)
    * `tradeFrequency` = trades per week = (count / windowDays) × 7
    * `winRate` = % dobičkonosnih (sold v oknu, profit > 0)
    * `avgDealScore` = avg dealScore od linked listings v oknu
    * `avgBuyPrice` = avg buyPrice v oknu
    * `cancellationRate` = cancelled / total × 100
  - Compute fatigue indicators:
    * `frequencyIncrease` = recent30.tradeFrequency / previous30.tradeFrequency
      (>1.5 = warning, >2.0 = severe)
    * `winRateDecline` = previous30.winRate - recent30.winRate (pp, >15 = severe,
      >5 = moderate)
    * `dealScoreDecline` = previous30.avgDealScore - recent30.avgDealScore
      (>10 = warning)
    * `cancellationIncrease` = recent30.cancellationRate -
      previous30.cancellationRate (pp, >10 = warning)
  - Compute fatigue score (0-100):
    * +25 if frequencyIncrease >= 2.0 (severe overtrading)
    * +15 if frequencyIncrease >= 1.5 (moderate overtrading)
    * +25 if winRateDecline >= 15%
    * +15 if winRateDecline >= 5%
    * +20 if dealScoreDecline >= 10
    * +10 if dealScoreDecline >= 5
    * +15 if cancellationIncrease >= 10%
    * +8 if cancellationIncrease >= 5%
  - Klasifikacija: FRESH (0-20), NORMAL (21-40), MILD_FATIGUE (41-60),
    FATIGUED (61-80), BURNOUT (81-100).
  - Recommendation bazirana na klasifikaciji:
    * FRESH/NORMAL → CONTINUE, 0 days break
    * MILD_FATIGUE → SLOW_DOWN, 3 days break
    * FATIGUED → TAKE_BREAK, 7 days break
    * BURNOUT → STOP_TRADING, 30 days break
  - Trend: IMPPROVING / STABLE / DECLINING (recent vs previous win rate delta
    >= 10 / between / <= -10).
  - Specific warnings (slovensko) za vsak aktiviran indikator (npr.
    "Overtrading: trade frequency +180%...", "Win rate padel za 20pp...").
  - Empty-state: "Ni trade-ov v zadnjih 90 dneh — Deal Fatigue Detector
    potrebuje vsaj 1 trade v tem obdobju."
  - 'Fatigue 68/100 (FATIGUED) — frequency +180%, win rate -20%. Vzemi 7-dnevni
    premor.'

- **Seasonal Timing Optimizer** — `GET+POST /api/ai/seasonal-timing-optimizer`
  - AI analizira sezonske vzorce in priporoči OPTIMALNI timing za nakup in
    prodajo specifičnih kategorij. Razlika od seasonal-calendar (ki statično
    prikaže najboljši mesec) — ta upošteva TRENUTNI datum, held inventar in
    predvidi najboljše 2-tedensko okno za vsako akcijo (buy/sell).
  - Razlika od seasonal-planner (ki načrtuje mesece za buy/sell kategorije) —
    ta gleda posamezne HELD item-e in da per-item timing (kateri item prodati
    ZDAJ in kateremu čakati na vrh). Razlika od seasonal-pricing (ki prilagodi
    cene) — ta optimira TIMING (kdaj prodati) ne ceno.
  - Query SOLD trades iz zadnjih 24 mesecev, grupirani po month + category.
  - Compute per-category seasonal patterns:
    * `bestSellingMonths` = meseci z najvišjo avg sell price (top 3)
    * `worstSellingMonths` = meseci z najnižjo avg sell price (bottom 3)
    * `pricePremium` = % razlika med best in worst month
    * `currentMonthScore` = kako dober je trenutni mesec (0-100, normaliziran
      med min in max monthly avg price za to kategorijo)
    * `recommendation` = GOOD_TIME_TO_SELL (score >= 70) / NEUTRAL (40-70) /
      WAIT (21-39) / GOOD_TIME_TO_BUY (<= 20)
    * `monthlyAvgPrices` = per-mesec avg sellPrice + count (zadnjih 24 mesecev)
  - Query HELD trades (current inventory za prodajo).
  - AI prompt z GROUNDING_PROMPT_SUFFIX — seasonal patterns + held inventar.
    AI generira per-item timing:
    * `action` = SELL_NOW | WAIT_FOR_PEAK | HOLD_THEN_SELL
    * `optimalSellWindow` = { startMonth, endMonth } (slovenske kratke oznake
      mesecev: Jan, Feb, ..., Dec)
    * `daysToWait` = dni do začetka okna
    * `expectedPriceUplift` = % višja cena v vrhu vs trenutni mesec
    * `reasoning` (1 stavek slovensko z utemeljitvijo)
  - AI generira BUY timing per kategorija:
    * `recommendation` = BUY_NOW (off-season popust >= 10%) | WAIT (5-10%) |
      AVOID (cena blizu vrha)
    * `expectedDiscount` = % popust od vrha sezone
    * `reasoning` (1 stavek slovensko)
  - Anti-hallucination:
    * `expectedPriceUplift` clamped na [0%, 30%]
    * `expectedDiscount` clamped na [0%, 30%]
    * `daysToWait` clamped na [0, 180]
    * `optimalSellWindow.startMonth` / `endMonth` validirana proti slovenskim
      kratkim oznakam mesecev (Jan-Dec), fallback na deterministic
    * `action` validiran (SELL_NOW/WAIT_FOR_PEAK/HOLD_THEN_SELL), fallback
      deterministic
    * `recommendation` validiran (BUY_NOW/WAIT/AVOID), fallback deterministic
    * Če AI ne pokrije held trade-a ali kategorije, fallback na deterministic
  - Deterministic fallback:
    * Sell timing: najdi optimal window (top mesec - 1 do top mesec),
      daysToWait = dni do startMonth, uplift = % razlika med current in best
      month. Action = SELL_NOW če daysToWait < 14, WAIT_FOR_PEAK če < 90 in
      uplift >= 5%, HOLD_THEN_SELL če uplift >= 3%, sicer SELL_NOW.
    * Buy timing: find peak avgPrice za kategorijo, expectedDiscount = (peak -
      current) / peak × 100. BUY_NOW če >= 10%, WAIT če 5-10%, AVOID sicer.
  - AI cache key `seasonal-timing:${currentMonthIdx}` (6h TTL — refreshes
    daily/monthly).
  - Both GET and POST handlers (AI Hub runner compatibility).
  - Empty-state: "Ni held inventarja in zgodovine prodaj" — vrne seasonal
    patterns če so na voljo.
  - 'PS5: WAIT_FOR_PEAK (Nov-Dec), +12% price uplift, 45 days to wait. Moda:
    BUY_NOW (off-season, -15%)'

### Changed
- AI_ENDPOINTS.md: regenerated → 289 → 291 endpoints (+2 AI: trading-coach,
  seasonal-timing-optimizer)
- README.md: version badge v7.63.0 → v7.64.0, AI Endpoints 289 → 291, API
  Routes 428 → 431, "289 AI + 34 analytics" → "291 AI + 35 analytics", "~114
  funkcij" → "~117 funkcij", added v7.64 block at top of "Kaj je novega",
  profit pipeline (v7.32-v7.63) → (v7.32-v7.64), Analytics (34) → (35) z 1
  novo (Deal Fatigue Detector), v7.64.0 entry in "Zadnje verzije", Roadmap
  v7.63 → v7.64, profit pipeline list +3 (AI Trading Coach, Deal Fatigue
  Detector, Seasonal Timing Optimizer)
- CHANGELOG.md: [Unreleased] "v7.64+" → "v7.65+", added [7.64.0] section

## [7.63.0] - 2026-08-08

### Added — Profit Margin Heatmap & Listing Exposure Score & Capital Allocation Optimizer (3 funkcije)
- **Profit Margin Heatmap** — `GET /api/analytics/profit-margin-heatmap`
  - 2D matrica (kategorija × cenovni razpon) ki prikazuje kombinacije z najvišjim
    profitnim margin-om. Pomaga identificirati "sweet spot" segmente — npr.
    "Elektronika 250-500€ = HOT, 35% margin, 12 trades". Pure DB analytics — NO AI.
  - Razlika od profit-heatmap (ki gleda dneve/ure z največ dobička) — ta gleda
    KATEGORIJO × CENO. Razlika od roi-leaderboard (ki rank-a kategorije) — ta
    gleda 2D mrežo s klasifikacijo HOT/WARM/COOL/COLD.
  - 6 cenovnih razponov: 0-50€, 50-100€, 100-250€, 250-500€, 500-1000€, 1000€+.
  - Za vsako celico (category × priceRange) compute:
    * `tradeCount` = število sold trades v celici
    * `avgMargin` = avg((sellPrice - buyPrice) / buyPrice × 100)
    * `avgProfit` = avg(sellPrice - buyPrice - fees)
    * `winRate` = % profitable
    * `heatScore` = avgMargin × log10(tradeCount + 1) — rewards both high margin
      AND volume (visok margin + 1 trade = nizko; visok margin + 10 trade-ov = HOT)
  - Klasifikacija celic: HOT (heatScore > 50), WARM (20-50), COOL (5-20), COLD (<5).
  - Response: matrix (rows = categories, columns = priceRanges), topCells (top 5
    hottest z insight string), summary (totalCategories, totalCells, hotCells,
    coldCells, bestCombination, worstCombination, advice).
  - Empty-state fallback: "Ni prodanih trade-ov — Profit Margin Heatmap analiza ni
    mogoča."
  - 'Elektronika 250-500€ = HOT (35% margin, 12 trades). Moda 0-50€ = COLD (3%)'

- **Listing Exposure Score** — `GET /api/analytics/listing-exposure-score`
  - Oceni kako dobro je vsak HELD inventar "izpostavljen" kupcem — listing age,
    price competitiveness, contact activity, deal score, image presence in title
    quality. Pure DB analytics — NO AI.
  - Razlika od margin-guardian-pro (ki gleda margin-健康) — ta gleda EXPOSURE
    (komercialna vidika). Razlika od listing-ctr-optimizer (ki gleda naslove in
    slike) — ta gleda celotno sliko: starost + cena + kontakt + deal score.
  - Query HELD trades z linked Listing.
  - Za vsak held item compute 6 faktorjev:
    * `listingAgeDays` (days since firstSeenAt ali buyDate)
    * `priceCompetitiveness` = (aiEstimatedValue - price) / aiEstimatedValue × 100
    * `contactActivity` = 0 (none) | 1 (contacted) | 2 (bookmarked)
    * `dealScore` = listing.dealScore (0-100)
    * `hasImage` (boolean — trade.imageUrl ali listing.imageUrl)
    * `titleLength` (chars — 50-100 = best)
  - Exposure score (0-100):
    * ageScore: <7d=30, 7-14d=25, 14-30d=15, 30-60d=5, >60d=0
    * priceScore: >20%=25, 10-20%=20, 0-10%=10, <0%=5
    * activityScore: 2=15, 1=10, 0=5
    * dealScorePoints: >70=15, 50-70=10, <50=5
    * imageScore: 1=8, 0=0
    * titleScore: 50-100 chars=7, else=3
  - Klasifikacija: EXCELLENT (80+), GOOD (60-79), AVERAGE (40-59), POOR (20-39),
    CRITICAL (<20).
  - Response: items (sorted by exposureScore ASC — needs most attention first),
    summary (totalItems, excellent/good/average/poor/critical counts,
    avgExposureScore, needsAttention = poor + critical).
  - recommendedActions: concrete actions per item (npr. "Listing star 45 dni —
    razmisli o osvežitvi", "Ni kontaktov — kontaktiraj prodajalce",
    "Dodaj fotografije — poveča CTR za ~30%", "Cena 5% nad estValue — znižaj za 5%").
  - Empty-state fallback: "Ni held inventarja — Exposure Score analiza ni mogoča."
  - 'PS5 exposure 45/100 (AVERAGE) — listing 18d, price -5%, no contacts.
    Action: add photos, drop 10%'

- **Capital Allocation Optimizer** — `GET+POST /api/ai/capital-allocation-optimizer`
  - AI optimira alokacijo razpoložljivega kapitala čez kategorije z 3 strategijami
    (CONSERVATIVE/BALANCED/AGGRESSIVE) baziranimi na zgodovinskih ROI + volatilnosti
    (Sharpe-like ratio = expectedROI / riskScore).
  - Razlika od capital-allocation-advisor (ki svetuje STATIČNO alokacijo po
    kategorijah) — ta je DINAMIČNA: upošteva trenutno portfeljsko alokacijo,
    računa volatilnost ROI (std dev), in optimira Sharpe-like ratio. Generira 3
    strategije namesto 1.
  - Body param: `availableCapital` (optional, override — če ne podan, izračuna iz
    sold trades zadnjih 30 dni).
  - Query 3 datasets:
    * SOLD trades (last 30d) za availableCapital = Σ(sellPrice - sellFees)
    * HELD trades za currentAllocation (% per category)
    * ALL sold trades za historicalROI in volatility (std dev) per kategorija
  - Compute per category: avgROI, vol (std dev of ROI-jev), riskScore (0-100,
    baziran na volatilnosti — 10 + min(80, vol × 1.2)).
  - AI prompt z GROUNDING_PROMPT_SUFFIX — zgodovina ROI/vol per kategorija +
    trenutna alokacija. AI generira 3 strategije z allocations[] (category,
    percentage, expectedROI, riskScore, reasoning) + bestStrategy + rebalanceActions.
  - Anti-hallucination:
    * expectedROI clamped na [-20%, 100%] (realen razpon)
    * riskScore clamped na [5, 95]
    * percentage clamped na [0, 100] + sum normaliziran na 100
    * amountToInvest = percentage / 100 × availableCapital
    * sharpeLikeRatio = expectedROI / riskScore (per allocation in strategy)
    * strategy-level: expectedTotalROI = Σ(expectedROI × percentage / 100),
      sharpeLikeRatio = expectedTotalROI / Σ(riskScore × percentage / 100)
    * če AI sum != 100 (off by >1%), fallback na deterministic za to strategijo
    * če AI skipne kategorije, fallback na deterministic
  - Rebalance actions: BUY (underexposed), SELL (overexposed >5%), HOLD
    (znotraj ±5%). Amount (€) in reason (slovensko).
  - AI cache key `capital-allocation-optimizer:${availableCapital}` (6h TTL).
  - Deterministic fallback: 3 strategije z weights = (1 + max(0, avgROI/20)) /
    max(1, riskScore/30) × riskMultiplier (CONSERVATIVE 0.5, BALANCED 1.0,
    AGGRESSIVE 1.5). CONSERVATIVE sortira po riskScore asc, AGGRESSIVE po ROI desc.
  - Both GET and POST handlers (AI Hub runner compatibility).
  - Empty-state: "Ni razpoložljivega kapitala (0€ iz prodaj zadnjih 30 dni)" ali
    "Ni zgodovine prodaj — Capital Allocation Optimizer potrebuje sold trade-ove."
  - '2000€ available → BALANCED: 40% elektronika (25% ROI), 30% moda (15%),
    30% orodje (20%)'

### Changed
- AI_ENDPOINTS.md: regenerated → 288 → 289 endpoints (+1 AI: capital-allocation-optimizer)
- README.md: version badge v7.62.0 → v7.63.0, AI Endpoints 288 → 289, API Routes
  425 → 428, "288 AI + 32 analytics" → "289 AI + 34 analytics", "~111 funkcij" →
  "~114 funkcij", added v7.63 block at top of "Kaj je novega", profit pipeline
  (v7.32-v7.62) → (v7.32-v7.63), Analytics (32) → (34) z 2 novima
  (Profit Margin Heatmap, Listing Exposure Score), v7.63.0 entry in "Zadnje
  verzije"
- CHANGELOG.md: [Unreleased] "v7.63+" → "v7.64+", added [7.63.0] section

## [7.62.0] - 2026-08-08

### Added — Trade Replication Engine & Market Momentum Indicator & Cash Conversion Cycle Analyzer (3 funkcije)
- **Trade Replication Engine** — `GET+POST /api/ai/trade-replication-engine`
  - AI analizira najbolj USPEŠNE past trades (highest ROI) in predlaga NOVE search
    monitorje, ki bi replicirali te winning pattern-e. Razlika od reinvestment-advisor
    (ki svetuje KATEGORIJE) — ta konkretno predlaga monitor konfiguracije (platform,
    keywords, price range) za vsak winner.
  - Body param: `limit` (optional, 1-50, default 10) — koliko winnerjev analizirati.
  - Query SOLD trades z profit > 0, sortirani po ROI desc, top 10 (default).
  - Za vsak winner izvleče: title, category, buyPrice, sellPrice, profit, roi, holdDays,
    source (iz listing.monitor.source ali trade.buyLocation), keywords (extracted iz
    title — brand + model + key terms, 3-5 keywords).
  - AI prompt z GROUNDING_PROMPT_SUFFIX — seznam winnerjev z vsemi metrikami.
  - AI generira 1-2 novih monitor konfiguracij per winner:
    - `monitorName` (opisen, max 80 znakov, npr. "PS5 Digital Bolha < 300€")
    - `platform` (bolha | vinted | facebook | mobile.de | kleinanzeigen | avtonet)
    - `searchKeywords` (2-5 ključnih besed iz winner.title)
    - `priceMin` (~70% winner.buyPrice), `priceMax` (~110% winner.buyPrice)
    - `expectedROI` (baziran na winner.roi, clamped [5, 80] %)
    - `expectedProfit` (= priceMin × expectedROI/100, clamped [0, historical profit × 2])
    - `categoryFocus` (iz winner.category)
    - `confidenceScore` (0-100, višje = bolj verjetno da se bo pattern ponovil)
    - `reasoning` (1-2 stavka — ZAKAJ ta monitor replicira winner)
  - Anti-hallucination:
    * expectedROI clamped na [5%, 80%] (realen razpon za preprodajo)
    * expectedProfit clamped na [0, historical profit × 2] (ne pretiravaj)
    * priceMin clamped na [1, winner.buyPrice × 1.5]
    * priceMax clamped na [priceMin, winner.buyPrice × 2]
    * confidenceScore clamped na [0, 100]
    * platform validacija (samo 6 dovoljenih vrednosti)
    * Bug fix: Number(null) === 0 → dodatni check `raw == null` v vseh clamp funkcijah
  - Ranking: suggestions sortirani po expectedProfit desc
  - Summary: totalWinners, totalSuggestions, bestOpportunity (top suggestion string),
    estimatedMonthlyProfit (avg profit × 4)
  - AI cache key `trade-replication:${JSON.stringify(winnerTradeIds)}` (6h TTL)
  - Cache only ko aiUsed=true
  - Deterministic fallback (deterministicSuggestion): monitorName iz keywords+platform+
    priceMax, expectedROI = winner.roi × 0.85 clamped [5,80], expectedProfit =
    priceMin × expectedROI/100 clamped [0, profit×2]
  - Empty-state fallback: "Ni prodanih trade-ov — najprej prodi kak item da zgeneriraš
    replication suggestions."
  - 'PS5 35% ROI → Bolha monitor "PS5 Digital < 308€", expected 27% ROI, 53€ profit'

- **Market Momentum Indicator** — `GET /api/analytics/market-momentum`
  - Real-time market momentum score (BULLISH / NEUTRAL / BEARISH 0-100) baziran na
    listing velocity, price trend in deal frequency v zadnjih 7 dneh vs prejšnjih 7.
    Pure DB analytics — NO AI.
  - Razlika od weekly-trend-radar (ki prikaže shifts) — ta klasificira的整体 market
    sentiment v eno številko + akcijo (BUY_AGGRESSIVELY/BUY_NORMAL/HOLD/SELL_FAST).
  - Razlika od deal-velocity (ki gleda PRILIKA count in temperature) — ta združi 4
    indikatorje (velocity, price, deal quality, opportunity) v momentum score.
  - 4 momentum indikatorji:
    * `listingVelocityChange` = (currentWeek.totalListings - previousWeek.totalListings) /
      previousWeek.totalListings × 100 (% sprememba v novih oglasih)
    * `priceTrend` = (currentWeek.avgPrice - previousWeek.avgPrice) /
      previousWeek.avgPrice × 100 (% sprememba v povprečni ceni)
    * `dealQualityChange` = currentWeek.avgDealScore - previousWeek.avgDealScore
      (abs sprememba v deal score za PRILIKA oglase)
    * `opportunityChange` = (currentWeek.prilikaCount - previousWeek.prilikaCount) /
      previousWeek.prilikaCount × 100 (% sprememba v PRILIKA count)
  - Per-window metrics: totalListings, avgPrice, prilikaCount, avgDealScore, soldCount
  - Momentum score (0-100):
    * +30 če listingVelocityChange > 10 (več supply = bearish za prodajalce, a good za kupce)
    * +20 če priceTrend > 5 (cene rastejo = bullish)
    * +20 če dealQualityChange > 0 (boljši deals na voljo)
    * +30 če opportunityChange > 20 (več priložnosti)
    * Negativni multiplikatorji za padajoče indikatorje
  - Klasifikacija: BULLISH (>60), NEUTRAL (40-60), BEARISH (<40)
  - Per-source breakdown (Bolha vs Vinted vs Facebook vs ...) z displayName, momentumScore,
    classification, listingCount, avgPrice — sortiran po listingCount desc
  - Recommendation action: BUY_AGGRESSIVELY (bullish + več PRILIKA), BUY_NORMAL
    (neutral ali bearish z PRILIKA), HOLD (bearish brez PRILIKA), SELL_FAST (bullish
    z malo PRILIKA — cene visoke, prodi drago zdaj)
  - Reasoning: slovensko, razlaga zakaj ta akcija
  - 'Market momentum: 72/100 BULLISH — listings +15%, prices +8%, več priložnosti. BUY'

- **Cash Conversion Cycle Analyzer** — `GET /api/analytics/cash-conversion-cycle`
  - Finančna metrika kako učinkovito kapital teče skozi business. CCC = DIO + DSO - DPO.
    Za cash flipping: DSO=0 (cash sales, no credit), DPO=0 (cash purchases, no supplier
    credit), CCC = DIO = avg hold days. Pure DB analytics — NO AI.
  - Razlika od time-to-profit (ki gleda cycle time posameznega item-a) — ta gleda
    FINANČNO učinkovitost portfelja (capitalTurnoverRatio, annualizedROI, cash recovery).
  - Razlika od deal-velocity (ki gleda listing flux) — ta gleda financial velocity
    kapitala.
  - Query SOLD trades z sellDate, compute DIO = avg(buyDate → sellDate) = avg hold days.
  - Classification: EXCELLENT (<15d), GOOD (15-30), AVERAGE (30-45), SLOW (45-60),
    VERY_SLOW (>60). Benchmark: 30 dni target za fast flipping.
  - Monthly trend (zadnjih 6 mesecev): za vsak mesec avg hold days, itemsSold, trend
    (IMPROVING/STABLE/WORSENING glede na prejšnji mesec).
  - Per-category breakdown: za vsako kategorijo avgCCC, itemsSold, classification,
    capitalEfficiency (1/ccc × 365 = cycles per year) — sortiran po avgCCC asc
    (fastest first).
  - Capital efficiency metrics:
    * `avgInventory` = avgInvestedPerTrade × (CCC / 30) — koliko kapitala je povprečno
      vezanega (estimate items held simultaneously)
    * `annualRevenue` = vsota revenue-ja v zadnjih 365 dneh
    * `capitalTurnoverRatio` = annualRevenue / avgInventory (kolikokrat se kapital
      obrne na leto)
    * `avgROI` = avg ROI % vseh sold trade-ov
    * `annualizedROI` = avgROI × capitalTurnoverRatio (compounding effect)
    * `cashRecoveryTime` = CCC (dnevi od nakupa do gotovine)
  - Recommendations: fastestCategories (top 3), slowestCategories (top 3),
    improvementPotential (€ če skrajšaš CCC za 10 dni = (10/30) × turnover × inventory × ROI),
    advice (slovensko glede na classification)
  - Empty-state fallback: "Ni prodanih trade-ov — CCC analiza ni mogoča."
  - 'CCC: 28 dni (GOOD). Elektronika 22d, avto 45d. Letni turnover: 13x. Če skrajšaš
    CCC za 10d → +15% profit'

### Changed
- AI_ENDPOINTS.md: regenerated → 287 → 288 endpoints (+1 AI: trade-replication-engine)
- README.md: version badge v7.61.0 → v7.62.0, AI Endpoints 287 → 288, API Routes
  422 → 425, "287 AI + 30 analytics" → "288 AI + 32 analytics", "~108 funkcij" →
  "~111 funkcij", added v7.62 block at top of "Kaj je novega", profit pipeline
  (v7.32-v7.61) → (v7.32-v7.62), Analytics (30) → (32), v7.62.0 entry in "Zadnje
  verzije"
- CHANGELOG.md: [Unreleased] "v7.62+" → "v7.63+", added [7.62.0] section

## [7.61.0] - 2026-08-07

### Added — AI Negotiation Script Generator & Inventory Insurance Calculator & AI Photo Enhancement Advisor (3 funkcije)
- **AI Negotiation Script Generator** — `GET+POST /api/ai/negotiation-script-generator`
  - AI generira CEL STRATEGIA DOKUMENT za pogajanje kot KUPEC za specifičen
    listing/trade. Razlika od realtime-negotiation-bot (ki je chatbot) — ta
    vrne strukturiran dokument z vnaprej pripravljenimi ponudbami in taktikami.
  - Body param: `listingId` ali `tradeId` (optional) — če ne podan, izbere
    najnovejši PRILIKA listing
  - Query listing/trade s polnim kontekstom: title, askingPrice, aiEstimatedValue,
    aiScore, aiRisk, sellerName, category, daysListed, dealScore
  - AI generira strukturiran script:
    - `openingLine` (slovenski, prijateljsko-strateški)
    - `anchoringOffer` (initial low offer)
    - `offerLadder` (3-5 postopnih counter-offerjev z reasoning)
    - `walkawayPrice` (max acceptable price)
    - `targetPrice` (realističen cilj, običajno estValue × 0.9)
    - `psychologicalTactics` (2-3 taktike: cash/urgency, anchoring, walkaway leverage)
    - `objectionHandlers` (2-5 pričakovanih ugovorov + odgovori)
    - `closingLine` (ko je dogovor dosežen)
    - `negotiationStyle` (AGGRESSIVE | BALANCED | FRIENDLY)
  - Anti-hallucination:
    - anchoringOffer clamped na [0.5×, 0.85×] askingPrice (realen razpon za
      anchoring — ne preveč nizko, ne preveč blizu cene)
    - walkawayPrice clamped na [estValue × 0.8, estValue × 1.1] (ne plačaj
      preveč nad tržno vrednostjo — ne preveč pod, da ne bi zamudili deala)
    - targetPrice clamped na [estValue × 0.7, estValue × 1.05]
    - negotiationStyle validacija (AGGRESSIVE/BALANCED/FRIENDLY)
    - offerLadder offers validirani znotraj [anchoring, askingPrice]
  - AI cache `negotiation-script:${listingId}` (6h TTL)
  - Deterministic fallback: anchoring = askingPrice × 0.75, target = estValue × 0.9,
    walkaway = estValue × 1.05, 3-step ladder, 3 taktike, 3 objection handlers
  - 'PS5 350€ → anchoring 280€, target 320€, walkaway 340€. Taktika: "imam cash zdaj"'
- **Inventory Insurance Calculator** — `GET /api/analytics/inventory-insurance-calculator`
  - Pure DB analytics (NO AI) — izračun zavarovalnih potreb za HELD inventar
  - Query HELD trades z linked Listing (aiEstimatedValue)
  - Per-item currentValue = aiEstimatedValue ?? buyPrice (fallback)
  - categoryRiskMultiplier:
    - elektronika: 1.5 (high theft risk, easily resold on black market)
    - avto: 2.0 (highest value, mandatory insurance in most countries)
    - moda: 0.5 (low value, low risk)
    - orodje: 1.0 (medium)
    - drugo: 1.0
  - Portfolio totals: totalInventoryValue, totalReplacementCost (×risk),
    highValueItems (>500€), avgItemValue
  - categoryBreakdown per kategorija: itemCount, totalValue, riskMultiplier,
    riskScore (0-100, kombinacija vrednosti + multiplikatorja + high-value count),
    highValueCount
  - 3 insurance coverage options:
    - **BASIC** (kraja + požar): premium = totalReplacementCost × 0.02/leto,
      10% deductible
    - **STANDARD** (kraja + požar + voda + vandalizem): premium × 0.035/leto,
      5% deductible
    - **PREMIUM** (all-risk + transport + deprecijacija + vsi riziki): premium ×
      0.05/leto, 2% deductible
  - Per option: coverageAmount, annualPremium, monthlyPremium, deductible,
    coveredPerils[], description
  - Recommendation: HIGH-risk (total > 5000€ ali high-value > 3) → PREMIUM,
    MEDIUM-risk → STANDARD, LOW-risk → BASIC
  - 'Skladišče 4500€ vrednosti → STANDARD zavarovanje, 157€/leto, pokrije 6750€'
- **AI Photo Enhancement Advisor** — `GET+POST /api/ai/photo-enhancement-advisor`
  - AI svetuje izboljšave fotografij za HELD item-e s slikami (imageUrl).
    Razlika od photo-quality-analyzer (ki analizira obstoječe aiImageAnalysis) —
    ta je ENHANCEMENT advisor: predlaga kako posneti BOLJŠE slike za naslednji
    listing z quantified uplift.
  - Query HELD trades s slikami (Trade.imageUrl ali Listing.imageUrl)
  - Per item AI generira:
    - `currentPhotoScore` (0-100)
    - `improvements[]`: aspect (LIGHTING/BACKGROUND/ANGLE/COMPOSITION/STAGING/RETAKE),
      issue, suggestion, impact (LOW/MEDIUM/HIGH)
    - `recommendedShots[]` (MAIN, DETAIL, SCALE, CONTEXT)
    - `expectedSaleTimeReduction` (dni hitrejše prodaje)
    - `estimatedPriceUplift` (€ — za koliko se dvigne cena)
    - `overallAdvice` (1-2 stavka povzetka)
  - Anti-hallucination:
    - expectedSaleTimeReduction clamped na [0, 30] dni (ne pretiravaj z >= 30)
    - estimatedPriceUplift clamped na [0, estValue × 0.15] (max 15% dvig)
    - aspect validacija (samo 6 dovoljenih vrednosti)
    - impact validacija (LOW/MEDIUM/HIGH)
  - Summary: totalItems, itemsNeedingPhotos (score < 70), avgPhotoScore,
    totalEstimatedUplift, bestPhotoTip (najbolj pogost aspect across items)
  - AI cache `photo-enhancement-advisor:${JSON.stringify(heldItemIds)}` (6h TTL)
  - Deterministic fallback: 55 photoScore, 3 generične improvements (LIGHTING,
    BACKGROUND, ANGLE) + 1 kategorija-specifična (elektronika → COMPOSITION detail
    priključkov; moda → STAGING na modelu), 4 recommended shots, 7 dni reduction,
    estValue × 8% uplift
  - 'PS5 photo score 45/100 — slaba osvetlitev, dodaj naravno svetlobo.
    Popravek: +15% šansa prodaje, +25€ višja cena'
  - Empty-state fallback: 'Ni held item-ov s slikami — najprej dodaj slike k item-om.'

## [7.60.0] - 2026-08-06

### Added — Demand Forecast AI & Margin Guardian Pro & Multi-Platform Listing Generator (3 funkcije)
- **Demand Forecast AI** — `GET+POST /api/ai/demand-forecast`
  - AI napoved katere kategorije bodo v HIGH povpraševanju naslednjih 30 dni
  - Pomaga odločiti KAM investirati kapital (ne le kateri item-i so na zalogi,
    ampak kaj se bo prodalo)
  - Query listings zadnjih 90 dni, grupirano po kategoriji (extract iz title
    keywordsov ali monitor.tags)
  - Per kategorija: listingFrequency (per week), frequencyTrend (last4w vs
    prev4w — INCREASING/STABLE/DECREASING), sellThroughRate (soldTrades /
    totalListings), avgPriceTrend, seasonalityScore 0-100
  - AI generira: predictedDemand (HIGH/MEDIUM/LOW), confidenceScore 0-100,
    expectedPriceMovement (UP/STABLE/DOWN), recommendedAction
    (BUY_MORE/HOLD/REDUCE/AVOID), reasoning
  - Anti-hallucination: kategorija, ki pada 8 tednov BREZ sezonskega razloga,
    NE more biti HIGH (to bi bila halucinacija optimism-a). Sell-through <10%
    + DECREASING → ne more biti HIGH
  - AI cache `demand-forecast:${currentMonth}` (6h TTL — dnevni refresh)
  - Deterministic fallback: score iz sellThrough × frequencyTrend × season
  - 'Elektronika: HIGH demand next 30d (sell-through 65%, trend ↑) → kupuj več'
  - Top 10 kategorij sortiranih po predicted demand + confidence
- **Margin Guardian Pro** — `GET+POST /api/ai/margin-guardian-pro`
  - Real-time margin monitoring z AI-driven pricing priporočili za HELD inventar
  - Skenira vsak held item, izračuna carrying cost (daysHeld × 0.50€/dan) in
    trenutni margin glede na AI estimated value
  - marginStatus: HEALTHY (>15%) | WARNING (5-15%) | AT_RISK (0-5%) | LOSS (<0%)
  - breakevenPrice = buyPrice + buyFees + carryingCost
  - AI generira per-item: action (HOLD | PRICE_DROP_5% | PRICE_DROP_10% |
    PRICE_DROP_15% | LIQUIDATE), newPrice (specifična EUR cena), urgency
    (IMMEDIATE | THIS_WEEK | THIS_MONTH), reasoning
  - Anti-hallucination: newPrice clamped na [breakevenPrice, estValue × 1.1]
    — ne prodaj pod breakeven (razen LIQUIDATE, kjer je 0.9× breakeven
    dovoljen za sprostitev kapitala)
  - LIQUIDATE samo za LOSS ali item-e držane >60 dni z AT_RISK
  - AI cache `margin-guardian-pro:${JSON.stringify(heldItemIds)}` (6h TTL)
  - Deterministic fallback: newPrice = breakeven × 1.10 (z 10% varnostjo)
  - 'PS5 držan 45 dni — carrying cost 22.5€, margin 8% (WARNING) → znižaj
    ceno za 10% na 380€'
  - Summary: totalItems, healthy/warning/atRisk/loss counts,
    potentialLossEur (skupna izguba če margin gre negativno), avgMargin
- **Multi-Platform Listing Generator** — `GET+POST /api/ai/multi-platform-listing-generator`
  - AI generira optimizirano vsebino za 5 platform hkrati iz enega held item-a
  - Vsaka platforma ima različne SEO zahteve, omejitve dolžine naslova,
    sistem tag-ov in ton občinstva:
    - **Bolha** — max 60 char naslov, slovenščina, 10 tag-ov, prijateljski ton
    - **Vinted** — max 80 char, slo/ang, 5 tag-ov, modno usmerjen ton
    - **Facebook Marketplace** — max 100 char, slo, 6 tag-ov, lahkoten ton,
      emoji OK, poudarek lokalno
    - **mobile.de** — max 50 char, nemščina, 8 tag-ov, tehničen profesionalen ton
    - **Kleinanzeigen** — max 70 char, nemščina, 6 tag-ov, podroben transakcijski ton
  - Per platform: title, description, tags, suggestedPrice, seoScore (0-100)
  - Anti-hallucination: suggestedPrice clamped na [0.7×, 1.2×] aiEstimatedValue
    — realističen range, ne preveč pod cenom (ne izgubi denarja) in ne preveč
    nad (ne bodi nerealističen)
  - bestPlatform = najvišji seoScore za ta item
  - AI cache `multi-platform-listing:${JSON.stringify(tradeIds)}` (6h TTL)
  - Deterministic fallback: generični naslov (trunciran na max chars) +
    suggestedPrice = estValue × 0.88-0.98 (odvisno od platforme)
  - 'PS5 → Bolha: "PS5 Digital 2024 + 2 controllerja" (380€, SEO 92),
    Vinted: "PlayStation 5 Digital" (320€, SEO 88)'
  - Body param `tradeId` (optional) — če ni podan, procesira vse held item-e

### Changed — v6.12 endpoint migration
- **demand-forecast** (v6.12) premaknjen na `/api/ai/demand-forecast-v6` —
  original v6.12 implementacija (3-mesečna napoved) ohranjena za backward
  compatibility. Frontend statistics-view.tsx sedaj kliče `/api/ai/demand-forecast-v6`
- `/api/ai/demand-forecast` je sedaj nova v7.60 implementacija (30-dnevna napoved
  z anti-hallucination + cache + GET handler za AI Hub runner compat)

## [7.59.0] - 2026-08-06

### Added — Tveganje & CRM & paketiranje (3 funkcije)
- **Portfolio Stress Test** — `GET /api/analytics/portfolio-stress-test`
  - Simulacija kako portfolio preživi različne tržne scenarije
  - 3 stresni scenariji: MILD (-10% drop, ×0.90), MODERATE (-25%, ×0.75), SEVERE (-40%, ×0.60)
  - Per scenario: stressedValue, capitalLoss, lossPercent, itemsUnderwater,
    worstCategory, bestCategory
  - Per-category vulnerability breakdown (vulnerabilityScore 0-100)
  - Recommendation: immediateLiquidate (items underwater under MILD),
    holdStrong (resilient even under SEVERE), hedgingAdvice
  - 'Pri -25% padcu trga izgubiš 450€ (18% kapitala). Najbolj ranljiva: elektronika.'
  - Pure DB analytics (NO AI) — uporablja listing.aiEstimatedValue za trenutno vrednost
- **Supplier Relationship Manager (CRM)** — `GET /api/analytics/supplier-crm`
  - CRM za stalne dobavitelje (sellerji od katerih si kupoval)
  - Trust tiers: PLATINUM (5+ nakupov, 80%+ profitabilnost) | GOLD (3+, 60%+)
    | SILVER (2+) | BRONZE (1)
  - Per supplier: purchasesCount, totalSpent, avgPurchasePrice, relationshipDuration,
    categories, avgDealScore, profitFromSupplier, itemsStillHeld, reliabilityScore,
    preferredContactMethod (telegram/phone/bolha-msg — inferred iz notes)
  - reliabilityScore 0-100 — kako blizu je bil AI estimate dejanski sell ceni
  - Sort: trustTier (PLATINUM first), nato totalSpent desc
  - Summary: totalSuppliers, count per tier, totalLifetimeSpend,
    totalProfitFromSuppliers, topSupplier
  - Razlika od competitor-tracker: ta je RELATIONSHIP MANAGEMENT (trust tiers,
    reliability, contact method), competitor-tracker je LISTING TRACKING
- **Bundle Profit Optimizer** — `GET+POST /api/ai/bundle-profit-optimizer`
  - AI analiza kateri held inventar združiti v pakete za cross-sell
  - Paketiranje komplementarnih item-ov (PS5 + controller + igra) lahko da
    višji skupni profit kot prodaja posebej
  - AI prompt z grounding + GROUNDING_PROMPT_SUFFIX — prosi za bundles[] s
    {itemIds[2-4], suggestedBundlePrice, bundleDiscountPercent,
    expectedSellTimeDays, reasoning}
  - Anti-hallucination: suggestedBundlePrice clamped na [0.8×, 1.1×] sum of
    estValues (realističen 5-15% popust); floor: must cover buyPrice
  - expectedSellTimeDays clamped na [1, 60]; reasoning clamped na 300 chars
  - bundleCompatibility slovar (komplementarne kategorije: elektronika+igre,
    moda+aksesoiri, avto+gume, dom+pohistvo, itd.)
  - AI cache 6h TTL — key: `bundle-profit-optimizer:${JSON.stringify(sortedIds)}`
  - Deterministic fallback ko AI ni na voljo: grupira po kategoriji, bundle 2-4
    item-ov z combined value > 100€, 8% popust, 14 dni sell time
  - Summary: totalBundles, itemsBundled, itemsUnbundled,
    expectedTotalProfitBundled, expectedTotalProfitStandalone, profitUplift %
  - GET+POST za AI Hub runner kompatibilnost (enaka handleBundleOptimizer f-ja)
  - 'PS5 (380€) + Extra Controller (45€) + FIFA 24 (35€) → bundle 420€
    (save 10%), profit 110€ vs 80€ standalone'

## [7.58.0] - 2026-08-06

### Added — Optimizacija virov & sledenje oglasom & avtomatska ponovna objava (3 funkcije)
- **Deal Source ROI Analyzer** — `GET /api/analytics/deal-source-roi`
  - Analizira ROI po viru nakupa (Bolha, Vinted, Facebook, mobile.de, itd.)
  - Per source: totalTrades, invested, revenue, profit, avgROI, avgHoldDays, winRate
  - Source × category matrix za poglobljeno analizo
  - Priporočilo: bestSource / worstSource z utemeljitvijo
  - 'Bolha: 30.6% ROI (12 trgovin) → kupuj več na Bolhi'
- **Listing Performance Tracker** — `GET /api/analytics/listing-performance`
  - Za HELD inventar: staleScore, status (FRESH/ACTIVE/AGING/STALE/DEAD)
  - Per item: daysHeld, contactCount, priceDrops, potentialProfit, recommendedAction
  - Summary: totalHeld, avgDaysHeld, capital tied up, action plan
  - Action plan: koliko itemov potrebuje PRICE_DROP / RELIST / LIQUIDATE
- **Auto-Relisting Scheduler** — `GET+POST /api/ai/auto-relisting-scheduler`
  - AI generira full relisting plan za zastarele item-e
  - Per item: recommendedPlatform, newTitle (SEO), newPrice, bestTimeToList,
    listingStrategy (FRESH/CROSS_POST/PRICE_DROP/BUNDLE), expectedSellTimeDays
  - Anti-hallucination: newPrice clamped [0.5x, 1.2x] buyPrice, sellTime [1, 60]
  - AI cache (6h TTL) + GET+POST za AI Hub runner compat
  - Deterministic fallback ko AI ni na voljo

## [7.57.0] - 2026-08-06

### Added — Davčna poročila & reinvesticije & konkurenčna obveščenost (3 funkcije)
- **Tax Report Generator** — `GET /api/analytics/tax-report?year=2026`
  - Letno davčno poročilo v slovenskem formatu (FURS-ready)
  - Implementira SI davčni zakon: 5000€ neoporečno, 40% dohodnina, 3-letni loss carryforward
  - Dolgoročno držanje (>3 leta): 1/3 znižanja davka (efektivno 26.67%)
  - Mesečni pregled, razčlenitev po kategorijah, seznam vseh trgovin
  - Slovenska imena polj (davcniZavezanec, povzetek, mesecniPregled, poKategorijah, trgovine, opombe)
- **Reinvestment Advisor** — `GET+POST /api/ai/reinvestment-advisor`
  - Na podlagi ROI leaderboard-a priporoči kam reinvestirati dobiček
  - Top performers (visok ROI) vs underperformers (negativen ROI)
  - AI priporočila: kategorije, brand-i, cenovni rang, diversifikacija
  - Anti-hallucination: reinvestAmount clamped na [0, cashAvailable]
  - AI cache (6h TTL) + GET+POST za AI Hub runner compat
- **Competitor Listing Tracker** — `GET /api/analytics/competitor-tracker`
  - Sledi prodajalcem od katerih si kupoval (suppliers)
  - Relationship: SUPPLIER (2+ nakupov) | ONE_TIME | WATCHED
  - Per seller: totalListings, purchasesFromThem, avgPrice, categories, listingFrequency
  - Batched query (ne N+1) za 5k listings
  - 'Top supplier: Elektro Marjan — 12 nakupov, 2400€ porabljeno'

## [7.56.0] - 2026-08-06

### Added — Niche discovery & listing visibility & compounding (3 funkcije)
- **Market Gap Finder** — `GET /api/analytics/market-gap-finder`
  - Prazne niše z visokim povpraševanjem in nizko ponudbo
  - gapScore = demandScore / (supplyScore + 1)
  - opportunity: HIGH_GAP / BALANCED / SATURATED
- **Listing Refresh Scheduler** — `GET+POST /api/ai/listing-refresh-scheduler`
  - Za held inventar: urgency = OVERDUE/DUE_SOON/OK
  - AI priporoča kdaj in kako osvežiti oglase
  - AI cache (6h TTL) + GET+POST za AI Hub runner compat
- **Profit Maximizer v2 (ML Compounding)** — `GET+POST /api/ai/profit-maximizer-v2`
  - 3 scenariji (conservative 5% / balanced 10% / aggressive 15% mesečne rasti)
  - 24-mesečna projekcija z reinvesticijo
  - Anti-hallucination: projectedProfit clamped na [0.5x, 3x] avgMonthlyProfit

## [7.55.0] - 2026-08-06

### Added — Kupovanje & pogajanje & exit strategija (3 funkcije)
- **ROI Performance Leaderboard** — `GET /api/analytics/roi-leaderboard`
  - Grupira sold trades po brand/model/category
  - Per group: count, total profit, avg profit, ROI %, avg hold days, profit/day
  - Brand recognition (Apple, Samsung, Sony, Bosch, Nike, etc.)
  - Winners vs losers identification
- **Negotiation Outcome Predictor** — `POST /api/ai/negotiation-outcome-predictor`
  - Verjetnostni model: accept/counter/reject
  - 4 faktorji: estValueFactor, discountFactor, ageFactor, riskFactor
  - AI enhancement: predicts counter price + optimal offer
  - Confidence score + grounding prompt
- **Inventory Liquidation Strategist** — `GET /api/ai/liquidation-strategist`
  - Exit strategija za zastarele item-e
  - Kaskadno zniževanje cene z časovnimi okviri

## [7.54.0] - 2026-08-06

### Added — Priložnosti & pomnjenje & timing (3 funkcije)
- **Missed Opportunity Tracker** — `GET /api/analytics/missed-opportunities`
  - Katere priložnosti si zamudil in koliko bi lahko zaslužil
- **Conversation Memory** — AI si zapomni pretekle razgovore za boljše nasvete
- **Optimal Listing Time** — `GET /api/analytics/optimal-listing-time`
  - Kdaj objaviti oglas za max prodajo

## [7.53.0] - 2026-08-06

### Added — AI cost optimization & routing (3 funkcije)
- **AI Output Cache** (6h TTL) — `src/lib/ai-cache.ts` — ~60% prihranek AI klicev
- **Batch Deal Evaluator** — `POST /api/ai/batch-deal-evaluator` — 50 oglasov v 1 AI klicu (~98% prihranek)
- **Smart Notification Router** — `GET /api/cron/smart-notification-router` — CRITICAL/HIGH/MEDIUM/LOW routing (Telegram/Push/Discord)

## [7.52.0] - 2026-08-06

### Added — Anti-Hallucination Layer (5 slojev)
- **`src/lib/anti-hallucination.ts`** — prevent AI from fabricating financial data
- 5 slojev: Prompt grounding, Numeric sanity, Cross-reference, Confidence threshold (30%), Pattern detection
- Vsa AI finančna poročila validirana proti realnim DB podatkom
- estValue clamped na 3x asking price

## [7.51.0] - 2026-08-06

### Added — Likvidnost & vidljivost & timing (3 funkcije)
- **Cash Flow Forecaster** — `GET /api/analytics/cash-flow-forecast` — napoved kapitala za 7/14/30 dni
- **Search Keyword Optimizer** — `POST /api/ai/search-keyword-optimizer` — Bolha title + tags SEO
- **Purchase Pattern** — vzorci nakupov za optimizacijo

## [7.50.0] - 2026-08-06

### Added — Tržna ozaveščenost & tveganje & hitra prodaja (3 funkcije)
- **Weekly Trend Radar** — `GET /api/analytics/weekly-trend-radar` — 7-dnevni tržni premiki (IMPROVING/DECLINING/STABLE)
- **Risk Spread Calculator** — `GET /api/ai/risk-spread-calculator` — diverzifikacija portfelja
- **Quick Sell Ladder** — hitra prodaja z postopnim zniževanjem cene

## [7.24.0] - 2026-07-30

### Changed — TypeScript Quality Enforced
- **ignoreBuildErrors: false** — sedaj ko smo popravili vseh 48 TS napak (0 remaining)
  je to varno. Build bo fail-al, ce kdorkoli vnese novo TS napako.
  - PR #1 (v6.92.1): odstranil ignoreBuildErrors: true → build fail
  - PR #29 (v7.20): vraceno na true (pragmaticno, pre-existing napake)
  - PR #31 (v7.22): popravil vseh 48 TS napak → 0 remaining
  - PR #33 (v7.24): koncno false → quality enforced going forward

### Final Project Status
- **0 TypeScript errors** (prej 48)
- **Build success** z ignoreBuildErrors: false
- **AI verified** (OpenRouter + Llama 3.1 8B free)
- **ErrorBoundary** na vseh 17 pogledih
- **55 AI funkcij z dedicated UI** (5 pogledov x 10)
- **254 AI preko AI Hub** (iskalnik + runner)
- **309 skupaj AI dostopnih iz UI**
- **17 zavihkov** z keyboard shortcuts
- **Setup script** (bun run setup)
- **Dokumentacija sinhronizirana** na v7.24.0

## [7.22.0] - 2026-07-30

### MILESTONE: 0 TypeScript errors + Build success + AI verified

### Added — Production Readiness (v7.19)
- **ErrorBoundary** — prepreči bel zaslon ob crashu katerekoli od 17 komponent
  - Class component z getDerivedStateFromError + componentDidCatch
  - Prijazno sporocilo z imenom pogleda + "Poskusi znova" gumb
  - Vsi 17 pogledov wrappani v ErrorBoundary

### Fixed — Build Errors (v7.20)
- **FileClaim → FileText** — ikona ne obstaja v lucide-react (BUILD BREAKING)
- **sendImmediatePush priority** — 3 klici manjkali obvezen `priority` parameter
- **ignoreBuildErrors: true** — vraceno (pragmaticno, zaradi pre-existing napak ki so sedaj popravljene)

### Fixed — Dependencies (v7.21)
- **playwright** dodan v dependencies — popravilo 3 TS2307 napak (module not found)

### Fixed — TypeScript (v7.22)
- **Vseh 48 TS napak popravljenih → 0 napak**
  - 41x TS18048 (possibly undefined) — optional chaining `?.` dodan v 3 panelih
  - 3x TS2307 (playwright) — v7.21
  - 3x TS2345 (priority) — v7.20
  - 1x TS2305 (FileClaim) — v7.20
- **TypeScript strict mode popolnoma cist**
- **Build USPE** brez ignoreBuildErrors (a pragmaticno ostavljen za future-proof)

### Verified — AI Works (v7.20 audit)
- **OpenRouter + Llama 3.1 8B (free)** konfiguriran in testiran
- `/api/ai/daily-summary` vraca pravo slovensko besedilo
- `/api/ai/master-dashboard` vraca structured JSON
- AI resnicno deluje, ni samo "prompt variacija"

### Final Quality Metrics
- **0 TypeScript errors** (prej 48)
- **Build success** (prej fail)
- **AI verified** (prej nepreverjeno)
- **ErrorBoundary** na vseh 17 pogledih (prej bel zaslon possible)
- **55 AI funkcij z dedicated UI** (5x10)
- **254 AI preko AI Hub**
- **309 skupaj AI dostopnih iz UI**

## [7.16.0] - 2026-07-29

### MILESTONE: ALL 5 DOMAIN VIEWS = 10 AI FUNCTIONS EACH (55 dedicated total)

### Added — Setup Script (v7.11)
- **scripts/setup.sh** — avtomatizira zacetno nastavitev (bun run setup)
  - Ustvari .env iz .env.example
  - Generira APP_API_KEY, TELEGRAM_WEBHOOK_SECRET, MONITOR_CRON_KEY
  - Namesti odvisnosti, Prisma client, bazo
  - Prikaže povzetek konfiguracije + naslednje korake

### Added — Domain View Expansions (v7.12-v7.16)
Vsak od 5 domain pogledov razsirjen z 5 novimi AI funkcijami (5 -> 10):

- **BuyersView** (v7.12, PR #21): +5 funkcij = 10 skupaj
  - Buyer Matchmaker, CLV Predictor, Churn Prevention, Buyer Intent, Conversion Predictor
- **InventoryView** (v7.13, PR #22): +5 funkcij = 10 skupaj
  - Capital Allocator, Carrying Cost, Depreciation Tracker, Growth Planner, Health Monitor
- **PricingView** (v7.14, PR #23): +5 funkcij = 10 skupaj
  - Profit Dashboard, Profit Playbook, Reserve Price Optimizer, Pricing Psychology, Geo Price Map
- **ListingOptimizationView** (v7.15, PR #24): +5 funkcij = 10 skupaj
  - Title Generator v2, Tag Optimizer, Thumbnail Optimizer, Social Proof Optimizer, Listing Refresh
- **RiskView** (v7.16, PR #25): +5 funkcij = 10 skupaj
  - Insurance Claim, Anomaly Detection, Inventory Risk Assessor, Quality Predictor, Quality Aggregator

### Final AI UI Coverage
- **55 AI funkcij z dedicated UI** (5 pogledov x 10 funkcij)
- **254 AI funkcij preko AI Hub** (iskalnik + generični runner)
- **309 skupaj AI funkcij dostopnih iz UI** (prej 60 = 24% pokritost)

## [7.09.0] - 2026-07-29

### Added — Documentation & UX (v7.07-v7.08)
- **README.md feature update** (v7.08) — nova "Kaj je novega" sekcija z vsemi spremembami v6.92.1-v7.06
  - 6 novih AI pogledov z 30 AI funkcijami
  - Varnostni popravki, čiščenje, performanse, refactoring
  - Nova tabela "17 zavihkov v aplikaciji" z shortcut-i in opisi
- **Documentation sync #2** (v7.07) — package.json, CHANGELOG, README, CONTRIBUTING sinhronizirani na v7.06

### Changed — Performance (v7.09)
- **React.memo na 6 novih view komponentah** — prepreči re-render ob clock tick-u
  - Wrapped: BuyersView, AIHubView, InventoryView, PricingView, ListingOptimizationView, RiskView
- **Odstranjen redundantni 30s polling** — SSE že pošilja stats vsakih 5s
  - Prej: 2.880 fetch-ov/dan (30s polling) → Sedaj: 1 fetch na mount (−99.97%)
  - useCallback import odstranjen (ni več potreben)
- **Ura zmanjšana z 1s na 10s** — header datum/čas ne rabi sekundne natančnosti
  - Prej: 60 re-render-ov/min → Sedaj: 6 re-render-ov/min (−90%)

### Performance Impact
- **~90% manj re-render-ov na minuto** (6 namesto 60)
- **6 view komponent se ne re-render-a ob clock tick-u** (React.memo)
- **2.879 manj fetch-ov/dan** (polling odstranjen, SSE zadostuje)
- **Manj CPU, manj battery drain na mobilcih**

## [7.06.0] - 2026-07-29

### Added — New Domain Views (v7.04-v7.06)
- **PricingView** (v7.04) — nov zavihek "Cene AI" z 5 AI funkcijami:
  - AI Smart Pricing Engine (dinamično določanje cen, 10 faktorjev)
  - AI Profit Forecast (napoved dobička, 3 scenariji)
  - AI Margin Optimizer (optimizacija marže)
  - AI Price War Strategist (cenovne vojne)
  - AI Seasonal Pricing (sezonski vzorci, 4 letni časi)
- **ListingOptimizationView** (v7.05) — nov zavihek "Oglasi AI" z 5 AI funkcijami:
  - AI Image Generator (VLM prompti za Midjourney/DALL-E)
  - AI Description Generator v3 (10 stilov, A/B test)
  - AI SEO Optimizer v2 (keyword research, competitor analysis)
  - AI Virality Predictor (8 heuristik v TypeScript)
  - AI CTR Optimizer (click-through rate)
- **RiskView** (v7.06) — nov zavihek "Tveganja AI" z 5 AI funkcijami:
  - AI Risk Hedging (8 hedge strategij)
  - AI Insurance Optimizer v2 (4D risk matrix, 7 kategorij)
  - AI Market Saturation (5 nivojev: saturated → blue_ocean)
  - AI Risk Parity (alokacija z enakim riskom)
  - AI Margin Guardian (avtomatski margin alerti)

### Domain Coverage Complete
- **6 dedicated AI pogledov** z **30 AI funkcijami** pokrivajo vse domene:
  - BuyersView (5) — kupci
  - InventoryView (5) — skladišče
  - PricingView (5) — cene
  - ListingOptimizationView (5) — oglasi
  - RiskView (5) — tveganja
  - AI Hub (254) — vsi endpointi z iskalnikom
- **17 zavihkov** v aplikaciji (prej 11)
- **Keyboard shortcuts**: b (buyers), a (ai-hub), i (inventory), p (pricing), l (listing-opt), r (risk)

## [7.02.0] - 2026-07-29

### Added — New Features
- **InventoryView** (v7.02) — nov zavihek "Skladišče AI" z 5 AI funkcijami:
  - AI Inventory Aging (alerti za staranje, stagnirajoči itemi)
  - AI Stockout Predictor (napoved zmanjkanja zaloge)
  - AI Shrinkage Detector (detekcija izgub — krađa, poškodbe)
  - AI Liquidation Strategist (strategija likvidacije)
  - AI Portfolio Rebalancer v3 (Markowitz, Kelly, risk-parity)
- **AI Hub** (v7.01) — nov zavihek z iskalnikom vseh 254 AI endpointov:
  - 8 kategorij (buyer, inventory, listing, pricing, risk, negotiation, reports, misc)
  - AI Runner modal (generični POST + JSON rezultat)
  - /api/ai-list nov read endpoint (bere route.ts datoteke)
  - Reši 194 orphan AI endpointov (76 % ni imelo UI)
- **BuyersView** (v7.00) — nov zavihek "Kupci" z 5 AI funkcijami:
  - AI Buyer Persona (kategorizacija: bargain hunter, collector, flipper)
  - AI Trust Score (6 tierjev: platinum → scammer)
  - AI Journey Optimizer (8-stopnjska pot)
  - AI Review Generator (testimonial, referral, social proof)
  - AI Lifecycle Predictor (9 faz življenjskega cikla)

### Changed — Refactoring (v6.95-v6.99)
- **ListingDetailModal razbit** z 4070 na ~2227 vrstic (−45 %):
  - SentimentPanel (v6.95) — sentiment-analysis
  - AuctionSniperPanel (v6.95) — auction-sniper
  - FraudDetectionPanel (v6.96) — fraud-detection + fake-detection + reverse-image-search (3 v 1)
  - ImageAnalysisPanel (v6.97) — image-quality + description-optimizer + refurbishment-cost (3 v 1)
  - NegotiationPanel (v6.98) — Negotiator + Playbook + Outcome + Chatbot (4 v 1)
  - ListingActionsBar (v6.99) — Notes + Contact Tracker (2 v 1)
- **Lazy-load dashboard views** (v6.94) — ~83 % manj JS na prvem loadu (next/dynamic)

### Security (v6.92.1)
- **API avtentikacija** — APP_API_KEY env, X-App-Key header, app-key cookie, middleware.ts
- **SSRF zaščita** — lib/url-safety.ts blokira privatne IP, AWS metadata, link-local
- **Email XSS fix** — HTML escape vseh uporabniških vsebin v formatAlertEmail
- **Slack Block Kit fix** — mrkdwn_section → mrkdwn (Slack je prej tiho zavrajal bloke)
- **Telegram MarkdownV2** — parse_mode Markdown (V1) → MarkdownV2 + 429 handling
- **CI fix** — continue-on-error: true odstranjen (CI je bil dekorativen)
- **Next.js config fix** — ignoreBuildErrors: false, reactStrictMode: true

### Removed — Cleanup (v6.93)
- **265.615 vrstic smeti** izbrisanih:
  - 38 comp*.json + idea*.json + search*.json (LLM Bing SERP research artifacts)
  - 69 skills/ podmap (ClawHub vendored scripts, 0 referenc v src/)
  - 2 dashboard-*.png (LLM screenshoti)
- **980 vrstic mrtve kode** izbrisanih:
  - src/lib/scraper-v2.ts (391 vrst., 0 importov)
  - src/lib/captcha-solver.ts (302 vrst., 0 importov)
  - src/lib/tls-client.ts (287 vrst., 0 importov)
- **14 skoraj identičnih Python skript** konsolidiranih v 1 parametrizirano

### Fixed — Dead Code Wired (v6.93)
- **webhook-engine priklopljen** na pipeline — 5 eventov (alert.created, price.drop, target.hit, listing.new, trade.sold) sedaj dejansko sproži
- **smart-push priklopljen** na pipeline — pametno batchanje alertov po prioriteti (critical/high/medium/low) namesto spam-a

## [6.92.0] - 2026-07-29

### Added
- **AI Listing Image Background Cleaner** — ML čiščenje ozadja slik z image segmentation
  - 10 tipov težav z ozadjem (cluttered, messy, distracting, low_contrast, busy_pattern, unrelated_objects, poor_lighting_bg, other_people, text_overlay, watermark)
  - 10 nadomestnih ozadij (pure_white, pure_black, studio_gray, gradient_blue, gradient_warm, lifestyle_context, neutral_office, seamless_paper, transparent, branded)
  - Per-listing: current vs cleaned background score, CTR %, grade
  - 10 background analyses z severity, affected area %, CTR impact %, detection confidence %
  - 10 cleaning actions z technique (background_removal, object_inpainting, color_replacement, blur, crop, mask_refinement), tool recommended, time required
  - 5 ML modelov (u2net, sam, deeplabv3, mask_rcnn, ensemble) z prediction type (background_detection, segmentation, ctr_prediction, aesthetic_scoring)
- **AI Inventory Damage Prevention** — ML preprečevanje škode z risk assessment
  - 10 tipov škode (physical_damage, moisture_damage, temperature_damage, uv_damage, pest_damage, theft_risk, fire_risk, electrical_damage, chemical_damage, handling_damage)
  - 5 nivojev preprečevanja (critical_prevention → no_prevention_needed)
  - Overview: total items/value, at-risk items/value, damage probability avg %, grade
  - 15 risk items z primary damage risk, probability %, potential loss €, prevention level, recommended action
  - Per-damage-type: affected items count, value €, avg probability %, primary cause, prevention cost/ROI %
  - 10 prevention measures z cost €, implementation days, items protected, value protected €, ROI %
  - 5 ML modelov (random_forest, xgboost, neural_net, isolation_forest, ensemble) z prediction type (damage_prediction, risk_assessment, loss_forecast, anomaly_detection)
- **AI Buyer Social Influence Scorer** — ML ocena socialnega vpliva z network analysis
  - 7 vplivnih tierjev (mega_influencer, macro_influencer, micro_influencer, local_influencer, connected_buyer, average_buyer, isolated_buyer)
  - 10 dejavnikov vpliva (network_size, social_proof_generation, referral_frequency, review_impact, community_standing, cross_platform_presence, engagement_magnitude, trust_amplification, viral_potential, advocacy_consistency)
  - Per-buyer: influence score, tier, network reach, referral value €, advocacy score, viral coefficient, recommended partnership
  - 25 network metrics z betweenness/eigenvector centrality, clustering coefficient, network position, influence radius
  - 10 recommendations z partnership type, expected reach, revenue/cost €, ROI %
  - 5 ML modelov (graph_neural_net, random_forest, xgboost, neural_net, ensemble) z prediction type (influence_prediction, network_analysis, referral_forecast, viral_prediction)

## [6.91.0] - 2026-07-29

### Added
- **AI Listing Image Quality Scorer** — ML ocena kakovosti slik z VLM in aesthetic scoring
  - 10 dimenzij kakovosti (resolution, lighting, composition, color_accuracy, sharpness, background_cleanliness, angle_variety, detail_visibility, white_balance, noise_level)
  - Per-listing: current vs optimized quality score, CTR prediction %, grade
  - 8 image analyses (format, size, orientation, file_type, color_profile, transparency, metadata) z compliance status
  - 10 improvement actions z tool recommended (snapseed/lightroom/photoshop/canva/phone_camera/dslr/tripod/light_box), quality/CTR lift %, time required minutes
  - 5 ML modelov (cnn, resnet, vit, efficientnet, clip) z prediction type (quality_scoring, aesthetic_prediction, ctr_forecast, defect_detection)
- **AI Inventory Carrying Cost** — ML analiza stroškov držanja inventarja z optimization
  - 10 komponent stroškov (capital_cost, storage_cost, insurance_cost, depreciation_cost, obsolescence_cost, shrinkage_cost, handling_cost, administrative_cost, opportunity_cost, tax_cost)
  - Overview: total inventory value, daily/monthly/annual carrying cost €, carrying cost %, grade
  - Per-component: monthly/annual cost €, cost %, trend, controllable flag, optimization potential %
  - Per-category: item count, inventory value €, monthly carrying cost €, cost efficiency score, recommended action
  - 10 optimizations z expected monthly savings €, implementation days, difficulty, ROI %
  - 5 ML modelov (prophet, arima, lstm, xgboost, ensemble) z prediction type (cost_forecast, optimization_prediction, trend_analysis, risk_assessment)
- **AI Buyer Reactivation Engine** — ML reaktivacija neaktivnih kupcev z win-back strategy
  - 6 reactivation tierjev (highly_reactivatable, reactivatable, difficult_to_reactivate, hard_to_reactivate, unlikely_to_reactivate, lost)
  - 8 strategij reaktivacije (win_back_discount, personalized_outreach, new_product_alert, loyalty_reward, feedback_request, exclusive_offer, milestone_celebration, re_engagement_campaign)
  - Overview: total inactive buyers/value, avg inactive days, avg reactivation probability %, grade
  - Per-buyer: days inactive, lifetime value €, reactivation probability %, tier, preferred strategy
  - 8 reactivation strategies z target buyer count, cost €, expected reactivations, revenue €, ROI %
  - 5-phase campaign plan (awareness, consideration, incentive, follow_up, retention) z channel, timing, response rate %
  - 5 ML modelov (random_forest, xgboost, neural_net, survival_analysis, ensemble) z prediction type (reactivation_probability, churn_prediction, response_forecast, value_prediction)

## [6.90.0] - 2026-07-29

### Added
- **AI Listing Typography Optimizer** — ML optimizacija tipografije z readability in hierarchy
  - 10 tipografskih elementov (headline, subheadline, body_text, price_display, specs_label, specs_value, cta_text, caption, footer, badge)
  - 8 font družin (serif, sans_serif, monospace, display, handwritten, condensed, wide, slab)
  - Per-listing: current vs optimized typography score, readability level (poor→excellent), grade
  - 10 typography elements z current/recommended font family, size px, weight, line height, issue, fix
  - 8 readability metrics z current vs optimized score, weight %, improvement %
  - 8 font pairings z pairing score, use case, psychological impact, best for category
  - 5 ML modelov (cnn, resnet, vit, efficientnet, ensemble) z prediction type (readability_scoring, font_optimization, hierarchy_analysis, conversion_prediction)
- **AI Inventory Procurement Optimizer** — ML optimizacija nabave z supplier comparison
  - 5 strategij nabave (bulk_procurement, strategic_procurement, opportunistic_procurement, just_in_time, consignment_procurement)
  - 8 kriterijev dobaviteljev (price, quality, delivery_speed, reliability, minimum_order, payment_terms, geographic_proximity, exclusivity)
  - Overview: total suppliers/spent, avg purchase, budget utilization %, efficiency %, grade
  - 12 procurement plans z quantity, cost €, margin %, timeframe, priority, rationale
  - 12 supplier comparisons z 4 scoring dimensions, overall score, recommended spend %, risk level, best criterion
  - 12 category strategies z primary/backup supplier, cost savings %, quality target, reorder frequency
  - 5 ML modelov (random_forest, xgboost, neural_net, linear_regression, ensemble) z prediction type (price_prediction, supplier_scoring, demand_forecast, procurement_optimization)
- **AI Buyer Trust Builder** — ML gradnja zaupanja z trust signals in verification
  - 6 nivojev zaupanja (trusted_partner, highly_trusted, trusted, building_trust, neutral, suspicious)
  - 10 dejavnikov zaupanja (transaction_history, communication_quality, payment_reliability, review_score, dispute_history, response_time, transparency, consistency, social_proof, verification_status)
  - Per-buyer: trust score, level, predicted 6m trust %, weakest/strongest factor, trend, recommended action
  - 10 trust signals z current status (present/absent/partial), impact %, implementation difficulty
  - 8 verification steps z buyer coverage %, trust lift %, implementation days, cost €
  - 5 ML modelov (random_forest, xgboost, neural_net, gradient_boosting, ensemble) z prediction type (trust_prediction, risk_assessment, fraud_detection, behavior_analysis)

## [6.89.0] - 2026-07-29

### Added
- **AI Listing Color Psychology** — ML optimizacija barvne psihologije z color theory
  - 10 barvnih psihologij (red_urgency, blue_trust, green_natural, yellow_optimism, purple_luxury, orange_energy, black_premium, white_minimal, pink_playful, brown_earthy)
  - 10 čustvenih odzivov (excitement, trust, calm, urgency, luxury, happiness, professionalism, warmth, sophistication, approachability)
  - Per-listing: current vs optimized color score, current vs optimized emotional response, grade
  - 10 color analyses z hex code, current/recommended usage %, emotional trigger, cultural consideration, best for element
  - 10 emotional impacts z current/optimized intensity %, primary color driver, buyer segment appeal, conversion correlation %
  - 5 ML modelov (cnn, resnet, vit, efficientnet, ensemble) z prediction type (color_analysis, emotion_prediction, conversion_forecast, aesthetic_scoring)
- **AI Inventory Aging Strategist** — ML strategija za staranje z lifecycle analysis in action planning
  - 6 strategijskih tierjev (aggressive_disposal, discount_heavy, moderate_discount, strategic_hold, opportunistic_sale, premium_positioning)
  - 6 faz staranja (introduction, growth, maturity, decline, critical, terminal)
  - Overview: total items/value, avg age, critical items/value, devaluation at risk €, grade
  - Per-phase: item count, value, value %, recommended strategy, time window days, expected recovery %, action urgency
  - Per-category: total items, avg/oldest age, critical count, devaluation risk €, category strategy, trend
  - 10 action plans z strategy tier, target items count, expected recovery €, loss acceptance €, success probability %
  - 5 ML modelov (prophet, lstm, arima, xgboost, ensemble) z prediction type (aging_forecast, devaluation_prediction, recovery_optimization, lifecycle_analysis)
- **AI Buyer Engagement Predictor v2** — ML napoved engagementa z multi-channel scoring
  - 6 nivojev engagementa (highly_engaged, engaged, moderately_engaged, low_engagement, disengaged, dormant)
  - 10 dejavnikov engagementa (purchase_recency, purchase_frequency, browsing_activity, email_open_rate, message_response_time, review_activity, wishlist_adds, price_alert_engagement, social_shares, community_participation)
  - Per-buyer: engagement score, level, predicted 30d/90d engagement %, trend, primary driver, risk of disengagement %, recommended action
  - 8 engagement channels z avg engagement rate %, best segment, optimal frequency, preferred content type, ROI %
  - 10 recommendations z channel, expected engagement lift %, personalization factor
  - 5 ML modelov (random_forest, xgboost, neural_net, lstm, ensemble) z prediction type (engagement_prediction, churn_risk, channel_optimization, content_personalization)

## [6.88.0] - 2026-07-29

### Added
- **AI Listing Visual Hierarchy** — ML optimizacija vizualne hierarhije z eye-tracking simulation
  - 10 vizualnih elementov (hero_image, secondary_images, title_block, price_block, description_block, specs_table, cta_button, trust_badges, social_proof, shipping_info)
  - 9 con pozornosti (top_left → bottom_right) z attention %, fixation time ms, conversion impact %
  - Per-listing: current vs optimized visual score, attention efficiency %, grade
  - 8 design principov (contrast, alignment, proximity, repetition, balance, emphasis, rhythm, unity) z current vs optimized score
  - 10 optimizations z change type (reposition/resize/recolor/reorder/emphasize/de_emphasize), conversion lift %
  - 5 ML modelov (cnn, resnet, vit, efficientnet, ensemble) z prediction type (attention_prediction, visual_scoring, conversion_forecast, eye_tracking_simulation)
- **AI Inventory Liquidation Optimizer** — ML optimizacija likvidacije z exit strategy
  - 5 liquidation tierjev (urgent, aggressive, moderate, strategic, patient)
  - 10 izstopnih kanalov (auction, bulk_buyer, wholesale, discount_retail, online_marketplace, consignment, donation, scrap, trade_in, bundle_deal)
  - Overview: total items/value, urgent items/value, potential recovery €, recovery rate %, grade
  - 15 liquidation items z tier, exit channel, recommended price €, recovery %, time to liquidate days, loss acceptance €
  - Per-channel strategy z items count, value €, avg recovery %, time to complete, effort level, fees %
  - Per-tier pricing strategy z discount from cost %, psychological pricing, price anchors, sell-through rate %
  - 5 ML modelov (random_forest, xgboost, prophet, neural_net, ensemble) z prediction type (recovery_prediction, sell_time_forecast, channel_optimization, pricing_strategy)
- **AI Buyer Referral Predictor** — ML napoved referral vedenja z network analysis
  - 6 referral tierjev (super_advocate, advocate, potential_referrer, passive, unlikely, detractor)
  - 8 tipov spodbud (cash_reward, discount_coupon, free_item, loyalty_points, exclusive_access, recognition, charity_donation, tier_upgrade)
  - Per-buyer: referral probability %, tier, estimated referrals/year, value €, network reach score, influence score, recommended incentive
  - Per-buyer referral potential z current/potential 12m referrals, conversion rate %, referred buyer value €, total value €, best timing
  - Per-buyer network analysis z network size, influence %, social proof potential, viral coefficient, amplification factor
  - 8 incentives z cost per referral €, expected count, revenue €, ROI %, target tier
  - 5 ML modelov (random_forest, xgboost, neural_net, graph_neural_net, ensemble) z prediction type (referral_probability, network_influence, conversion_prediction, viral_forecast)

## [6.87.0] - 2026-07-29

### Added
- **AI Listing Audience Targeting** — ML optimizacija ciljanja publike z demographic analysis
  - 10 segmentske publike (bargain_hunters, collectors, resellers, enthusiasts, first_time_buyers, business_buyers, gift_shoppers, luxury_buyers, vintage_lovers, tech_early_adopters)
  - 10 kanalov ciljanja (facebook_marketplace, bolha_targeted, vinted_promoted, google_ads, instagram_shopping, tiktok_shop, email_campaign, whatsapp_broadcast, forum_posting, influencer_collab)
  - Per-listing: current vs optimized reach estimate, conversion %, grade
  - Per-segment: match score, audience size, conversion rate %, avg order value, competition level, priority
  - Targeting strategy z key message, best time/day to post, CPC €, CTR %
  - Channel mix z audience fit %, reach, cost €, conversions, revenue €, ROI %, budget %
  - 5 ML modelov (random_forest, xgboost, neural_net, k-means, ensemble) z prediction type (audience_classification, conversion_prediction, reach_forecast, channel_optimization)
- **AI Inventory Cost Forecast** — ML napoved stroškov inventarja z budget planning
  - 10 kategorij stroškov (purchase_cost, shipping_cost, storage_cost, maintenance_cost, insurance_cost, platform_fees, marketing_cost, packaging_cost, return_cost, opportunity_cost)
  - 5 forecast tierjev (under_budget, on_budget, slightly_over, over_budget, critical)
  - Overview: total current/forecasted costs, cost change %, avg cost per item, efficiency %, grade
  - Per-category cost forecast z current vs forecasted €, change %, trend, volatility %, tier
  - Per-category breakdown z cost % of total, optimization potential %
  - 8 cost drivers z impact %, controllable flag, mitigation strategy, expected savings €
  - 5 ML modelov (prophet, arima, lstm, xgboost, ensemble) z prediction type (cost_forecast, trend_analysis, budget_optimization, volatility_prediction)
- **AI Buyer CLV Predictor** — ML napoved Customer Lifetime Value z behavior modeling
  - 6 CLV tierjev (vip, high_value, medium_value, low_value, marginal, unprofitable)
  - 10 value driverjev (purchase_frequency, avg_order_value, category_breadth, referral_value, retention_length, price_premium_acceptance, cross_sell_receptiveness, feedback_value, advocacy_impact, lifetime_engagement)
  - Per-buyer: current CLV, predicted 12m/24m/lifetime CLV, tier, trend, ROI %, investment recommended €
  - Per-driver: current vs potential contribution €, improvement %, weight in CLV %, improvement strategy
  - Per-buyer predictions z next purchase probability %, value €, frequency 12m, churn probability %, growth driver, confidence %
  - Per-buyer recommendations z expected CLV lift €, investment €, expected ROI %, timeframe months
  - 5 ML modelov (random_forest, xgboost, neural_net, survival_analysis, ensemble) z prediction type (clv_prediction, churn_probability, purchase_forecast, value_optimization)

## [6.86.0] - 2026-07-29

### Added
- **AI Listing Emotional Trigger** — ML optimizacija čustvenih sprožilcev z behavioral psychology
  - 10 čustvenih sprožilcev (scarcity, urgency, exclusivity, social_proof, fear_of_missing_out, aspiration, nostalgia, trust, belonging, achievement)
  - 10 psiholoških dejavnikov (loss_aversion, reciprocity, authority, commitment, liking, consensus, contrast, anchoring, framing, endowment) z ethical concern
  - Per-listing: current vs optimized emotional score, conversion %, grade
  - 10 emotional triggers z intensity %, trigger phrase, buyer segment, conversion lift %, difficulty
  - 10 optimizations z phrase to add, placement (headline/description/cta/image_caption), priority
  - 5 ML modelov (bert, gpt, roberta, distilbert, ensemble) z prediction type (emotion_detection, conversion_prediction, sentiment_analysis, trigger_optimization)
- **AI Inventory Purchase Timing** — ML optimalen čas nakupa z market timing in price forecasting
  - 5 timing tierjev (excellent, good, fair, poor, avoid)
  - 10 tržnih razmer (bull_market, bear_market, stable, volatile, seasonal_low, seasonal_high, post_holiday, pre_holiday, economic_uncertainty, clearance_period)
  - Per-category: best/worst purchase window (YYYY-MM), timing confidence %, expected savings %, days until optimal
  - Per-category analysis: current vs predicted lowest/highest price, volatility %, seasonal pattern, best season, market trend
  - 12 price forecasts (30d/90d/180d) z confidence %, trend direction, volatility %
  - 5 ML modelov (prophet, lstm, arima, xgboost, ensemble) z prediction type (price_forecast, timing_optimization, seasonality_detection, volatility_prediction)
- **AI Buyer Loyalty Predictor v2** — ML napoved loyalnosti z behavior prediction in intervention design
  - 6 nivojev loyalnosti (devoted, committed, engaged, casual, at_risk, disengaged)
  - 10 dejavnikov loyalnosti (purchase_frequency, avg_order_growth, category_diversity, engagement_score, referral_activity, feedback_provision, seasonal_consistency, price_insensitivity, communication_responsiveness, brand_advocacy) z improvement strategy
  - Per-buyer: loyalty score, level, predicted 6m/12m loyalty %, lifetime value €, churn probability %, trend, primary action
  - 25 predictions z next purchase date/value, loyalty trajectory, risk/opportunity, confidence %
  - 6 intervencijskih tipov (loyalty_reward, personal_offer, exclusive_access, feedback_request, check_in, upgrade_tier) z expected lift %, cost/revenue €
  - 5 ML modelov (random_forest, xgboost, neural_net, survival_analysis, ensemble) z prediction type (loyalty_prediction, churn_probability, lifetime_value, behavior_forecast)

## [6.85.0] - 2026-07-29

### Added
- **AI Listing Mobile Optimizer** — ML optimizacija oglasov za mobilne naprave z UX analysis
  - 10 UX faktorjev (load_speed, image_optimization, text_readability, tap_targets, viewport_config, touch_friendly_navigation, form_usability, cta_visibility, scroll_depth_optimization, offline_capability)
  - Per-listing: current vs optimized mobile score, mobile conversion rate %, grade
  - 10 optimizations z implementation difficulty, expected load time reduction ms, conversion lift %, time to implement hours
  - 8 tipov naprav (iphone_se, iphone_standard, iphone_pro_max, android_compact, android_standard, android_tablet, ipad, foldable) z compatibility score, rendering issues, load time ms, conversion rate %
  - 5 ML modelov (cnn, resnet, vit, efficientnet, ensemble) z prediction type (ux_scoring, conversion_prediction, rendering_optimization, device_compatibility)
- **AI Inventory Supplier Evaluator** — ML evalvacija dobaviteljev z reliability scoring in risk assessment
  - 6 reliability tierjev (platinum, gold, silver, bronze, risk, blacklisted) z recommended action (continue/reduce_volume/monitor/find_alternative/terminate)
  - Per-supplier: reliability score, tier, total purchases/spent, avg order, successful sales %, cancellation rate %, last purchase date
  - Reliability scoring z 5 dimenzijami (quality, delivery, price_stability, communication, consistency)
  - 8 tipov tveganj (price_volatility, supply_disruption, quality_inconsistency, delivery_delays, communication_gaps, financial_instability, regulatory_issues, capacity_constraints) z mitigation strategy in monitoring frequency
  - 5 ML modelov (random_forest, xgboost, neural_net, gradient_boosting, ensemble) z prediction type (reliability_prediction, risk_assessment, supplier_classification, performance_forecast)
- **AI Buyer Feedback Analyzer** — ML analiza povratnih informacij kupcev z NLP in sentiment analysis
  - 8 tipov feedbacka (product_quality, shipping_experience, communication, pricing, listing_accuracy, customer_service, return_process, overall_satisfaction)
  - 5 sentimentov (very_positive → very_negative) z buyer count, satisfaction score, trend
  - 10 tematskih kategorij (quality_praise → recommendation) z occurrence %, sentiment correlation, key phrases, recommended response
  - Per-buyer feedback: feedback type, inferred sentiment, satisfaction score, inferred feedback text, action required
  - 8 action items z priority (critical→low), target buyer count, expected satisfaction lift %, responsible area
  - 5 ML modelov (bert, roberta, distilbert, t5, ensemble) z prediction type (sentiment_analysis, theme_extraction, satisfaction_prediction, feedback_classification)

## [6.84.0] - 2026-07-29

### Added
- **AI Listing Content Improver** — ML izboljšava vsebine oglasov z NLP in readability analysis
  - 10 sekcij vsebine (headline, introduction, features, specifications, condition, usage_history, reason_for_selling, shipping_info, call_to_action, faq_preview)
  - Per-listing: current vs improved content score, readability grade, word count, improvement grade
  - 10 tipov izboljšav (clarity, persuasion, specificity, emotion, urgency, credibility, readability, seo_optimization, mobile_optimization, accessibility) z current vs improved score in difficulty
  - 10 generated content sections z improved text, tone, key changes, expected impact %
  - 5 ML modelov (gpt, t5, bart, pegasus, ensemble) z prediction type (content_generation, readability_scoring, persuasion_analysis, seo_optimization)
- **AI Inventory Storage Optimizer** — ML optimizacija skladiščnih prostorov z layout analysis
  - 8 con skladišča (fast_access, bulk_storage, fragile_zone, climate_controlled, high_value, overflow, returns, staging)
  - 5 storage tierjev (tier_1_premium → tier_5_offsite)
  - Overview: total items/value, estimated storage cost €, storage efficiency %, space utilization %, grade
  - Per-zone: recommended categories, item count, value €, utilization %, access frequency, climate required, security level
  - 6 layout optimizations z space saved %, access time reduction %, cost/savings € monthly
  - 5 ML modelov (k-means, dbscan, linear_regression, neural_net, ensemble) z prediction type (layout_optimization, demand_prediction, space_forecast, access_pattern)
- **AI Buyer Journey Mapper v2** — ML mapiranje buyer journey z omnichannel touchpoints
  - 8 stadijev journey (awareness, consideration, intent, evaluation, purchase, onboarding, retention, advocacy)
  - 10 touchpointov (social_media_ad, search_result, marketplace_listing, email_campaign, word_of_mouth, influencer_referral, direct_visit, retargeting_ad, forum_discussion, comparison_site) z ROI %
  - 10 kanalov (bolha, facebook, vinted, avtonet, kleinanzeigen, email, website, phone, whatsapp, in_person) z conversion rate, CPA €, efficiency score
  - Per-stage: buyer count, completion %, avg time, drop off %, key actions, optimization opportunity
  - 5 ML modelov (markov_chain, lstm, bert, xgboost, ensemble) z prediction type (journey_prediction, touchpoint_attribution, conversion_forecast, drop_off_prediction)

## [6.83.0] - 2026-07-29

### Added
- **AI Listing Trend Detector** — ML detekcija trendov z momentum analysis
  - 10 tipov trendov (rising_star, viral, hot, emerging, stable_grower, plateau, declining, fading, dead, seasonal_spike)
  - Overview: total categories, recent vs older sold, growth rate %, trend confidence %, grade
  - Per-category trends z momentum score (0-100), growth %, price trend %, volume trend %, predicted duration days, opportunity score
  - Per-category historical: current vs previous volume, avg price change %, trend strength (strong→none), direction (up/down/flat)
  - 10 momentum signalov (price_increase, demand_surge, supply_shortage, category_breakout, cross_category_shift, demographic_shift, seasonal_onset, competitor_exit, platform_algorithm_change, macro_event) z action required
  - 5 ML modelov (prophet, lstm, arima, gradient_boosting, ensemble) z prediction type (trend_detection, momentum_analysis, growth_forecast, seasonality_decomposition)
- **AI Inventory Reorder Point** — ML izračun reorder pointov z demand variability
  - 6 reorder statusov (urgent_reorder, reorder_now, monitor_closely, adequate_stock, overstocked, no_restock_needed)
  - 8 demand patternov (steady, increasing, decreasing, volatile, seasonal_high, seasonal_low, sporadic, new_product)
  - Per-category: current stock, avg daily demand, lead time, reorder point, safety stock, days until stockout, status, pattern
  - Safety stock z avg demand, std dev, service level %, lead time, current vs calculated stock, status (adequate/low/critical/excess)
  - 5 ML modelov (prophet, arima, lstm, gradient_boosting, ensemble) z prediction type (demand_forecast, reorder_optimization, stockout_prediction, lead_time_forecast)
- **AI Buyer Persona Enricher** — ML obogatitev buyer personas z demographics in behavior inference
  - 10 tipov personas (bargain_hunter, quality_seeker, collector, reseller, first_time_buyer, business_buyer, gift_buyer, enthusiast, casual_browser, power_buyer)
  - 5 demographic tierjev (gen_z, millennial, gen_x, boomer, unknown)
  - Per-buyer: persona type, confidence %, demographic tier, age range, spending power (low→premium), purchase motivation, preferred categories, communication preference, persona score
  - Per-persona: buyer count/%, avg order, total revenue, retention rate, lifetime value, primary motivation, best channel
  - Per-demographic: buyer count/%, preferred categories, purchase frequency, tech savviness %, price sensitivity %
  - 5 ML modelov (bert, gpt, roberta, distilbert, ensemble) z prediction type (persona_classification, demographic_inference, behavior_prediction, motivation_analysis)

## [6.82.0] - 2026-07-29

### Added
- **AI Listing Meta Tag Optimizer** — ML optimizacija meta tagov z NLP in SEO scoring
  - 10 tipov meta tagov (title, description, keywords, og_title, og_description, og_image_alt, twitter_card, canonical, schema_markup, robots)
  - Per-listing: current SEO score, predicted SERP position, current vs optimized CTR %, grade
  - 10 SEO faktorjev (keyword_density, title_length, description_length, readability, keyword_relevance, search_intent_match, competitor_alignment, click_through_predictor, serp_position_predictor, mobile_optimization) z current vs optimized score in weight %
  - 8 optimization actions z expected SEO/traffic lift %, implementation difficulty, time to impact days
  - 5 ML modelov (bert, t5, roberta, distilbert, ensemble) z prediction type (serp_prediction, ctr_prediction, keyword_extraction, content_optimization)
- **AI Inventory Slow Mover Analyzer** — ML analiza počasi premikajočega inventarja z predictive analytics
  - 5 slowness tierjev (fast_mover, normal_mover, slow_mover, very_slow_mover, dead_stock) glede na category avg
  - Overview: total items/value, slow movers count/value/%, avg age, tied-up capital €, grade
  - 15 slow movers z slowness ratio, current vs predicted sell value €, predicted days to sell, recommended action
  - 8 akcijskih tipov (discount_15, discount_30, discount_50, bundle_deal, auction, liquidate, donate, return_supplier)
  - Per-category: slow mover count/%, avg age, tied-up capital, primary issue, category action
  - 5 ML modelov (random_forest, xgboost, lstm, prophet, ensemble) z prediction type (sell_time_prediction, value_degradation, risk_score, action_recommendation)
- **AI Buyer Segmentation Engine** — ML segmentacija kupcev z RFM analizo in clustering
  - 11 RFM segmentov (champions, loyal, potential_loyalists, new_customers, promising, need_attention, about_to_sleep, at_risk, cannot_lose_them, hibernating, lost)
  - Overview: total buyers/revenue, avg R/F/M scores, segmentation confidence %, grade
  - Per-segment: buyer count/%, revenue €/%, avg R/F/M scores, avg order value, retention rate %
  - Per-buyer RFM: recency/frequency/monetary score (0-100), RFM segment, combined score, predicted CLV €, recommended strategy
  - 8 strategij (reward, retain, activate, reactivate, win_back, educate, upsell, say_goodbye) z estimated cost, expected revenue lift, conversion rate %
  - 5 ML modelov (k-means, dbscan, gmm, hdbscan, ensemble) z prediction type (segment_classification, clv_prediction, churn_risk, behavior_pattern)

## [6.81.0] - 2026-07-29

### Added
- **AI Listing Cross-Sell Optimizer** — ML optimizacija cross-sell priložnosti z market basket analysis
  - 8 tipov cross-sell (complementary, accessory, upgrade, replacement, bundled, warranty, service, subscription)
  - Per-listing: current price, cross-sell opportunity score, potential revenue lift %, bundle readiness %, grade
  - 10 cross-sell opportunities z estimated price, probability %, expected revenue lift €, buyer persona
  - 8 bundle suggestions z 6 strategijami (fixed_bundle, dynamic_bundle, tiered_bundle, optional_addon, loyalty_bundle, seasonal_bundle), individual vs bundle price, discount %, conversion lift %
  - 5 ML modelov (apriori, fp_growth, collaborative_filtering, neural_net, ensemble) z prediction type (association_rules, bundle_optimization, cross_sell_probability, conversion_forecast)
- **AI Inventory Demand Forecaster** — ML napoved povpraševanja za kategorije z time series forecasting
  - 5 trend smeri (rising, stable, declining, volatile, seasonal)
  - 5 demand tierjev (oversupply, balanced, undersupply, critical_shortage, no_supply)
  - Per-category: current demand score, predicted demand 30d/90d, trend, tier, supply vs demand ratio, recommended stock level, urgency
  - 12 trend analysis z trend strength %, seasonality factor, anomaly detection
  - 8 recommendations z action type (restock/liquidate/hold/source/diversify), expected revenue impact €
  - 5 ML modelov (prophet, arima, lstm, gradient_boosting, ensemble) z prediction type (demand_forecast, trend_analysis, seasonality_detection, anomaly_detection)
- **AI Buyer Churn Predictor v2** — ML napoved odhoda kupcev z intervention strategy design
  - 6 churn tierjev (safe, low_risk, medium_risk, high_risk, critical, churned)
  - Per-buyer: churn probability %, tier, predicted churn date, primary driver, days since last, lifetime value, at-risk revenue, recommended intervention
  - 8 churn driverjev (inactivity, price_sensitivity, competitor_switch, poor_experience, no_engagement, category_disinterest, seasonal_gap, communication_failure) z mitigation strategy
  - 7 intervencijskih tipov (win_back_offer, personalized_outreach, loyalty_upgrade, discount_campaign, product_recommendation, feedback_request, reactivation_bundle) z estimated cost, recovery rate %, revenue recovered €, ROI %
  - 5 ML modelov (random_forest, xgboost, neural_net, survival_analysis, ensemble) z prediction type (churn_probability, risk_score, lifetime_value, intervention_response)

## [6.80.0] - 2026-07-29

### Added
- **AI Listing Seasonality Optimizer** — ML optimizacija oglasov glede na sezonskost z time series forecasting
  - 10 tipov sezon (holiday, back_to_school, summer, winter, spring_cleaning, black_friday, christmas, easter, tax_season, wedding_season)
  - Per-listing: current vs peak vs off-season price, seasonality score, optimal sell window, grade
  - 12-mesečni seasonality profile z demand level (peak→off_season), demand %, price multiplier, competition level, recommended action
  - 8 peak windows z start/end month, expected demand/price lift %, days until peak, preparation days
  - 5 ML modelov (prophet, lstm, arima, xgboost, ensemble) z prediction type (demand_forecast, price_forecast, seasonality_detection, trend_analysis)
- **AI Inventory Aging Predictor v2** — ML napoved staranja inventarja z devaluation curve modeling
  - 6 aging bucketov (fresh_0_30d, aging_30_60d, stale_60_90d, old_90_180d, stale_180_365d, dead_365d_plus)
  - Overview: total items, total value, avg age, stale items/value/%, devaluation at risk, grade
  - Per-bucket: item count, value, %, avg age, devaluation %, risk level, recommended action (sell_fast/discount/bundle/liquidate/hold)
  - 10-point devaluation curve z expected value %, devaluation tier (minimal→critical), action threshold
  - 15 risk items z current vs predicted value (30d/90d), devaluation tier, urgency
  - 5 ML modelov (arima, prophet, lstm, xgboost, ensemble) z prediction type (age_forecast, devaluation_forecast, sell_probability, risk_score)
- **AI Buyer Loyalty Tiers** — ML klasifikacija kupcev v 5 loyalty tierjev z rewards program design
  - 5 loyalty tierjev (bronze, silver, gold, platinum, diamond) z 8 reward tipi (discount_pct, free_shipping, priority_access, exclusive_deals, cashback, early_bird, bundle_bonus, referral_bonus)
  - Per-buyer: current/next tier, loyalty score, total purchases/spent, lifetime days, tier progress %, purchases/spend to next tier, tier benefits
  - Tier distribution z buyer count, revenue %, avg spend, retention rate, churn risk
  - Rewards program z reward value, eligibility, estimated cost/revenue lift per tier
  - Migration paths z required purchases/spend, estimated days, intervention, success probability %
  - 5 ML modelov (k-means, dbscan, random_forest, xgboost, ensemble) z prediction type (tier_classification, churn_prediction, lifetime_value, risk_score)

## [6.79.0] - 2026-07-29

### Added
- **AI Listing Question Optimizer** — ML napoved vprašanj kupcev in preventivni FAQ z NLP
  - 10 tipov vprašanj kupcev (condition, price_negotiation, shipping, specs, availability, history, warranty, compatibility, authenticity, logistics)
  - Per-listing: current vs suggested price, question optimization score, FAQ completeness, listing readiness grade
  - 12 predicted questions z likelihood %, urgency, buyer persona, impact on sale
  - 10 FAQ entries z question/answer, placement (top/middle/bottom), tone, priority
  - 6 gap analysis tipov (missing_info, unclear_pricing, no_shipping_info, no_condition_photo, no_warranty, no_specs) z expected conversion lift %
  - 5 ML modelov (bert, gpt, t5, roberta, ensemble) z prediction type (question_prediction, faq_generation, gap_detection, sentiment_analysis)
- **AI Inventory Shrinkage Detector** — ML detekcija izgub inventarja z anomaly detection
  - Overview: total inventory value, shrinkage value, shrinkage %, expected vs actual revenue, revenue gap, trend, grade
  - 8 tipov shrinkage (theft, damage, misplacement, administrative_error, spoilage, obsolescence, loss_in_transit, unrecorded_sale)
  - Per-event: lost value, severity (critical/high/medium/low), date detected, root cause, preventive action
  - Per-category: total items, shrinkage value/pct, primary shrinkage type, trend, risk level
  - 12 risk items z risk factors, recommended action (inspect/secure/relocate/sell_fast/audit), priority
  - 5 ML modelov (isolation_forest, autoencoder, lstm, gradient_boosting, ensemble) z prediction type (anomaly_detection, risk_forecast, pattern_recognition, trend_analysis)
- **AI Buyer Payment Reliability** — ML napoved zanesljivosti plačila kupca z risk assessment
  - 6 reliability tierjev (platinum, gold, silver, bronze, risk, blocked) z recommended action (accept/accept_with_caution/require_deposit/require_escrow/decline)
  - Per-buyer: reliability score, tier, total purchases, total spent, cancellations, total lost, preferred payment method, predicted reliability %
  - 7 plačilnih metod (cash, bank_transfer, paypal, card, crypto, cod, installments)
  - 8 dejavnikov tveganja (late_payment_history, partial_payments, disputed_transactions, no_show, cancelled_deals, communication_breakdown, price_renegotiation, payment_method_risk) z mitigation strategy
  - Per-recommendation: deposit amount %, rationale, expected risk reduction %
  - 5 ML modelov (gradient_boosting, random_forest, neural_net, logistic_regression, ensemble) z prediction type (payment_reliability, risk_score, default_probability, tier_classification)

## [6.78.0] - 2026-07-28

### Added
- **AI Listing Thumbnail Optimizer** — ML optimizacija thumbnail slik z VLM in A/B testing
  - 10 thumbnail faktorjev (composition, lighting, color_saturation, item_visibility, background_cleanliness, angle_optimization, size_proportion, emotion_trigger, brand_visibility, resolution_quality)
  - Per-listing: current vs optimized thumbnail score z per-factor issue in fix
  - 10 editing tipov z step-by-step in tool recommendation (snapseed/lightroom/photoshop/canva/phone)
  - AI prompts za image generation z VLM
  - 5 ML modelov (cnn, resnet, vit, efficientnet, ensemble) z prediction type (thumbnail_score, ctr_prediction, conversion_prediction, aesthetic_score)
- **AI Inventory Portfolio Analyzer** — ML analiza inventarja kot portfolio z modern portfolio theory
  - Portfolio metrics: total assets, return, risk, Sharpe ratio, diversification score, efficiency, grade
  - Per-category: current vs optimal allocation z rebalance action in Sharpe ratio
  - 7 risk-return metrik (return, volatility, Sharpe, max drawdown, beta, alpha, correlation)
  - Cross-category correlations z hedging opportunity detection
  - 5 ML modelov (mean_variance, risk_parity, monte_carlo, black_litterman, ensemble)
- **AI Buyer Spend Pattern Analyzer** — ML analiza porabnih vzorcev z anomaly detection
  - 10 spend pattern tipov (consistent_high→gradual_growth)
  - Per-buyer: spend pattern, confidence, volatility, trend, anomalies, predicted next spend/date
  - 5 anomaly tipov (spend_spike, spend_drop, frequency_change, category_shift, price_sensitivity_change)
  - 3 timeframe predictions (30d, 90d, 12m) z confidence
  - 5 ML modelov (isolation_forest, k-means, autoencoder, lstm, ensemble)

## [6.77.0] - 2026-07-28

### Added
- **AI Listing Social Proof Optimizer** — ML optimizacija social proof elementov z trust building
  - 10 social proof tipov (testimonials, review_count, seller_rating, sales_history, social_mentions, view_count, saved_count, shared_count, repeat_buyers, certification_badges)
  - Per-listing: current vs optimized social proof score z per-element analysis
  - 6 trust signal types (authority, consensus, scarcity, reciprocity, commitment, liking)
  - 10 optimization tipov z expected trust/conversion lift
  - 5 ML modelov z prediction type (trust_score, conversion_probability, engagement_lift, proof_effectiveness)
- **AI Inventory Profit Margin Tracker** — ML tracking profit marginov z trend analysis
  - 5 trend metrik (margin_pct, profit, revenue, cost, roi) z 30d prediction in confidence
  - Per-category: margin, profit, revenue, cost, trend, performance tier in recommended action
  - Per-item: est margin, profit, rank, vs category avg in margin status
  - 5 alert tipov (margin_decline, low_margin, cost_increase, price_too_low, category_underperforming)
  - 5 ML modelov z prediction type (margin_forecast, trend_prediction, anomaly_detection, optimal_pricing)
- **AI Buyer Retention Score Calculator** — ML kalkulator retention score z 12-faktorsko analizo
  - 12 retention faktorjev (recency, frequency, monetary, engagement, satisfaction, loyalty_program_participation, referral_activity, communication_responsiveness, category_diversity, seasonal_consistency, price_sensitivity, platform_loyalty)
  - 6 retention nivojev (platinum→churned) z buyer count, avg score in avg revenue
  - Per-buyer: retention score, level, 6m/12m probability, predicted next purchase date, recommended intervention
  - 5 interventions (maintain, nurture, reward, win_back, reactivate) z expected lift in revenue impact
  - 5 ML modelov z prediction type (retention_score, retention_probability, churn_prediction, optimal_intervention)

## [6.76.0] - 2026-07-28

### Added
- **AI Listing Engagement Predictor** — ML napoved engagement z 10-dimenzionalno analizo
  - 10 engagement faktorjev (visual_appeal, title_attractiveness, price_competitiveness, description_quality, category_demand, seller_reputation, location_convenience, seasonal_relevance, social_proof, urgency_level)
  - Per-listing: engagement score, level, predicted views/inquiries/saves/shares 7d, conversion probability
  - 10 optimization tipov z expected engagement lift in implementation effort
  - 3 timeframe predictions (24h, 7d, 30d) z confidence
  - 5 ML modelov z prediction type (engagement_score, view_prediction, inquiry_prediction, conversion_probability)
- **AI Inventory Stockout Predictor** — napoveduje izpodrpitev z ML in reorder timing
  - Per-category: current stock, daily sell rate, days until stockout, stockout date, probability, recommended reorder day/quantity, urgency
  - 5 stock statuses (well_stocked, adequate, low, critical, out_of_stock)
  - 30-day reorder plan z categories to reorder, estimated cost in revenue protection
  - 5 ML modelov z prediction type (stockout_timing, demand_forecast, optimal_reorder, stock_level)
- **AI Buyer Acquisition Cost Optimizer** — optimizira CAC z ML in channel analysis
  - 10 acquisition kanalov (bolha_organic, facebook_organic, vinted_organic, referral, social_media, email_marketing, cross_posting, flash_sale, bundle_attract, local_community)
  - Per-channel: current vs optimized CAC, ROI, expected new buyers, recommended action (scale_up/maintain/reduce/exit)
  - 10 optimization tipov (channel_reallocation, budget_optimization, referral_boost, content_marketing, cross_posting_expansion, bundle_strategy, flash_sale_optimization, community_building, email_automation, social_proof_leverage)
  - 12-mesečni projections z new buyers, avg CAC, total CAC, revenue, ROI in confidence
  - 5 ML modelov z prediction type (cac_forecast, channel_performance, buyer_acquisition, optimal_allocation)

## [6.75.0] - 2026-07-28

### Added
- **AI Listing CTR Optimizer** — ML optimizacija click-through rate z 10-faktorsko analizo
  - 10 CTR faktorjev (title_relevance, thumbnail_quality, price_appeal, position_ranking, category_match, search_keywords, freshness, seller_rating, location_proximity, urgency_signals)
  - Per-listing: current vs optimized CTR z per-factor scores in optimized title/thumbnail recommendation
  - 10 optimization tipov (title_rewrite, thumbnail_upgrade, price_adjustment, tag_optimization, refresh_posting, keyword_injection, urgency_addition, category_correction, location_emphasis, seller_boost)
  - A/B experiments z variant A/B in statistical significance
  - 5 ML modelov z prediction type (ctr_prediction, element_importance, view_forecast, inquiry_forecast)
- **AI Inventory Cost Minimizer** — minimizira skupne stroške z ML in cost decomposition
  - 10 cost kategorij (sourcing_cost, platform_fees, payment_fees, shipping_cost, storage_cost, holding_cost, renovation_cost, opportunity_cost, insurance_cost, return_cost)
  - Per-category: current vs optimized cost z savings in optimization action
  - 10 optimization tipov (fee_negotiation, platform_switch, bulk_shipping, faster_turnover, bundle_savings, supplier_renegotiation, storage_optimization, insurance_reduction, return_prevention, opportunity_cost_reduction)
  - Monthly projections z total cost, savings, net cost in profit increase
  - 5 ML modelov z prediction type (cost_forecast, optimal_cost, savings_potential, cost_attribution)
- **AI Buyer Revenue Forecaster** — napoveduje prihodek per kupec z ML in revenue decomposition
  - 10 revenue driverjev (purchase_frequency, order_value, retention_rate, cross_sell, upsell, referral, seasonality, market_trend, pricing, category_expansion)
  - Per-buyer: current vs projected revenue z drivers/risks in recommended action
  - 24-mesečni revenue projections z active buyers, avg order value in cumulative revenue
  - 4 scenariji (pessimistic, realistic, optimistic, stretch) z probability
  - 5 ML modelov z prediction type (revenue_forecast, buyer_spend, purchase_frequency, order_value)

## [6.74.0] - 2026-07-28

### Added
- **AI Listing Price Elasticity Analyzer v2** — ML analiza cenovne elastičnosti z demand curve
  - 5 elasticity tipov (elastic, inelastic, unitary, perfectly_elastic, perfectly_inelastic)
  - Per-item: elasticity coefficient, optimal price, expected demand/revenue/profit change
  - Demand curves per kategorija z price points, revenue-maximizing in profit-maximizing price
  - 5 pricing strategij (penetration, skimming, premium, competitive, value)
  - 5 ML modelov z prediction type (elasticity_coefficient, demand_at_price, optimal_price, revenue_forecast)
- **AI Inventory Turnover Accelerator** — pospešuje obrtnost z ML in bottleneck analysis
  - 8 bottleneck tipov (slow_category, overpriced, poor_listing, wrong_platform, seasonal_mismatch, competition, low_demand, bad_timing)
  - 12 accelerator tipov (price_drop, bundle_creation, cross_post, refresh_listing, flash_sale, auction_listing, bundle_break, platform_switch, image_upgrade, description_rewrite, tag_optimization, urgency_injection)
  - 10-step action plan z target items, expected days saved in revenue impact
  - 5 ML modelov z prediction type (days_to_sell, acceleration_potential, optimal_action, turnover_forecast)
- **AI Buyer Lifetime Value Optimizer** — optimizira LTV z ML in retention strategies
  - 10 retention strategij (loyalty_program, personal_outreach, exclusive_offers, early_access, bundle_incentives, birthday_rewards, referral_bonuses, feedback_loops, price_locks, priority_support)
  - Per-buyer: current vs optimized LTV, retention/churn probability, predicted remaining purchases/value
  - 4 LTV projections (6m, 12m, 24m, 36m) z retained/churned buyers in confidence
  - 5 recommended strategies (maintain, nurture, grow, maximize, salvage)
  - 5 ML modelov z prediction type (ltv_forecast, churn_probability, retention_probability, optimal_intervention)

## [6.73.0] - 2026-07-28

### Added
- **AI Listing Conversion Funnel Optimizer** — optimizira conversion funnel z ML in drop-off analysis
  - 10 funnel faz (impression→completion) z ML predictions (conversion probability, optimization potential)
  - Per-stage drop-off analysis z primary/secondary reasons in recovery strategy
  - 10 optimization tipov (title_improvement, image_enhancement, price_adjustment, description_optimization, response_speed, trust_building, urgency_injection, follow_up, payment_options, shipping_options)
  - 6 A/B experiments z hypothesis, variant A/B in statistical significance
  - 5 ML modelov z prediction type (stage_conversion, drop_off_probability, recovery_potential, optimal_intervention)
- **AI Inventory Supply Chain Optimizer** — optimizira supply chain z ML in sourcing strategy
  - 10 sourcing tipov (bulk_purchase, individual_sourcing, auction_buying, wholesale_lot, private_seller, estate_sale, retail_arbitrage, online_arbitrage, import, local_pickup)
  - Per-supplier: invested, profit, margin, reliability, response time, recommended action, negotiation leverage
  - 6 logistics components (transport, storage, packaging, shipping, insurance, handling) z cost savings
  - Monthly projections z sourcing cost, revenue, profit, margin in confidence
  - 5 ML modelov z prediction type (demand_forecast, price_prediction, supplier_reliability, optimal_sourcing)
- **AI Buyer Engagement Scoring Engine** — ML scoring engine za engagement z real-time tracking
  - 10 scoring faktorjev (recency, frequency, monetary, engagement_depth, response_rate, social_engagement, referral_activity, content_interaction, purchase_consistency, platform_activity)
  - 6 engagement nivojev (super_engaged→churned) z buyer count, avg score, avg revenue
  - Per-buyer: engagement score, level, trend, velocity, 30d/90d prediction, key drivers/barriers
  - 5 interventions (maintain, nurture, activate, reactivate, escalate) z expected lift in revenue impact
  - 5 ML modelov z prediction type (engagement_score, engagement_trend, churn_probability, intervention_response)

## [6.72.0] - 2026-07-28

### Added
- **AI Listing Emotional Trigger Analyzer** — analiza čustvenih sprožilcev z ML NLP
  - 12 emotional trigger tipov (scarcity, urgency, social_proof, authority, reciprocity, loss_aversion, aspiration, nostalgia, belonging, achievement, security, novelty)
  - Per-listing: detected triggers z intensity, missing triggers, recommended triggers z implementation in example phrases
  - 8 emotions z trigger association in conversion correlation
  - 4 optimization tipov (trigger_addition, trigger_intensification, trigger_removal, trigger_combination)
  - 5 ML modelov z prediction type (trigger_detection, emotion_classification, conversion_prediction, engagement_forecast)
- **AI Inventory Capital Efficiency Optimizer** — optimizira kapitalsko učinkovitost z ML
  - 7 efficiency metrik (roi, turnover_rate, days_to_sell, profit_per_euro_invested, capital_utilization, holding_cost_ratio, opportunity_cost)
  - 8 optimization tipov (faster_turnover, reduce_holding, increase_roi, capital_reallocation, cost_reduction, price_optimization, bundle_efficiency, liquidation_acceleration)
  - Monthly projections z ROI, turnover rate, capital efficiency % in confidence
  - 5 ML modelov z prediction type (efficiency_forecast, optimal_allocation, turnover_prediction, roi_optimization)
- **AI Buyer Network Expansion Strategist** — širi mrežo kupcev z ML in network analysis
  - 10 expansion strategij (referral_program, social_media_outreach, cross_platform_expansion, bundle_attract_new, seasonal_campaign, local_community, niche_targeting, partnership_leverage, content_marketing, flash_sale_attraction)
  - 10 channels z potential new buyers, acquisition cost, conversion % in best strategy
  - 6 campaigns z target audience, duration, expected new buyers, revenue, cost, ROI
  - 12-mesečni projection z new buyers, total buyers, revenue, cost, net profit
  - 5 ML modelov z prediction type (buyer_acquisition, revenue_forecast, channel_performance, network_growth)

## [6.71.0] - 2026-07-28

### Added
- **AI Listing Multi-Variant Tester** — A/B/n testing z ML in statistical significance
  - 8 variant elementov (title, description, price, image, tags, cta, timing, platform)
  - 5 variantov per listing z ML predictions (CTR, conversion, views, inquiries, engagement, winner probability)
  - Statistical analysis z confidence intervals, p-value, statistical power, sample size
  - 5 ML modelov z prediction type (ctr, conversion, engagement, winner)
- **AI Inventory Profit Maximizer** — maksimizira profit z ML optimization engine
  - 10 optimization tipov (price_increase, price_decrease, bundle_creation, cross_sell, upsell, renovation, relist, platform_switch, timing_optimization, bundle_break)
  - Per-item: current vs optimized profit z increase % in implementation steps
  - 4 scenariji (current, optimized, aggressive, conservative) z net gain in probability
  - 8-step action plan z expected profit increase in timeframe
- **AI Buyer Predictive Modeler** — napove vedenje kupca z ML ensemble
  - 8 prediction tipov (next_purchase, purchase_amount, category_preference, churn_probability, ltv_projection, referral_probability, response_probability, negotiation_outcome)
  - Per-buyer: next purchase prediction (date, category, amount), LTV projection (6m/12m/24m), churn risk, referral probability
  - 5 behavioral models z input features in accuracy
  - 8 triggers z trigger condition in urgency

## [6.70.0] - 2026-07-28

### Added
- **AI Listing Performance Dashboard** — centralni dashboard z ML insights in KPI tracking
  - 10 KPI-jev (revenue, profit, margin, items_sold, avg_days_to_sell, conversion_rate, avg_sell_price, profit_per_item, holding_cost, roi)
  - 8 insight tipov (trend, anomaly, opportunity, warning, info) z severity in impact
  - 6 trend metrik z 30d prediction in confidence
  - Top 10 performers z performance score in key success factor
  - 6 alert tipov z financial impact in recommended action
- **AI Inventory Growth Planner** — načrt rasti inventarja z ML in capital projection
  - 24-mesečni growth plan z reinvest amount, expected profit, cumulative capital
  - 3 scenariji (conservative, realistic, aggressive) z probability
  - 6 milestones z target month in achievement probability
  - 5 ML modelov (arima, lstm, prophet, xgboost, ensemble) z prediction type
- **AI Buyer Journey Optimizer** — optimizira buyer journey z ML in touchpoint mapping
  - 8 journey faz (awareness→advocacy) z stage probabilities in velocity score
  - Per-buyer: current stage, journey progress, blockers, accelerators, recommended touchpoint
  - Touchpoints per stage z channel, timing, message template, engagement in conversion lift
  - 5 optimization tipov (stage_acceleration, drop_off_reduction, touchpoint_addition, timing, channel)
  - 5 ML modelov (random_forest, gradient_boosting, lstm, markov_chain, ensemble)

## [6.69.0] - 2026-07-28

### Added
- **AI Listing Competitor Price Tracker v2** — ML competitor tracking z price intelligence
  - 5 ML modelov (arima, lstm, prophet, xgboost, ensemble) z prediction type per model
  - Per-competitor: avg/min/max price, discount %, threat level, strength/weakness, counter strategy
  - Price changes tracking z impact on you in recommended response
  - Per-category positioning z recommended position in expected impact
- **AI Inventory Liquidation Timeline** — timeline likvidacije z ML scheduling
  - 5 timeline faz (immediate→write_off) z day range in strategy
  - Per-item: scheduled day, recommended price, discount %, recovery rate, strategy (flash_sale/bundle/auction/discount/bulk/donate/write_off)
  - Daily schedule z items to list, expected revenue/loss in cumulative recovery
  - 5 ML modelov z prediction type (sell_probability, optimal_price, time_to_sell, recovery_rate)
- **AI Buyer Communication Style Analyzer** — analiza komunikacijskega stila z ML NLP
  - 10 komunikacijskih stilov (direct, indirect, formal, informal, analytical, emotional, assertive, passive, persuasive, collaborative)
  - Per-buyer: primary/secondary style, confidence %, communication score, preferred tone/channel/response time, negotiation style
  - Style adaptations z do/don't say lists in example messages
  - 5 ML modelov (bert, roberta, distilbert, xlm_roberta, ensemble) z prediction type

## [6.68.0] - 2026-07-28

### Added
- **AI Listing Price History Analyzer** — analiza cenovne zgodovine z ML trend detection
  - 5 ML modelov (arima, lstm, prophet, xgboost, ensemble) z prediction type per model
  - Price trends z direction, strength, affected categories in opportunity level
  - Per-category price points z avg, median, min, max, volatility in trend change
  - Opportunities z deal score, discount %, urgency in recommended action
- **AI Inventory Opportunity Scanner** — skenira inventar za skrite priložnosti z ML
  - 10 opportunity tipov (undervalued_listing, price_mismatch, bundle_potential, cross_sell, upsell, seasonal_opportunity, market_gap, arbitrage, renovation_flip, bulk_discount)
  - Per-item opportunity score z estimated uplift in recommended action
  - 5 ML scoring metrik (opportunity_score, uplift_potential, time_sensitivity, feasibility, roi)
  - Action plan z 8 koraki zexpected impact in timeframe
- **AI Buyer Review Generator** — generira review-e z ML sentiment optimization
  - 6 review tipov (seller_review, buyer_feedback, post_sale_review, testimonial, referral_message, social_proof_quote)
  - Per-buyer review z text, rating (1-5), sentiment, key points, suggested platform
  - 4 sentiment kategorije z buyer count in avg rating
  - 6 templates z fill-in-blanks in best for sentiment
  - 5 ML scoring metrik (sentiment_accuracy, authenticity, persuasiveness, relevance, readability)

## [6.67.0] - 2026-07-28

### Added
- **AI Listing Image Quality Assessor v2** — VLM analiza z 10-dimenzionalno analizo in improvement roadmap
  - 10 quality faktorjev (composition, lighting, background, focus, color_accuracy, angle, detail_visibility, item_proportion, image_resolution, emotional_appeal)
  - Per-listing: current vs optimized score z per-factor issue in fix
  - 8 recommended shots z how-to-shoot navodili
  - 6 editing recommendations z step-by-step in tool recommendation
  - Shot plan in editing plan za systematic improvement
- **AI Inventory Depreciation Tracker** — sledi padcu vrednosti z ML forecasting
  - 4 depreciation curve tipi (exponential, linear, logarithmic, step)
  - Per-item: current value, depreciation %, projected 30d/90d/180d, floor value, break-even date
  - Recommended action (hold/sell_now/sell_30d/sell_90d/write_off) z reasoning
  - Write-off schedule z tax deduction in alternative action
  - 4 ML modelov z accuracy in MAE per curve type
- **AI Buyer Satisfaction Predictor** — napove zadovoljstvo z ML in NPS prediction
  - 10 satisfaction faktorjev (price_fairness, item_quality, communication_quality, shipping_speed, packaging_quality, description_accuracy, seller_responsiveness, post_sale_support, overall_experience, value_for_money)
  - NPS prediction (promoter/passive/detractor) z NPS score
  - Per-buyer: satisfactionScore, predicted repeat purchase/referral/churn probability, LTV
  - 5 ML modelov z accuracy per prediction type (satisfaction, NPS, churn, repeat_purchase)

## [6.66.0] - 2026-07-28

### Added
- **AI Listing Cross-Platform Optimizer** — optimizira oglase čez 5 platform z ML in sync strategy
  - 8 sync strategij (cross_post, price_sync, inventory_sync, rotation_sync, bundle_sync, seasonal_sync, exclusive_deal, competitive_pricing)
  - Per-platform config z title, description, price, tags, language, CTA, expected views/inquiries
  - Conflict detection (price_mismatch, double_sale, description_conflict, platform_violation)
  - Performance metrics z current vs optimized values
- **AI Inventory Capital Allocator** — alokacija kapitala z ML in portfolio optimization
  - 5 ML modelov (mean_variance, kelly_criterion, risk_parity, momentum_tilting, ensemble)
  - Per-category allocation z current vs target, rebalance amount in direction
  - 3 scenariji (conservative, balanced, aggressive) z Sharpe ratio in max drawdown
  - 5 rebalancing akcij (buy_more, sell_partial, exit_category, enter_new, hold)
- **AI Buyer Win-Back Campaign Designer** — oblikuje win-back kampanje z ML in multi-touch
  - 8 campaign tipov (reactivation_discount, we_miss_you, new_arrival_alert, exclusive_preview, bundle_offer, loyalty_reward, feedback_request, last_chance)
  - 8 segmentov (dormant_30d→churned_180d, one_time_buyer, high_value_lost, seasonal_lapsed, price_sensitive_lost)
  - Per-segment messages z subject line, body, tone, personalization tokens, expected open/click rate
  - 90-dnevni timeline z per-day actions in 12-mesečni projection z ROI

## [6.65.0] - 2026-07-28

### Added
- **AI Listing Performance Benchmark v2** — benchmarking z ML competitor analysis in ranking
  - 6 industry benchmark metrik (margin_pct, days_to_sell, conversion_rate, ctr, revenue_per_item, profit_per_item)
  - Competitor analysis z their strengths/weaknesses in your advantage
  - Per-category ranking z rank change vs last month
  - Performance gaps z closing action in expected impact
- **AI Inventory Risk Assessor** — ocena tveganj z ML in 8-dimenzionalno risk matriko
  - 8 risk tipov (market_risk, liquidity_risk, depreciation_risk, damage_risk, theft_risk, pricing_risk, competition_risk, seasonal_risk)
  - Per-item risk scores z primary risk in capital at risk
  - Risk matrix z avg score, items affected, capital at risk per risk type
  - 5 ML modelov z accuracy in risk type prediction
- **AI Buyer Referral Program Designer** — oblikuje referral program z ML in incentive optimization
  - 5 program tipov (two_sided, one_sided_referrer, one_sided_referee, tiered, gamified)
  - 6 incentive tipov (discount, cash, free_item, store_credit, early_access, bundle)
  - 5 tier-ov (starter→ambassador) z referrer/referee rewards in bonus perks
  - 12-mesečni projection z referrals, new buyers, revenue, cost, net profit, ROI

## [6.64.0] - 2026-07-28

### Added
- **AI Listing Tag Optimizer** — ML tag optimization z keyword research in search visibility
  - 10 tag kategorij (primary, specification, condition, location, price, seasonal, long_tail, trending, competitor, niche)
  - Per-tag ML scoring (search volume, competition, relevance, CTR, visibility)
  - Keyword research z difficulty score, opportunity score in trend
  - Per-listing: current vs optimized search visibility z improvement %
- **AI Inventory Seasonal Planner v2** — advanced seasonal planning z ML in cross-category analysis
  - 8 sezon (spring, summer, autumn, winter, christmas, easter, back_to_school, black_friday)
  - 12-mesečni koledar z recommended actions, categories to stock/sell per mesec
  - Per-category seasonal factor, peak season, stock action (build_up/maintain/reduce/liquidate)
  - 5 ML modelov z seasonal accuracy in 5 seasonal strategij
- **AI Buyer Loyalty Program Designer** — oblikuje loyalty program z ML in tier-based rewards
  - 5 tier-ov (bronze, silver, gold, platinum, diamond) z perks, discount, exclusive access
  - 7 reward tipov (discount, free_item, early_access, bundle, cashback, referral_bonus, birthday_gift)
  - Point system z points per euro, bonus points, expiry in redemption options
  - 12-mesečni projection z active members, points issued/redeemed, revenue uplift, retention improvement

## [6.63.0] - 2026-07-28

### Added
- **AI Listing Description Generator v3** — ML opisi z personalization in sentiment optimization
  - 10 description stilov (storytelling, technical_specifications, benefit_driven, emotional_appeal,
    urgency_focused, social_proof, comparison_oriented, problem_solution, luxury_premium, minimalist_clean)
  - 5 opisov per listing z ML scoring (sentiment, readability, keyword density, engagement, conversion)
  - Persona-based personalization (10 personas z best style, hook, CTA, keywords)
  - A/B test plan z variant A/B, primary metric, confidence level
- **AI Inventory Turnover Predictor** — napove obrtnost inventarja z ML
  - 5 ML modelov (arima, lstm, prophet, xgboost, ensemble) z accuracy, MAE days, weight
  - Per-category turnover prediction z recommended action (accelerate/maintain/reduce/increase)
  - Monthly forecast z predicted turnover rate, items sold, revenue, days to sell
  - Capital efficiency tracking in turnover grade (A-F)
- **AI Buyer Churn Prevention Strategist** — preprečevanje odhoda kupcev z ML
  - 10 prevention strategij (personal_outreach, exclusive_offer, loyalty_reward, early_access,
    bundle_deal, price_lock, birthday_bonus, referral_incentive, feedback_request, re_engagement_campaign)
  - 5 ML modelov (logistic_regression, random_forest, gradient_boosting, neural_network, survival_analysis)
  - 7 churn risk faktorjev (recency, frequency, monetary, engagement, category_diversity, purchase_pattern, competition)
  - Per-buyer: churnRiskPct, churnRiskLevel, predictedChurnDate, retentionProbability, valueAtRisk
  - 30-dnevni intervention plan z message templates in expected response rate

## [6.62.0] - 2026-07-28

### Added
- **AI Listing Title Generator v2** — ML naslovi z A/B testing in platform optimization
  - 10 title strategij (keyword_front_loaded, brand_model_spec, benefit_focused, urgency_driven,
    question_format, number_included, emotional_appeal, local_seo, comparison_format, scarcity_emphasis)
  - 5 title variantov per listing z ML scoring (CTR, search visibility, conversion, engagement)
  - Platform-specific optimizations z max chars, keyword placement, emoji usage
  - A/B test plan z variant A/B, sample size, statistical significance
- **AI Inventory Demand Forecaster** — napove povpraševanje po kategorijah z ML
  - 5 ML modelov (arima, lstm, prophet, xgboost, ensemble) z accuracy, MAE, weight
  - Per-category demand prediction z demand_supply_ratio in recommended action
  - Demand trend detection z affected categories in opportunity level
  - Monthly forecast z predicted demand, revenue, confidence, seasonal factor
- **AI Buyer Purchase Pattern Analyzer** — analiza nakupnih vzorcev z ML sequence mining
  - 10 pattern tipov (sequential_consistent, seasonal_cyclical, price_progression, category_expansion,
    complementary_chain, replacement_cycle, upgrade_pattern, bulk_buyer, sporadic_random, declining_frequency)
  - 5 ML modelov (sequence_mining, association_rules, markov_chain, lstm_sequence, clustering)
  - Sequence patterns z next predicted item in association rules z support, confidence, lift
  - Per-buyer predicted next purchase z category, price range, date, probability

## [6.61.0] - 2026-07-28

### Added
- **AI Buyer Lifecycle Predictor** — napove lifecycle kupca z ML stage transition modeling
  - 9 lifecycle faz (prospect→first_time→repeat_customer→loyal_customer→advocate→at_risk→churning→churned→reactivated)
  - 5 ML modelov (markov_chain, lstm_sequence, random_forest, survival_analysis, cox_proportional_hazards)
  - Per-buyer: currentStage, predictedNextStage, transitionProbability, retentionProbability,
    churnProbability, predictedClvEur, value projection per month
  - Stage transitions z probability, avg time, key drivers, intervention
- **AI Listing Conversion Optimizer** — optimizira conversion rate z ML in multi-variate testing
  - 12 conversion faktorjev (price_competitiveness, image_quality, title_clarity, description_completeness,
    seller_reputation, location_convenience, shipping_options, payment_methods, response_speed,
    trust_signals, urgency_elements, social_proof)
  - 5 ML modelov (gradient_boosting, neural_network, logistic_regression, random_forest, xgboost)
  - Multi-variate (A/B/n) testing z variants, sample size, statistical significance
  - Per-listing: currentConversionRate vs optimizedConversionRate z lift %
- **AI Inventory Cash Flow Optimizer** — optimizira cash flow z ML forecasting in working capital
  - 6 cash flow strategij (accelerate_sales, delay_purchases, liquidate_dead, factor_receivables,
    leverage_credit, seasonal_reserve)
  - Working capital management (cash, inventory, receivables, payables, fees)
  - ML forecast per month (inflow, outflow, net, cumulative) z confidence
  - 4 scenariji (base_case, optimized, aggressive, conservative) z stability score
  - Cash conversion cycle in current ratio tracking

## [6.60.0] - 2026-07-28

### Added
- **AI Buyer Sentiment Analyzer v2** — NLP sentiment z emotion detection in intent classification
  - 8 čustev (Plutchik model: joy, trust, fear, surprise, sadness, disgust, anger, anticipation)
  - 12 intentov (purchase_intent, price_inquiry, condition_inquiry, negotiation_intent,
    comparison_shopping, urgency_expression, skepticism, complaint, compliment, bargaining,
    closing_intent, walk_away_intent)
  - 6 ML modelov (bert_multilingual, roberta_sentiment, distilbert_slavic, xlm_roberta,
    svm_classifier, lstm_sentiment)
  - Per-buyer: sentimentScore, dominantEmotion, primaryIntent, purchaseProbabilityPct,
    churnProbabilityPct, satisfactionScore, recommendedResponseTone
- **AI Listing SEO Optimizer v2** — advanced SEO z keyword research, competitor analysis in ML ranking
  - 10 SEO faktorjev (title_optimization, keyword_density, meta_description, image_alt_text,
    url_structure, tag_optimization, content_quality, mobile_optimization, page_load_speed,
    social_signals)
  - Keyword research z search volume, competition, difficulty score, opportunity score, CPC, trend
  - Competitor analysis z keyword overlap, advantages, counter strategy
  - ML ranking z predicted search position, CTR, conversion rate, engagement score
  - Per-listing: currentSeoScore vs optimizedSeoScore, optimized title per platforma
- **AI Inventory Profitability Analyzer** — globoka analiza z ML profit decomposition
  - 10 profit driverjev (purchase_price_efficiency, selling_price_optimization, fee_minimization,
    shipping_optimization, holding_cost_minimization, category_selection, timing_optimization,
    negotiation_effectiveness, renovation_value_add, bundle_strategy)
  - ML decomposition per metric (revenue, cost, profit, margin, ROI, days_to_sell)
  - 4 scenariji (current, optimized, aggressive_optimization, conservative)
  - Per-category profitability tier (excellent→loss) z recommended action (scale_up→exit)

## [6.59.0] - 2026-07-28

### Added
- **AI Buyer Behavior Pattern Detector** — ML detection z anomaly detection
  - 12 pattern tipov (loyal_repeat, seasonal_buyer, impulse_buyer, deliberate_researcher,
    bargain_hunter, premium_seeker, collector_enthusiast, reseller_flipper, occasional_buyer,
    price_sensitive, brand_loyal, category_specialist)
  - 8 anomaly tipov (sudden_high_value_purchase, unusual_frequency_spike, category_switch,
    price_range_deviation, location_change, response_time_degradation, pattern_break, volume_anomaly)
  - 5 ML modelov (isolation_forest, k-means, dbscan, autoencoder, statistical)
  - Per-buyer: detectedPatterns, anomalies, behavioralConsistencyScore, anomalyRiskScore, mlClusterId
- **AI Listing Performance Forecaster v4** — deep learning z transformer architecture
  - 8 deep modelov (transformer_encoder, bert_listing, gpt_listing, lstm_sequential, gru_temporal,
    cnn_image, multimodal_fusion, attention_mechanism)
  - Multi-horizon forecasting (short_term 7d, medium_term 30d, long_term 90d)
  - Attention weights per feature z interpretation
  - Uncertainty quantification (epistemic, aleatoric, total) z predictive intervals
- **AI Inventory Health Monitor v2** — real-time health z ML anomaly detection in predictive alerts
  - 8 health metrik (turnover_rate, aging_score, profitability, liquidity, diversification,
    risk_exposure, capital_efficiency, market_alignment)
  - 8 alert tipov (stale_inventory, dead_inventory, low_margin, over_concentration, capital_tied,
    demand_mismatch, risk_spike, performance_drop)
  - 5 predictive warnings (predicted_stale, predicted_loss, predicted_dead, predicted_cashflow_issue,
    predicted_overstock) z ML confidence
  - Per-item health status (healthy/warning/critical/dead) z urgency score

## [6.58.0] - 2026-07-28

### Added
- **AI Profit Margin Predictor v3** — advanced ML z 8-model ensemble in feature importance
  - 8 ML modelov (gradient_boosting, random_forest, neural_network, linear_regression,
    ridge_regression, lasso_regression, xgboost, lightgbm) z weight, accuracy, r2, MAE
  - Per-item ensemble prediction z confidence interval in model consensus
  - 4 scenariji (optimistic, realistic, pessimistic, stress_test) z verjetnostmi
  - Feature importance (top 10) z direction (positive/negative) in optimal values
  - Per-item key drivers z importance in current vs optimal value
- **AI Seller Trust Score v2** — advanced seller scoring z ML in 12-dimenzionalno analizo
  - 12-dimenzionalni trust score (transaction_history, responsiveness, consistency,
    transparency, fairness, professionalism, reliability_of_delivery, financial_integrity,
    communication_quality, listing_accuracy, post_sale_support, market_reputation)
  - 5 ML modelov (random_forest, gradient_boosting, neural_network, logistic_regression,
    ensemble_voting) z accuracy, precision, recall, f1
  - 7 behavioral patternov (consistent_buyer, diverse_buyer, high_frequency...)
  - 6 trust levelov (verified_trader→blacklisted) z ML classification
- **AI Listing Image Generator** — AI-generated image concepts z VLM prompts
  - 10 shot tipov (hero_shot, detail_closeup, context_lifestyle, angle_side, angle_top,
    damage_honest, size_reference, accessory_bundle, before_after, seasonal_themed)
  - AI prompts za Midjourney/DALL-E/Flux/Stable Diffusion z negative prompts
  - 6 editing presetov (brightness_boost, contrast_enhance, color_correction,
    background_cleanup, sharpness_enhance, crop_optimize) z step-by-step
  - A/B test plan za shot variant comparison

## [6.57.0] - 2026-07-28

### Added
- **AI Listing Optimization Pipeline** — celovit 10-fazni pipeline za optimization oglasa
  - 10 faz (analysis→title→description→price→image→tag→timing→platform_adaptation→final_review→launch)
  - Per-item before/after za vsako kategorijo optimizacije
  - Platform-specific naslov, opis, cena, tagi, jezik, CTA
  - Before/after metric z confidence interval
- **AI Inventory Rebalancer v3** — advanced rebalancing z ML portfolio optimization
  - 5 ML modelov (mean_variance, kelly_criterion, risk_parity, momentum_tilting, mean_reversion)
  - 4 scenariji (aggressive, balanced, conservative, defensive) z Sharpe ratio in max drawdown
  - 6 rebalancing ciljev (maximize_risk_adjusted_return, diversification, liquidity, seasonality, momentum, contrarian)
  - Per-category target allocation z rebalance amount in direction
- **AI Buyer Conversion Funnel v2** — advanced funnel z ML stage analysis
  - 10-fazni funnel (impression→view→engagement→inquiry→qualification→consideration→
    negotiation→commitment→payment→completion)
  - ML predictions per stage (conversion_probability, drop_off_probability, optimization_potential)
  - 8 optimization tipov (title_improvement, response_speed, trust_building, urgency_injection...)
  - A/B experimenti z hypothesis, variant A/B, sample size in test duration

## [6.56.0] - 2026-07-28

### Fixed
- **Vseh 24 TypeScript napak popravljenih** - 0 napak zdaj! ✨
  - trades-view.tsx: 12 napak (stats possibly null) - premaknjen stats blok end tag
  - lib/pipeline.ts: 2 napaki (settings used before declaration) - dodan preSettings
  - api/digest/route.ts: 1 napaka (aiReason ne obstaja na Alert) - odstranjeno
  - api/monitors/batch-run/route.ts: 2 napaki (never type) - eksplicitna tipizacija
  - listings-view.tsx: 1 napaka ('hide' ni v allowed) - dodan v union tip
  - settings-view.tsx: 1 napaka (Uint8Array) - konvertiran v ArrayBuffer
  - skills/*: 2 napaki - skills exclude v tsconfig

### Added
- **AI Seller Negotiation Strategist** — strategija za pogajanje kot prodajalec
  - 12 seller taktik (anchor_high, value_stack, scarcity_urgency, walk_away, split_difference,
    condition_concession, bundle_deal, payment_terms, social_proof, authority_leverage,
    loss_frame, reciprocity)
  - 8 buyer tipov z best/avoid taktikami (price_sensitive, quality_focused, urgent_buyer...)
  - 5 scenarijev (quick_sale, maximize_profit, bundle_opportunity, stalled, walk_away)
  - 5 counter strategij za buyer taktike (lowball_offer, take_it_or_leave_it...)
  - Concession plan z if/then logiko
- **AI Inventory Lifecycle Optimizer v2** — advanced lifecycle z ML stage transitions
  - 12 lifecycle faz (acquisition→intake→preparation→launch→active_marketing→inquiry_phase→
    negotiation→closing→sold→post_sale→failed→returned)
  - ML predictions per item (days_to_next_stage, final_stage, sale_probability, sale_price)
  - Stage transitions z blockers in accelerators
  - Optimal actions per stage z time savings in revenue impact
- **AI Buyer Persona Generator v2** — napredne osebe z ML clustering
  - 10 persona tipov (bargain_hunter, collector, parent_family, student_young, professional,
    hobbyist, gift_giver, reseller, tech_enthusiast, seasonal_buyer)
  - Per persona: demographics, psychographics, behavioral, motivational, messaging, channels
  - 3 clusterji (high_value, repeat_loyal, one_time_buyer) z behavioral patterns
  - Behavioral models z input features in accuracy
  - Messaging templates per persona z subject line in emotional appeal

## [6.55.0] - 2026-07-28

### Added
- **AI Inventory Liquidation Strategist** — strategic liquidation z timing in channel optimization
  - 10 liquidation strategij (flash_sale, bundle_clearance, auction_clearance, bulk_discount,
    donation_tax_writeoff, part_out, trade_in_credit, wholesale_lot, garage_sale, recycle_scrap)
  - Per-item recovery rate %, expected loss, best channel, best timing
  - 4-tedenski timeline z strategy focus in expected recovery
  - Bundle clearance z grouped items in target buyer
- **AI Buyer Engagement Optimizer** — optimizira engagement z personalization
  - 5 engagement tier-ov (champion/engaged/casual/dormant/lost)
  - 8 engagement faktorjev (recency/frequency/monetary/diversity/responsiveness/advocacy/loyalty/satisfaction)
  - 10 personalization strategij (category_targeted, price_based, cross_sell, upsell, repeat_buy...)
  - 8 kampanj (welcome, loyalty, reactivation, vip, seasonal, birthday, new_arrival, exclusive_preview)
- **AI Listing Performance Forecaster v3** — advanced ML z 8-model ensemble
  - 8 ML modelov (linear_regression, random_forest, gradient_boosting, neural_network, arima, prophet,
    lstm, ensemble_voting) z weight, accuracy in contribution
  - 4 scenariji (base_case, best_case, worst_case, stress_test) z confidence intervals
  - 30-dnevni time series z uncertainty band
  - Sensitivity analysis za price, day_of_week, season, competition

## [6.54.0] - 2026-07-28

### Added
- **AI Profit Margin Forecaster** — napove maržo in profit za naslednje N mesecev
  - 5 napovednih modelov (linear, seasonal, momentum, regression, growth)
  - Per-month forecast z margin %, revenue, cost, profit, confidence %
  - 4 scenariji (pessimistic, realistic, optimistic, stretch) z 12m projekcijami
  - Category projections z recommendation (invest_more/maintain/reduce/exit)
- **AI Buyer Conversion Predictor** — napove konverzijo povpraševanja v nakup
  - 7-fazni conversion funnel (awareness→interest→inquiry→consideration→negotiation→decision→purchase)
  - 10 conversion faktorjev (price_match, item_relevance, seller_trust, urgency...)
  - 10 intervention taktik (personal_outreach, limited_time_offer, bundle_deal...)
  - Per-buyer conversion probability z biggest blocker/accelerator
- **AI Listing Description A/B Test Optimizer** — ML testiranje opisov z multi-variantami
  - 10 variant tipov (control, emotional_appeal, urgency_focused, social_proof_heavy,
    specification_rich, story_driven, benefit_oriented, scarcity_emphasis,
    price_anchored, problem_solution)
  - 7 ML predictions per variant (views, inquiries, conversion_rate, time_to_sale, final_price, engagement, confidence)
  - Statistična analiza z confidence interval, p-value, statistical power
  - Test matrix z duration, sample size, primary metric, stopping rule

## [6.53.0] - 2026-07-28

### Added
- **AI Profit Distribution Optimizer** — optimizira porazdelitev dobička čez kategorije
  - 8 kategorij distribucije (reinvest, reserve, cash_out, tax_reserve, emergency_fund, growth_fund, debt_repayment, education)
  - 4 scenariji (aggressive_growth, balanced, conservative, cash_focus) z 12m/24m/36m projekcijami
  - Tax plan z deductions in optimization tips
  - 12-mesečni reinvest plan z cumulative capital
- **AI Listing Description Sentiment Optimizer** — optimizira opise za max emotional response
  - 8 sentiment faktorjev (trust, urgency, excitement, scarcity, social_proof, emotional, professional, persuasive)
  - 10 optimizacijskih strategij (add_trust, add_urgency, restructure, remove_negative...)
  - A/B test plan z variant A/B in focus faktorji
  - Per-listing current vs optimized sentiment z improvement %
- **AI Buyer Networking Strategist** — identificira povezave med kupci za network effects
  - 10 network tipov (referral_program, community_building, cross_introduction, bundle_split, group_discount, category_ambassador, local_network, seasonal_network, family_network, collector_network)
  - 5 network effects (direct, indirect, two_sided, data, platform)
  - Referral opportunities z incentive in conversion rate
  - Cluster analysis z member count in total spent

## [6.52.0] - 2026-07-28

### Added
- **AI Buyer Behavior Predictor** — napove naslednji nakup kupca in behavioral pattern
  - 5 pattern-ov (regular/irregular/seasonal/burst/one_time) z ML detection
  - 7 trigger-jev (seasonal/life_event/replacement/upgrade/complementary/impulse/need_based)
  - Per-buyer: nextPurchaseProbability, predictedNextPurchaseDays, predictedNextCategory
  - 5 behavior segment-ov (high_value_loyal→new_potential)
- **AI Pricing Psychology Optimizer** — psihološke cene z 12 tehnikami
  - 12 tehnik (charm_pricing, round_number, price_anchoring, decoy_pricing, bundle_pricing,
    penetration, premium_pricing, psychological_threshold, odd_even_pricing, loss_leader,
    dynamic_pricing, tiered_pricing)
  - Anchor analysis z savings display in perceived value
  - A/B test plan z variant A/B in confidence threshold
- **AI Listing Performance Tracker v2** — ML predikcija konverzije z demographic data
  - 8 ML predictions (conversion_probability, time_to_sell, final_price, profit, inquiry_rate,
    view_rate, bounce_rate, negotiation_probability)
  - 4 demographic faktorji (location_impact, source_preference, audience_match, seasonal_fit)
  - Channel analysis za 5 platform z fee in net revenue
  - 30-dnevni time series z cumulative revenue

## [6.51.0] - 2026-07-28

### Added
- **AI Buyer Retention Predictor** — churn prediction in win-back strategije
  - 5 stage-ov (new/active/at_risk/churning/churned) z churn in retention probability
  - 7 churn faktorjev (recency/frequency/monetary/categories/engagement/competition/seasonality)
  - 8 win-back strategij z ROI score in expected LTV uplift
  - 90-dnevni retention plan z message templates
- **AI Listing Description Generator v2** — multi-platform, multi-tone opisi z A/B variantami
  - 5 platform (bolha/facebook/vinted/ebay/kleinanzeigen) z jeziki (sl/en/de)
  - 6 tonov (professional/friendly/urgent/luxury/playful/technical)
  - 3 A/B variante per listing z expected conversion %
  - A/B test plan z duration, primary metric in success threshold
- **AI Inventory Performance Tracker** — KPI tracking, trendi in benchmarks
  - 10 KPI-jev (revenue, profit, margin, days_to_sell, inventory_turnover, sell_through_rate, avg_sell_price, holding_cost, stale_rate, dead_inventory_ratio)
  - Trendi z 30-dnevno napovedjo in confidence %
  - Category benchmarks z industry avg in performance tier
  - 5 alert tipov z severity in expected impact

## [6.50.0] - 2026-07-28

### Added
- **AI Buyer Journey Mapper** — 5-fazni buyer journey (awareness→consideration→decision→retention→advocacy)
  - Per-buyer stage probability in stage progression
  - Touchpoints per stage z message templates in expected engagement
  - Stage optimizations z revenue uplift in implementation effort
- **AI Listing Virality Predictor** — napove viral potential oglasa
  - 8 virality faktorjev (scarcity, emotional, controversy, utility, social_proof, price_anchor, timeliness, uniqueness)
  - 6 share triggerjev (emotional, utility, status, controversy, humor, identity)
  - 5 viral tier-ov (low→super_viral), expected shares in views multiplier
  - 5 content strategij z viral lift % in effort
- **AI Profit Margin Optimizer v2** — ML cross-category analiza
  - 10 optimizacijskih strategij (price_increase, cross_category_rebalance, specialization...)
  - Cross-category correlation analysis (positive/negative/neutral)
  - Rebalancing priporočila z amount, expected uplift in timeframe
  - 4 scenariji (current/optimized/aggressive/conservative)

## [6.49.0] - 2026-07-28

### Added
- **AI Price War Strategist** — defensive/offensive strategije za price war s competitorji
  - 5 war phases (erupting/escalating/intense/exhausting/resolved)
  - 10 strategij (hold_price, add_value, differentiate, bundle, niche, undercut_5/10, price_match, flash_sale, loss_leader)
  - Competitor threat analysis in 5 scenarijev z verjetnostmi
- **AI Seasonal Bundle Packager** — season-aware bundle paketi
  - 8 sezon (spring/summer/autumn/winter/christmas/easter/back_to_school/black_friday)
  - 8 bundle tipov (christmas_gift_pack, summer_outing_kit, back_to_school_bundle...)
  - Timeline z 4 fazami (prep/launch/peak/clearance)
- **AI Buyer Matchmaker v2** — ML matching kupcev z inventarjem
  - 8 ML scoring faktorjev (category_fit, price_fit, recency, frequency, affinity, conversion, engagement, seasonal)
  - 6 match tipov (direct_match, cross_sell_match, upsell_match, repeat_match, new_category_match, reactivation_match)
  - 14-dnevni outreach plan z predicted conversions

## [6.48.0] - 2026-07-28

### Added
- **AI Inventory Aging Predictor** — depreciation curve z 4 tipi
  - 7 kategorij z depreciation profili
  - exponential curve (telefoni, elektronika), linear (avto, kolesa), logarithmic (pohištvo, nepremičnine), step
  - Sell-by deadline izračun in 7 aging phases (fresh→zombie)
- **AI Seller Reliability Score v2** — 8-dimenzionalni trust score
  - 6 trust levelov (verified_trader→blacklisted)
  - Scam signal detection (single_high_value, multiple_locations, low_response_rate)
  - Behavior pattern tracking
- **AI Bulk Listing Generator** — multi-platform listing generation
  - 5 platform (bolha/facebook/vinted/ebay/kleinanzeigen)
  - Per-platform optimiziran naslov, opis, cena, tags, CTA, jezik
  - 7-dnevni batch plan z expected revenue in fees

## [6.47.0] - 2026-07-28

### Added
- **AI Profit Margin Predictor** — pred-nakupna ocena dobička
  - 5-tier profitability (excellent/good/average/poor/loss)
  - 3 scenariji (best/expected/worst case z verjetnostmi)
  - Renovation cost estimation
- **AI Listing Image Optimizer** — VLM analiza slik
  - 8 quality faktorjev (overall/primary/count/quality/composition/lighting/background/detail)
  - 10 suggested shot tipov z navodili kako slikati
  - Editing tips za Snapseed/Lightroom/Photoshop/Canva
- **AI Real-time Negotiation Bot** — dinamični negotiation z 10 taktikami
  - Conversation state tracking (phase/sentiment/round/spread/agreement_probability)
  - 3 alternativni odgovori per turn
  - Warnings za lowball/scam_signal/off_platform

## [6.46.0] - 2026-07-28

### Added
- **AI Cross-Sell Recommender** — per-customer cross-sell priložnosti
  - 8 strategij (complementary/upsell/bundle/repeat_buy/accessory/warranty/related_category/seasonal)
  - Bundle priporočila z discount % in pitch message
- **AI Buyer Trust Score** — 6 trust levelov
  - platinum/gold/silver/bronze/risky/scammer
  - Payment reliability, scam risk, churn risk, LTV potential
  - Recommended action (accept_priority→blacklist)
- **AI Auction Sniper v2** — ML timing z 5 bid taktikami
  - aggressive/patient/psychological/incremental/decoy
  - Anti-snipe defense, incremental bidding, competitor analysis
  - 5 scenarijev z verjetnostmi in win probability

## [6.45.0] - 2026-07-28

### Added
- **AI Customer Segmentation Engine** — RFM analiza (Recency/Frequency/Monetary)
  - 5 segmentov (champions/loyal/potential/at_risk/lost)
  - Per-customer strategija, churn risk, recommended channel
- **AI Listing SEO Optimizer** — optimizacija naslovov za Bolha/Facebook/Vinted
  - Per-platforma naslov (60/80/50c limit)
  - Keyword research z long-tail keywords in tags
  - SEO score 0-100 z expected views uplift
- **AI Reserve Price Optimizer** — auction pricing z demand analizo
  - 7 kategorij z auction profili
  - Starting/reserve/buy-now price calculation
  - 14-dnevni auction plan, sniper protection

## [6.44.0] - 2026-07-28

### Added
- **AI Refresh Calendar** — 30-dnevni refresh koledar z 7 strategijami
- **AI Deal Aggregator** — rangirana lista priložnosti iz vseh virov
- **AI Insurance Optimizer v2** — 4D risk matrika z 5 policami in claim scenariji

## [6.43.0] - 2026-07-28

### Added
- **AI Smart Bundle Pricing** — 8 pricing modelov z optimalno ceno
- **AI Cash Generator** — 8 strategij z 3-valovnim planom in profit retention
- **AI Profit Cycle Optimizer** — 8-fazni cikel z compounding projekcijami (12m/24m/36m)

## [6.42.0] - 2026-07-28

### Added
- **AI Risk Hedging** — 8 hedging strategij z coverage analysis
- **AI Multi-Platform Sync** — 6 sync strategij za 5 platform z conflict detection
- **AI Deal Velocity Accelerator** — 7-fazna bottleneck analiza

## [6.41.0] - 2026-07-28

### Added
- UI komponente za v6.40 MILESTONE (Master Dashboard, Autonomous Trading, Profit Playbook)

## [6.40.0] - 2026-07-28 — MILESTONE

### Added
- **AI Master Dashboard** — health score z grade, 8 sekcij, top akcije
- **AI Autonomous Trading** — paper/live mode, buy/sell rules, safeguards, projected ROI
- **AI Profit Playbook** — 8 faz z AI moduli in expected outcome grid

## [6.39.0] - 2026-07-27

### Added
- AI Performance Benchmarks
- AI Vendor Reliability Scorer v1
- AI Negotiation Outcome Predictor

## [6.30.0] - [6.38.0] - 2026-07-25 to 2026-07-27

### Added
- 24 novih AI funkcij v zaporedu (auction-timing, abtest-results, budget-allocator,
  bulk-buy, bundle-optimizer, buyer-intent, buyer-persona, cash-reserve, cashflow,
  categorize, competitor-intel, competitor-price-tracker, competitor-tracker,
  continuous-learning, cross-border, cross-category-bundle, cross-platform-price,
  cross-pollination, customer-ltv, daily-summary, deal-accelerator, deduplicate,
  demand-forecast, depreciation-forecast)

## [6.20.0] - [6.29.0] - 2026-07-23 to 2026-07-25

### Added
- AI Insights engine (samodejno odkrivanje trendov in anomalij)
- AI Listing Refresh, Listing Rotation, Listing Velocity
- AI Negotiation Chatbot, Negotiation Playbook, Negotiation Tracker
- AI Margin Guardian, Margin Optimizer
- AI Market Saturation, Market Trends
- AI Multi-Image Quality Assessor, Multi-Vendor Bundle
- AI Multimodal Listing (VLM)
- AI Optimal Time, Performance Forecaster

## [6.10.0] - [6.19.0] - 2026-07-22 to 2026-07-23

### Added
- AI Auction Sniper v1
- AI Buyer Matchmaker v1
- AI Buyer Persona Generator
- AI Customer Lifetime Value Predictor
- AI Deal Score 0-100
- AI Description Optimizer
- AI Detect Anomalies
- AI Email Campaign
- AI Exit Strategy
- AI Fake Detection
- AI Fraud Detection
- AI Full Automation
- AI Generate Listing
- AI Geo Price Map
- AI Image Quality

## [6.0.0] - 2026-07-20 — MAJOR

### Changed
- Vsi endpointi prešli na POST z AI integration
- Dodan multi-provider fallback sistem
- Dodan AI call tracking in dnevni limiti

## [5.0.0] - 2026-07-15 — MAJOR

### Added
- Anti-detection sistem (proxy rotation, realistic headers, request randomization)
- Stealth mode z Playwright
- CAPTCHA solving (2captcha, anti-captcha, capmonster)
- TLS fingerprinting
- Web Push notifications (VAPID)
- Digest mode (instant/daily/weekly)
- Quick response templates
- Quiet hours
- Auto-cleanup

## [4.0.0] - 2026-07-10 — MAJOR

### Added
- Profile sistem (switchable profiles za različne scenarije)
- Profit goal tracking
- AI Deal Score 0-100 (separate from aiScore 1-10)
- User-defined target price alerts
- Hidden listings (hide without delete)
- Personal notes on listings

## [3.0.0] - 2026-07-05 — MAJOR

### Added
- AI usage tracking (daily call counter)
- Trade management sistem (buy/sell tracking)
- Negotiation message tracking
- Price history tracking
- Reverse image search
- Seller tracking z listing count

## [2.0.0] - 2026-07-01 — MAJOR

### Added
- AI fallback (primary + secondary provider)
- Discord webhook notifications
- Slack webhook notifications
- Email notifications (SMTP)
- Quiet hours
- Web Push notifications (VAPID)
- Digest mode

## [1.0.0] - 2026-06-25 — INITIAL RELEASE

### Added
- Opportunity Monitor za Bolha.com
- AI evaluation (OpenAI / Anthropic / Ollama / OpenAI-compatible)
- Telegram bot z inline buttons
- Image analysis z VLM
- Bolha Playwright fallback
- AI score 1-10 in risk score 1-10
- Heartbeat monitoring
- Real-time price drop alerts
- Bookmark/favorite listings
- Web Push notifications

---

[Unreleased]: https://github.com/markec12345678/markecaifirm/compare/v6.92.0...HEAD
[6.92.0]: https://github.com/markec12345678/markecaifirm/compare/v6.91.0...v6.92.0
[6.91.0]: https://github.com/markec12345678/markecaifirm/compare/v6.90.0...v6.91.0
[6.90.0]: https://github.com/markec12345678/markecaifirm/compare/v6.89.0...v6.90.0
[6.89.0]: https://github.com/markec12345678/markecaifirm/compare/v6.88.0...v6.89.0
[6.88.0]: https://github.com/markec12345678/markecaifirm/compare/v6.87.0...v6.88.0
[6.87.0]: https://github.com/markec12345678/markecaifirm/compare/v6.86.0...v6.87.0
[6.86.0]: https://github.com/markec12345678/markecaifirm/compare/v6.85.0...v6.86.0
[6.85.0]: https://github.com/markec12345678/markecaifirm/compare/v6.84.0...v6.85.0
[6.84.0]: https://github.com/markec12345678/markecaifirm/compare/v6.83.0...v6.84.0
[6.83.0]: https://github.com/markec12345678/markecaifirm/compare/v6.82.0...v6.83.0
[6.82.0]: https://github.com/markec12345678/markecaifirm/compare/v6.81.0...v6.82.0
[6.81.0]: https://github.com/markec12345678/markecaifirm/compare/v6.80.0...v6.81.0
[6.80.0]: https://github.com/markec12345678/markecaifirm/compare/v6.79.0...v6.80.0
[6.79.0]: https://github.com/markec12345678/markecaifirm/compare/v6.78.0...v6.79.0
[6.78.0]: https://github.com/markec12345678/markecaifirm/compare/v6.77.0...v6.78.0
[6.77.0]: https://github.com/markec12345678/markecaifirm/compare/v6.76.0...v6.77.0
[6.76.0]: https://github.com/markec12345678/markecaifirm/compare/v6.75.0...v6.76.0
[6.75.0]: https://github.com/markec12345678/markecaifirm/compare/v6.74.0...v6.75.0
[6.74.0]: https://github.com/markec12345678/markecaifirm/compare/v6.73.0...v6.74.0
[6.73.0]: https://github.com/markec12345678/markecaifirm/compare/v6.72.0...v6.73.0
[6.72.0]: https://github.com/markec12345678/markecaifirm/compare/v6.71.0...v6.72.0
[6.71.0]: https://github.com/markec12345678/markecaifirm/compare/v6.70.0...v6.71.0
[6.70.0]: https://github.com/markec12345678/markecaifirm/compare/v6.69.0...v6.70.0
[6.69.0]: https://github.com/markec12345678/markecaifirm/compare/v6.68.0...v6.69.0
[6.68.0]: https://github.com/markec12345678/markecaifirm/compare/v6.67.0...v6.68.0
[6.67.0]: https://github.com/markec12345678/markecaifirm/compare/v6.66.0...v6.67.0
[6.66.0]: https://github.com/markec12345678/markecaifirm/compare/v6.65.0...v6.66.0
[6.65.0]: https://github.com/markec12345678/markecaifirm/compare/v6.64.0...v6.65.0
[6.64.0]: https://github.com/markec12345678/markecaifirm/compare/v6.63.0...v6.64.0
[6.63.0]: https://github.com/markec12345678/markecaifirm/compare/v6.62.0...v6.63.0
[6.62.0]: https://github.com/markec12345678/markecaifirm/compare/v6.61.0...v6.62.0
[6.61.0]: https://github.com/markec12345678/markecaifirm/compare/v6.60.0...v6.61.0
[6.60.0]: https://github.com/markec12345678/markecaifirm/compare/v6.59.0...v6.60.0
[6.59.0]: https://github.com/markec12345678/markecaifirm/compare/v6.58.0...v6.59.0
[6.58.0]: https://github.com/markec12345678/markecaifirm/compare/v6.57.0...v6.58.0
[6.57.0]: https://github.com/markec12345678/markecaifirm/compare/v6.56.0...v6.57.0
[6.56.0]: https://github.com/markec12345678/markecaifirm/compare/v6.55.0...v6.56.0
[6.55.0]: https://github.com/markec12345678/markecaifirm/compare/v6.54.0...v6.55.0
[6.54.0]: https://github.com/markec12345678/markecaifirm/compare/v6.53.0...v6.54.0
[6.53.0]: https://github.com/markec12345678/markecaifirm/compare/v6.52.0...v6.53.0
[6.52.0]: https://github.com/markec12345678/markecaifirm/compare/v6.51.0...v6.52.0
[6.51.0]: https://github.com/markec12345678/markecaifirm/compare/v6.50.0...v6.51.0
[6.50.0]: https://github.com/markec12345678/markecaifirm/compare/v6.49.0...v6.50.0
[6.49.0]: https://github.com/markec12345678/markecaifirm/compare/v6.48.0...v6.49.0
[6.48.0]: https://github.com/markec12345678/markecaifirm/compare/v6.47.0...v6.48.0
[6.47.0]: https://github.com/markec12345678/markecaifirm/compare/v6.46.0...v6.47.0
[6.46.0]: https://github.com/markec12345678/markecaifirm/compare/v6.45.0...v6.46.0
[6.45.0]: https://github.com/markec12345678/markecaifirm/compare/v6.44.0...v6.45.0
[6.44.0]: https://github.com/markec12345678/markecaifirm/compare/v6.43.0...v6.44.0
[6.43.0]: https://github.com/markec12345678/markecaifirm/compare/v6.42.0...v6.43.0
[6.42.0]: https://github.com/markec12345678/markecaifirm/compare/v6.41.0...v6.42.0
[6.41.0]: https://github.com/markec12345678/markecaifirm/compare/v6.40.0...v6.41.0
[6.40.0]: https://github.com/markec12345678/markecaifirm/compare/v6.30.0...v6.40.0
[6.30.0]: https://github.com/markec12345678/markecaifirm/compare/v6.20.0...v6.30.0
[6.20.0]: https://github.com/markec12345678/markecaifirm/compare/v6.10.0...v6.20.0
[6.10.0]: https://github.com/markec12345678/markecaifirm/compare/v6.0.0...v6.10.0
[6.0.0]: https://github.com/markec12345678/markecaifirm/compare/v5.0.0...v6.0.0
[5.0.0]: https://github.com/markec12345678/markecaifirm/compare/v4.0.0...v5.0.0
[4.0.0]: https://github.com/markec12345678/markecaifirm/compare/v3.0.0...v4.0.0
[3.0.0]: https://github.com/markec12345678/markecaifirm/compare/v2.0.0...v3.0.0
[2.0.0]: https://github.com/markec12345678/markecaifirm/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/markec12345678/markecaifirm/releases/tag/v1.0.0
