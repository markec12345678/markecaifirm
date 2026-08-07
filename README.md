# Markec AI Firm — AI Trading Firm za slovenske oglase

[![Version](https://img.shields.io/badge/version-v7.71.0-blue.svg)](./CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/markec12345678/markecaifirm?style=social)](https://github.com/markec12345678/markecaifirm/stargazers)
[![AI Endpoints](https://img.shields.io/badge/AI%20endpoints-302-green.svg)](./AI_ENDPOINTS.md)
[![API Routes](https://img.shields.io/badge/API%20routes-452-cyan.svg)](#)
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
> **302 AI endpointov** + **45 analytics** + **10 cron automatizacij** + **11 Telegram ukazov** za iskanje, ocenjevanje, kupovanje in preprodajo.
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

### Verzija v7.71.0 (avgust 2026)

**302 AI endpointov** + **45 analytics** + **10 cron automatizacij** + **11 Telegram ukazov** + **~138 funkcij** organiziranih v 7 kategorij:
- **Statistike** (analytics, predictions, forecasting) — 35+ funkcij
- **Skladišče** (inventory management, aging, depreciation) — 20+ funkcij
- **Oglasi** (listing optimization, SEO, image analysis) — 25+ funkcij
- **Negotiation** (real-time bot, chatbot, playbook) — 8+ funkcij
- **Buyers/Customers** (segmentation, trust score, matching) — 12+ funkcij
- **Risk/Insurance** (hedging, fraud detection, claims) — 10+ funkcij
- **Finance/Profit** (margin, ROI, compounding, tax) — 16+ funkcij

### Kaj je novega v v7.56–v7.71 (16 verzij, 48 novih funkcij)

**v7.71 — AI Deal Anatomy Analyzer & Market Gap Forecaster & AI Profit Accelerator (3 funkcije):**
- **AI Deal Anatomy Analyzer** — AI "anatomizira" tvoje najboljše in najslabše posle — razčleni KAJ je naredilo posel uspešnega ali ne. Analizira anatomijo zmagovalnih poslov (cena, čas, kategorija, vir, deal score) v primerjavi z izgubljene, da identificira "DNA dobrega posla". Anatomy skupine (winners vs. losers): count, avgDiscountAtBuy (popust ob nakupu glede na estValue), avgDealScore, avgHoldDays, avgProfit, avgROI, topCategory, topSource, topDayOfWeek. AI generira dealDNA: winningFactors (top 5 faktorjev ki ločijo winners — weight 0-100, detail, winnerAvg, loserAvg), losingFactors (top 5 faktorjev ki korelirajo z izgubami), dealDNAProfile (idealPriceRange, idealCategories, idealDealScoreRange, idealSource, idealHoldDays), avoidanceProfile (avoidCategories, avoidSources, avoidPriceRanges, avoidDealScoreBelow), scoringRubric (kako ocenjevati bodoče posle). "Winning deals: 15% discount, dealScore 78, 22d hold. Losing: 5% discount, dealScore 45, 65d hold. DNA: buy at 15%+ discount, dealScore 70+." AI-enhanced z grounding + anti-hallucination (vsi weights clamped na [0, 100]) + 6h cache (key per totalSold) + deterministic fallback (compute factors iz winner vs. loser averages)
- **Market Gap Forecaster** — projektira katere market gap-ovi (nedosljedno pokrite kategorije/cena razponi) se bodo POJAVILI v naslednjih 30-60 dneh. Razlika od market-gap-finder (ki najde TRENUTNE gap-ove) — ta NAPOVE prihodnje gap-ove. Za vsako kategorijo: current (demandScore, supplyScore, gapScore = demand/(supply+1)×10, weeklyDemand, weeklySupply), trends (demandTrend, supplyTrend, gapTrend = demandSlope - supplySlope), forecast (projected30dGapScore, projected60dGapScore, gapStatus EMERGING/STABLE/CLOSING, timeToEmergingGap weeks), priceRangeGaps (7 cenovnih razponov z gapScore). Summary z emergingGaps, closingGaps, bestEmergingGap, advice. "Elektronika 250-500€: EMERGING gap (demand +15%/wk, supply -5%/wk). 30d projection: gap 85. BUY opportunity." Pure DB analytics, NO AI
- **AI Profit Accelerator** — AI identificira specifične akcije da POSPEŠI rast profita — ne samo maksimizira, ampak pohitri. currentMetrics (weeklyProfit, avgHoldDays, listingFrequency, winRate, capitalDeployed, profitVelocity), timeline (timeTo5000Profit, timeTo10000Profit, totalProfitThisYear v tednih). AI generira accelerationPlan: accelerationActions (3-5 konkretnih akcij z action, expectedImpact, expectedProfitIncrease €/week, timeToImplement days, effort LOW/MEDIUM/HIGH, riskLevel LOW/MEDIUM/HIGH), projectedTimeline (newWeeklyProfit, acceleratedTimeTo5000/10000, timeSaved5000/10000 v tednih), bottleneckAnalysis, quickWins (1-2 akcije za danes), longTermAccelerators (2-3 strukturne spremembe). "Accelerate: list 3/week (+150€/wk), cut hold 5d (+80€/wk). Time to 5000€: 12wk → 7wk (save 5wk)." AI-enhanced z grounding + anti-hallucination (newWeeklyProfit clamped na [current, current×3], time savings clamped na [0, 50% of current]) + 6h cache (key per currentWeek YYYY-Www) + deterministic fallback (compute actions iz metric gaps — if holdDays>30 suggest reduce hold, if listingFrequency<2 suggest list more)

**v7.70 — AI Profit Stream Predictor & Inventory Lifecycle Stage Classifier & Deal Source Comparison Matrix (3 funkcije):**
- **AI Profit Stream Predictor** — AI napoveduje "profit stream" — vzorce ponavljajočega se profita skozi čas. Identificira katere kategorije prinašajo stalen (STEADY) vs. sporadičen (ERRATIC) profit in projektira 90-dnevni tok profita z intervali zaupanja. streamType (STEADY/VARIABLE/ERRATIC glede na volatilnost stdev/mean), consistencyScore 0-100, profitVolatility. Per kategorija: weeklyProfit, reliability 0-100, streamType, contribution % od skupnega profita. AI generira 13-tedensko (90 dni) projekcijo z confidenceLow/confidenceHigh per teden, bestWeek/worstWeek, profitStabilityAdvice. "Profit stream: STEADY (volatility 0.2, consistency 85/100). 90d projection: 2400€. Najbolj zanesljiva: elektronika." AI-enhanced z grounding + anti-hallucination (projected profits clamped na [0, avgWeeklyProfit × 3]) + 6h cache (key per currentMonth) + deterministic fallback (linearna regresija na zadnjih 8 tednih)
- **Inventory Lifecycle Stage Classifier** — klasificira vsak HELD inventar v eno od 7 lifecycle stadijev (INTAKE → PROCESSING → LISTED → ACTIVE → AGING → STALE → DEAD) glede na daysSinceBuy, daysSinceFirstSeen, hasContacts, hasPriceDrops, flipChecklistProgress. Per item: currentStage, stageProgress 0-100%, nextStage, daysInStage, recommendedAction (specifično za vsak stadij), urgency (LOW/MEDIUM/HIGH/CRITICAL). portfolioDistribution (koliko item-ov v vsakem stadiju), actionPlan z immediateActions, bottleneckStage (kjer se največ item-ov zatakne) in advice. "INTAKE: 2, PROCESSING: 1, LISTED: 3, ACTIVE: 2, AGING: 1, STALE: 1, DEAD: 0. Bottleneck: LISTED (3 item-ov čaka aktivnost)." Pure DB analytics, NO AI
- **Deal Source Comparison Matrix** — 2D matrika ki primerja vire (Bolha, Vinted, Facebook, mobile.de) čez 5+ metrik: totalTrades, totalInvested, totalProfit, avgROI, winRate, avgHoldDays, avgDealScore, avgProfitPerTrade, profitPerDay, capitalEfficiency, riskScore. Normalizacija vsake metrike na 0-100 score (ROI/winRate/dealScore višje = boljše, holdDays/risk nižje = boljše), overallScore = weighted average (ROI 30%, winRate 25%, holdDays 15%, dealScore 15%, risk 15%), rank 1 = najboljši. Per-source × per-category breakdown z ROI, recommendations z bestSourceOverall, bestSourceByMetric (roi/winRate/speed/safety), sourcePriorityAdvice, categorySourceMatch (najboljši vir za vsako kategorijo). "Bolha: #1 (score 85, ROI 32%, win 70%). Vinted: #2 (score 72, ROI 18%). Best for elektronika: Bolha. Best for moda: Vinted." Pure DB analytics, NO AI

**v7.69 — AI Profit Leakage Detector & AI Deal Scoring Model v2 & Market Saturation Forecaster (3 funkcije):**
- **AI Profit Leakage Detector** — AI identificira kje profit "teče" — podcenajevanje (sold < estValue), visoke pristojbine (>5% trade value), predolgo držanje (carrying cost 0.50€/dan nad 14 dneh), zamujene priložnosti (cancelled trades). Leakage = idealProfit - actualProfit. Per-source agregacija (pricing/fee/holding/opportunity), leakageHotspots top 10, systemicIssues (npr. "vedno podcenjuješ elektroniko za 12%"), fixPriorities ranked (HIGH/MEDIUM/LOW), expectedRecovery € ob implementaciji popravkov, estimatedAnnualLeakage € projekcija. "Letna izguba: 450€. Glavni vir: podcenajevanje elektronike (-12%). Fix: prodajaj pri 95% estValue → +200€/leto." AI-enhanced z grounding + anti-hallucination (vsi zneski clamped na [0, totalLeakage×2]) + 6h cache (key per totalSold) + deterministic fallback
- **AI Deal Scoring Model v2** — advanced ML-style deal scoring z 7 faktorji (priceFactor, demandFactor, riskFactor, marketDepthFactor, sellerReliabilityFactor, categoryPerformanceFactor, timeFactor). AI določi uteži (% vsota 100), weightedScore 0-100, scoreBreakdown per faktor, confidenceLevel 0-100, grade (S/A/B/C/D/F), recommendation (STRONG_BUY/BUY/CONSIDER/PASS), keyStrengths/keyWeaknesses top 2. Razlika od basic dealScore — ta weighted multi-factor. "PS5 350€ (estValue 500€) → score 87 (A grade, STRONG_BUY). Strengths: price (30% below), demand (HIGH)." AI-enhanced z grounding + anti-hallucination + 6h cache (key per listingIds) + deterministic fallback (enake uteži)
- **Market Saturation Forecaster** — projektira saturacijo trga 30/60/90 dni vnaprej z linearno regresijo na 13 tednov (90 dni) zgodovine. Per kategorija: current saturation (1.0 = normal), listingTrend (INCREASING/STABLE/DECREASING), priceTrend (RISING/STABLE/FALLING), saturationVelocity (listings/week²), projected30d/60d/90d, saturationStatus (UNDERSTARTED <0.7, HEALTHY 0.7-1.3, SATURATING 1.3-1.7, OVERSATURATED >1.7), timeToOversaturation (dni), action (ENTER_NOW/CONTINUE/SLOW_DOWN/EXIT_NOW), pricePressureExpected (%). "Elektronika: SATURATING (1.4), timeToOversaturation 45d. Exit NOW. Moda: UNDERSTARTED (0.6). Enter NOW." Pure DB analytics, NO AI

**v7.68 — AI Supply Demand Balance Analyzer & Market Depth Analyzer & AI Risk Reward Calculator (3 funkcije):**
- **AI Supply Demand Balance Analyzer** — AI analizira razmerje med ponudbo (supply = aktivni oglasi) in povpraševanjem (demand = bookmarked/contacted/sold) per kategorija. sellThroughRate = demand/supply×100, balanceStatus (SELLER_MARKET >=70%, BALANCED 40-70%, BUYER_MARKET <40%), demandStrength 0-100, supplyPressure 0-100, priceOutlook (RISING/STABLE/FALLING), recommendedAction (SELL_AGGRESSIVELY/SELL_NORMAL/HOLD/BUY_AGGRESSIVELY). "Elektronika: SELLER_MARKET (75% sell-through, demand 90/100). Avto: BUYER_MARKET (25%). Prodi elektroniko zdaj." AI-enhanced z grounding + anti-hallucination + 6h cache (key per week) + deterministic fallback
- **Market Depth Analyzer** — meri "globino" trga per kategorija: koliko oglasov obstaja pri posamezni ceni (10 cenovnih bucketov). depthScore 0-100 (50% listing count + 50% distribution evenness), liquidityAssessment (HIGH >100, MEDIUM 30-100, LOW 10-30, VERY_LOW <10), pricingConfidence 0-100, priceGap (največji prazen cenovni razpon), sweetSpot (cenovni razpon z največ oglasi), outlierCount (>2 std dev). "Elektronika: deep market (85 listings, depth 90/100, HIGH liquidity). Avto: thin (5 listings, depth 20/100, VERY_LOW liquidity)." Pure DB analytics, NO AI
- **AI Risk Reward Calculator** — AI izračuna risk-adjusted reward za posamezne trade-e. potentialReward = aiEstimatedValue - buyPrice (upside), potentialLoss = buyPrice × 0.3 (max 30% downside), rewardToRiskRatio, probabilityOfProfit (iz dealScore), expectedValue = (p_win × reward) - (p_loss × loss). AI generira riskLevel/rewardLevel/riskRewardGrade (A+ do F), confidenceInAssessment, keyRiskFactors, mitigationStrategies, finalRecommendation (STRONG_BUY..STRONG_SELL). "PS5: ratio 2.5 (A grade), EV +85€, STRONG_BUY. Jakna: ratio 0.8 (C), EV -10€, HOLD." AI-enhanced z grounding + anti-hallucination + 6h cache (key per itemIds) + deterministic fallback

**v7.67 — Profit Efficiency Analyzer & Portfolio Health Dashboard & AI Market Share Analyzer (3 funkcije):**
- **Profit Efficiency Analyzer** — meri kako učinkovito pretvarjaš čas + kapital v profit. profitPerDay (€/dan aktivnosti), profitPerHoldDay (€ earned per dan vezave kapitala), capitalEfficiencyRatio (%), annualizedProfitPerDay (letna projekcija), timeEfficiencyScore 0-100 (avg hold <15d=100, 15-30=80, 30-45=60, 45-60=40, >60=20), capitalUtilizationScore 0-100 (% aktivno deploy-anega kapitala vs idle held). Per category efficiency rank. "Profit 2000€ v 90 dneh = 22€/dan. Najbolj učinkovita: elektronika (1.5€/hold-day). Letna projekcija: 8030€." Pure DB analytics, NO AI
- **Portfolio Health Dashboard** — celovit health score (0-100) za trenutni portfelj glede na 5 dimenzij: Diversification (Herfindahl), Liquidity (avg hold days), Risk Exposure (avg aiRisk), Aging (% held <30d), Profit Potential (unrealized %). Weighted avg (Diverzifikacija 20%, Likvidnost 25%, Tveganje 20%, Aging 15%, Profit 20%) z klasifikacijo EXCELLENT/GOOD/AVERAGE/POOR/CRITICAL. "Portfolio health 72/100 (GOOD). Likvidnost 40/100 (POOR — avg hold 52d). Prodi starejše item-e za izboljšanje." Pure DB analytics, NO AI
- **AI Market Share Analyzer** — AI ocenjuje tvoj market share v kategorijah kjer trguješ, glede na volumen oglasov vs total market listings. estimatedMarketShare = yourTradesInCategory / (totalMarketListings × 0.1) × 100 (predpostavka: ~10% oglasov rezultira v prodajo). Per category: competitivePosition (LEADER/CHALLENGER/FOLLOWER/NICHE based on share percentiles) + confidenceScore. AI generira dominantCategories, untappedCategories, growthOpportunity. "Elektronika: 12% market share (CHALLENGER). Moda: 2% (NICHE). Priložnost: razširi v avto (velik trg, 0% share)." AI-enhanced z grounding + anti-hallucination + 6h cache + deterministic fallback

**v7.66 — AI Competitive Landscape Analyzer & Price History Forecaster & FOMO/Scarcity Trigger Generator (3 funkcije):**
- **AI Competitive Landscape Analyzer** — AI analizira konkurenčno krajino, identificira druge flipper-je/prodajalce aktivne v tvojih kategorijah (3+ oglasov v 30 dneh), njihove cenovne strategije (PREMIUM/MID_MARKET/BUDGET), market share, threat level (LOW/MEDIUM/HIGH) in tvojo prednost. "Top konkurent: Elektro Marjan (15 oglasov, BUDGET strategy, 25% market share, HIGH threat). Tvoja prednost: boljše slike."
- **Price History Forecaster** — uporablja zgodovinske cenovne podatke (90 dni, 13 tednov) za napoved cenovnih gibanj po kategorijah z linearno regresijo. forecast30d, forecastDirection (RISING/STABLE/FALLING), volatility, confidenceScore, recommendation (GOOD_TIME_TO_BUY/GOOD_TIME_TO_SELL/HOLD/NEUTRAL). "Elektronika: -8% v 4 tednih, forecast FALLING → dober čas za nakup. Moda: +12% → prodi zdaj." Pure DB analytics, NO AI
- **FOMO/Scarcity Trigger Generator** — AI generira FOMO (Fear Of Missing Out) in scarcity messaging za held inventar listings da poveča konverzijo. Per item: urgencyLevel (LOW/MEDIUM/HIGH/CRITICAL), scarcityType (TIME_LIMITED/QUANTITY_LIMITED/SEASONAL/RARE_FIND), fomoPhrases (3-5 slovenskih), listingAddition (paragraf za opis), callToAction, psychologicalHook, expectedConversionLift (0-50%). "PS5 (redko) → 'Redko najdenje! Samo 3 podobni oglasi na Bolhi.' Critical urgency, +25% conversion lift."

**v7.65 — AI Deal Quality Forecaster & Negotiation Success Rate Analyzer & Portfolio Concentration Risk Analyzer (3 funkcije):**
- **AI Deal Quality Forecaster** — AI napove kvaliteto deal-ov za naslednjih 7 dni na podlagi zgodovinskih vzorcev po dnevih v tednu (90 dni). Za vsak dan: predictedDealScore, predictedListingCount, predictedPrilikaCount, confidenceScore, recommendation (SCAN_ACTIVELY/SKIP/CHECK_MORNING/CHECK_EVENING). "Torek = najboljši dan za skeniranje (avg dealScore 72, 15 oglasov). Petek = najslabši (45, 8 oglasov)."
- **Negotiation Success Rate Analyzer** — analizira zgodovinske izide pogajanj in izračuna success rate po kategoriji, cenovnem razponu, offer depth (0-5%/5-15%/15-30%/30%+) in vrsti prodajalca (RECURRING/ONE_TIME). "Elektronika: 65% success rate pri 10% popusta. Optimal offer: 5-15% below asking." Pure DB analytics, NO AI
- **Portfolio Concentration Risk Analyzer** — Pareto analiza (top 20% trade-ov = X% profita) + Herfindahl-Hirschman Index (0=diversified, 10000=monopoly) + klasifikacija DIVERSIFIED/MODERATE/CONCENTRATED/HIGH_RISK. "65% kapitala v elektronika = HIGH_RISK. Diverzificiraj v moda." Pure DB analytics, NO AI

**v7.64 — AI Trading Coach & Deal Fatigue Detector & Seasonal Timing Optimizer (3 funkcije):**
- **AI Trading Coach** — osebni AI coach ki analizira tvoje trading pattern-e (win rate by day/category, koncentracija, recent trend) in da personaliziran advice (strengths, weaknesses, patterns, recommendations, riskProfile, skillLevel, nextSteps). "80% koncentracija v elektronika — diverzificiraj v moda. Win rate 40% ob vikendih — kupuj med tednom."
- **Deal Fatigue Detector** — detektira deal fatigue/overtrading (frequency +180%, win rate -20%, dealScore decline). Klasifikacija FRESH/NORMAL/MILD_FATIGUE/FATIGUED/BURNOUT + suggestedBreakDays (0/3/7/30). Pure DB analytics, NO AI
- **Seasonal Timing Optimizer** — AI optimira TIMING za buy/sell (per held item + per category). Razlika od seasonal-calendar (statika) — ta upošteva TRENUTNI datum, held inventar in predvidi najboljše 2-tedensko okno. "PS5: WAIT_FOR_PEAK (Nov-Dec), +12% uplift, 45 days. Moda: BUY_NOW (off-season -15%)"

**v7.63 — Profit Margin Heatmap & Listing Exposure Score & Capital Allocation Optimizer (3 funkcije):**
- **Profit Margin Heatmap** — 2D matrica (kategorija × cenovni razpon) ki prikazuje kombinacije z najvišjim margin-om. heatScore = avgMargin × log(volume), klasifikacija HOT/WARM/COOL/COLD ("Elektronika 250-500€ = HOT, 35% margin, 12 trades")
- **Listing Exposure Score** — oceni kako dobro je vsak HELD inventar izpostavljen kupcem (listing age + cena + kontakti + deal score). Klasifikacija EXCELLENT/GOOD/AVERAGE/POOR/CRITICAL s concrete actions per item
- **Capital Allocation Optimizer** — AI optimira alokacijo razpoložljivega kapitala čez kategorije z 3 strategijami (CONSERVATIVE/BALANCED/AGGRESSIVE) baziranimi na zgodovinskih ROI + volatilnosti (Sharpe-like ratio = expectedROI / riskScore)

**v7.62 — Trade Replication Engine & Market Momentum Indicator & Cash Conversion Cycle Analyzer (3 funkcije):**
- **Trade Replication Engine** — AI analizira najbolj uspešne past trades (highest ROI) in predlaga nove search monitorje, ki bi replicirali te winning pattern-e (PS5 35% ROI → Bolha monitor 'PS5 Digital < 300€')
- **Market Momentum Indicator** — real-time momentum score (BULLISH/NEUTRAL/BEARISH 0-100) glede na listing velocity, price trend in deal frequency v zadnjih 7 dneh vs prejšnjih 7
- **Cash Conversion Cycle Analyzer** — finančna metrika kako hitro kapital teče skozi business (DIO + DSO - DPO); CCC 28d GOOD = 13x letni turnover

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

▶️ Glej [CHANGELOG.md](./CHANGELOG.md) za popolno zgodovino v1.0 → v7.71. Za starejše verzije (v1.0–v6.x) glej [ARCHIVE.md](./ARCHIVE.md).

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
| 17 | **AI Hub** | `a` | Vsi 302 AI endpointov z iskalnikom in runner-jem |

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

▶️ **Glej [AI_ENDPOINTS.md](./AI_ENDPOINTS.md) za popoln seznam vseh 302 AI endpointov.**

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

### Endpointi (302 AI + 45 analytics + 10 cron + sistemski = 452)

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
GET  /api/ai/trade-replication-engine            # AI replikacija zmagovalnih trade-ov v nove monitorje (v7.62)
GET  /api/ai/capital-allocation-optimizer       # AI optimizacija alokacije kapitala čez kategorije z 3 strategijami (v7.63)
GET  /api/ai/trading-coach                       # AI personal coach — patterns, weaknesses, recommendations, riskProfile (v7.64)
GET  /api/ai/seasonal-timing-optimizer            # AI optimalni timing za buy/sell (per item + per category) (v7.64)
GET  /api/ai/deal-quality-forecaster                # AI napoved kvalitete deal-ov za naslednjih 7 dni po dnevih v tednu (v7.65)
GET  /api/ai/competitive-landscape-analyzer          # AI analiza konkurenčne krajine — top prodajalci, strategije, threat level (v7.66)
GET  /api/ai/fomo-scarcity-generator                  # AI FOMO/scarcity messaging za held inventar — urgency, conversion lift (v7.66)
GET  /api/ai/market-share-analyzer                    # AI ocena tvojega market share per kategorija — LEADER/CHALLENGER/FOLLOWER/NICHE (v7.67)
GET  /api/ai/supply-demand-balance                    # AI supply/demand balance per kategorija — SELLER_MARKET/BALANCED/BUYER_MARKET + recommendedAction (v7.68)
GET  /api/ai/risk-reward-calculator                   # AI risk/reward per item — ratio, EV, grade A+ do F, STRONG_BUY..STRONG_SELL (v7.68)
GET  /api/ai/profit-leakage-detector                  # AI identificira kje profit teče — pricing/fee/holding/opportunity leakage, systemicIssues, fixPriorities (v7.69)
GET  /api/ai/deal-scoring-model-v2                    # AI weighted multi-factor (7 faktorjev) deal score 0-100 — S/A/B/C/D/F grade, STRONG_BUY/BUY/CONSIDER/PASS (v7.69)
GET  /api/ai/profit-stream-predictor                  # AI profit stream — STEADY/VARIABLE/ERRATIC, 90d projekcija z intervali zaupanja (v7.70)
GET  /api/ai/deal-anatomy-analyzer                    # AI anatomija winnerjev vs. losersov — deal DNA (winning/losing factors, ideal profile, avoidance, scoring rubric) (v7.71)
GET  /api/ai/profit-accelerator                       # AI akcije za pospešitev rasti profita — time-to-5000€/10000€ timeline, bottlenecks, quick wins (v7.71)

# Sistemski
GET  /api/health                         # Health check
POST /api/run?id=<monitorId>             # Sproži scan enega monitorja
GET  /api/cron/run-all?key=<secret>      # Cron: vsi monitorji + alerts + digest
POST /api/settings                       # Update nastavitve
GET  /api/listings                       # Seznam listingov
POST /api/trades                         # Ustvari trade

# Profit pipeline (v7.32-v7.71)
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
GET  /api/analytics/market-momentum              # Real-time BULLISH/BEARISH/NEUTRAL score (v7.62)
GET  /api/analytics/cash-conversion-cycle        # CCC: kako hitro kapital teče skozi business (v7.62)
GET  /api/analytics/profit-margin-heatmap        # 2D matrica kategorija × cena z HOT/WARM/COOL/COLD cells (v7.63)
GET  /api/analytics/listing-exposure-score        # Exposure score za HELD inventar (EXCELLENT→CRITICAL) (v7.63)
GET  /api/analytics/deal-fatigue-detector         # Overtrading/fatigue detection — FRESH/BURNOUT klasifikacija (v7.64)
GET  /api/analytics/negotiation-success-rate       # Success rate po kategoriji/ceni/offer depth-ih (v7.65)
GET  /api/analytics/portfolio-concentration-risk  # Pareto + Herfindahl + DIVERSIFIED/HIGH_RISK klasifikacija (v7.65)
GET  /api/analytics/price-history-forecaster      # Linear regression forecast po kategorijah — BUY/SELL/HOLD priporočilo (v7.66)
GET  /api/analytics/profit-efficiency-analyzer   # Profit per dan/hold-day, capital efficiency, letna projekcija — time/capital score (v7.67)
GET  /api/analytics/portfolio-health-dashboard   # Portfolio health 0-100 (5 dimenzij) — EXCELLENT/GOOD/AVERAGE/POOR/CRITICAL (v7.67)
GET  /api/analytics/market-depth-analyzer         # Market depth per kategorija — 10 cenovnih bucketov, depthScore 0-100, liquidity HIGH/MEDIUM/LOW/VERY_LOW (v7.68)
GET  /api/analytics/market-saturation-forecaster  # Saturacija trga 30/60/90d forecast — UNDERSTARTED/HEALTHY/SATURATING/OVERSATURATED + ENTER/EXIT signali (v7.69)
GET  /api/analytics/inventory-lifecycle-stage-classifier  # 7-stadijski lifecycle klasifikator held inventarja — INTAKE→PROCESSING→LISTED→ACTIVE→AGING→STALE→DEAD + bottleneck (v7.70)
GET  /api/analytics/deal-source-comparison-matrix         # 2D matrika virov × metrik — ROI/winRate/speed/safety normalization + overall score + rank (v7.70)
GET  /api/analytics/market-gap-forecaster                 # Forecast prihodnjih market gap-ov 30/60d — EMERGING/STABLE/CLOSING per kategorija + cena razpon (v7.71)
GET  /api/ai/demand-forecast              # AI napoved povpraševanja 30 dni (v7.60)
GET  /api/ai/margin-guardian-pro           # Real-time margin monitoring + AI pricing (v7.60)
GET  /api/ai/multi-platform-listing-generator  # AI oglasi za 5 platform (v7.60)
GET  /api/ai/negotiation-script-generator  # AI strategia za pogajanje (v7.61)
GET  /api/ai/photo-enhancement-advisor      # AI nasveti za fotografije (v7.61)
GET  /api/ai/trade-replication-engine        # AI replikacija zmagovalnih trade-ov (v7.62)
GET  /api/ai/capital-allocation-optimizer   # AI optimizacija alokacije kapitala z 3 strategijami (v7.63)
GET  /api/ai/trading-coach                  # AI personalni trading coach (v7.64)
GET  /api/ai/seasonal-timing-optimizer      # AI optimalni timing za buy/sell (v7.64)
GET  /api/ai/deal-quality-forecaster        # AI napoved kvalitete deal-ov za naslednjih 7 dni (v7.65)
GET  /api/ai/competitive-landscape-analyzer  # AI analiza konkurenčne krajine — top prodajalci, strategije, threat (v7.66)
GET  /api/ai/fomo-scarcity-generator          # AI FOMO/scarcity messaging za held inventar (v7.66)
GET  /api/ai/market-share-analyzer            # AI ocena market share per kategorija — LEADER/CHALLENGER/FOLLOWER/NICHE (v7.67)
GET  /api/ai/supply-demand-balance              # AI supply/demand balance per kategorija (v7.68)
GET  /api/ai/risk-reward-calculator             # AI risk/reward per item — ratio, EV, grade (v7.68)
GET  /api/ai/profit-leakage-detector            # AI identificira kje profit teče — leakage hotspots, systemic issues, fix priorities (v7.69)
GET  /api/ai/deal-scoring-model-v2              # AI weighted multi-factor (7 faktorjev) deal score 0-100, S/A/B/C/D/F grade (v7.69)
GET  /api/ai/profit-stream-predictor          # AI profit stream — STEADY/VARIABLE/ERRATIC, 90d projekcija z intervali zaupanja (v7.70)
GET  /api/ai/deal-anatomy-analyzer          # AI anatomija winnerjev vs. losersov — deal DNA, winning/losing factors, ideal profile, scoring rubric (v7.71)
GET  /api/ai/profit-accelerator             # AI pospeševalnik profita — akcije za pohitritev rasti, timeline to 5000€/10000€, bottlenecks (v7.71)

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
│   │   │   └── ai/              # 302 AI endpointov
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
- Vsi API route handlerji imajo try/catch z logger.error (452 routes)

▶️ **Glej [CONTRIBUTING.md](./CONTRIBUTING.md) za podrobnosti.**

---

## 🗺️ Roadmap

### v7.71 (trenutno — ~138 funkcij)
- [x] **Profit pipeline (79+ funkcij):** Deal Flow, Funnel, Sold Comps, Price History, Seller Intel, Make Offer, Quick Buy, Flip Workflow, Profit Maximizer v2, Niche Score, Deal Velocity, Bundle Detector, Capital Advisor, Threshold Optimizer, Deal Score Calibrator, Cross-border Arbitrage, Negotiation Auto-Responder, Seasonal Calendar, Profit Goal Tracker, Margin Guardian, Seller Response Predictor, Turnover Optimizer, Auto-Listing Draft, Photo Quality Analyzer, Refurb ROI Calculator, Loss Recovery Playbook, Monitor Suggestions, Tax-Aware Selling, Quick Sell Ladder, Risk Spread Calculator, Liquidation Strategist, Market Gap Finder, Listing Refresh Scheduler, Tax Report Generator, Reinvestment Advisor, Competitor Tracker, Deal Source ROI, Listing Performance, Auto-Relisting Scheduler, Negotiation Outcome Predictor, Portfolio Stress Test, Supplier CRM, Bundle Profit Optimizer, Demand Forecast AI, Margin Guardian Pro, Multi-Platform Listing Generator, Negotiation Script Generator, Inventory Insurance Calculator, Photo Enhancement Advisor, Trade Replication Engine, Profit Margin Heatmap, Listing Exposure Score, Capital Allocation Optimizer, AI Trading Coach, Deal Fatigue Detector, Seasonal Timing Optimizer, AI Deal Quality Forecaster, Negotiation Success Rate Analyzer, Portfolio Concentration Risk Analyzer, AI Competitive Landscape Analyzer, Price History Forecaster, FOMO/Scarcity Trigger Generator, Profit Efficiency Analyzer, Portfolio Health Dashboard, AI Market Share Analyzer, AI Supply Demand Balance Analyzer, Market Depth Analyzer, AI Risk Reward Calculator, AI Profit Leakage Detector, AI Deal Scoring Model v2, Market Saturation Forecaster, AI Profit Stream Predictor, Inventory Lifecycle Stage Classifier, Deal Source Comparison Matrix, AI Deal Anatomy Analyzer, Market Gap Forecaster, AI Profit Accelerator
- [x] **Cron automatizacija (10):** Smart Deal Alert, Inventory Aging, Weekly Report, Auto Price Drop, Competitor Monitor, Scraper Recovery, Relisting Reminder, Daily Pulse, Heartbeat, Smart Notification Router
- [x] **Telegram 2-way (11 ukazi):** /deals /profit /inventory /status /run /alerts /listings /monitors /trades /stats /help
- [x] **Anti-scraping (9 tehnik):** Cookie jar, 429 retry, Referer, Gaussian delay, 12 UAs, Per-domain session, Proxy rotation, CAPTCHA solver, Auto-Recovery
- [x] **Anti-hallucination (5 slojev):** Prompt grounding, Numeric sanity, Cross-reference, Confidence threshold (30%), Pattern detection
- [x] **AI cost optimization:** AI Output Cache (6h TTL, ~60% prihranek) + Batch Deal Evaluator (50 oglasov/klic, ~98% prihranek)
- [x] **Security:** AES-256-GCM secrets encryption, Rate limiting, SSRF protection
- [x] **Analytics (45):** Deal Velocity, Sold Comps, Niche Score, Deal Funnel, Platform Performance, Source Quality, Net Profit (after tax), Reseller Blackbook, Time-to-Profit, Profit Heatmap, Market Trend, Cross-Platform Arbitrage, Deal Timing, Seasonal Calendar, Profit Goal Tracker, Weekly Trend Radar, Cash Flow Forecast, ROI Leaderboard, Missed Opportunities, Optimal Listing Time, Purchase Pattern, Tax Report, Competitor Tracker, Deal Source ROI, Listing Performance, Market Gap Finder, Portfolio Stress Test, Supplier CRM, Optimal Listing Time, Inventory Insurance Calculator, Market Momentum, Cash Conversion Cycle, Profit Margin Heatmap, Listing Exposure Score, Deal Fatigue Detector, Negotiation Success Rate, Portfolio Concentration Risk, Price History Forecaster, Profit Efficiency Analyzer, Portfolio Health Dashboard, Market Depth Analyzer, Market Saturation Forecaster, Inventory Lifecycle Stage Classifier, Deal Source Comparison Matrix, Market Gap Forecaster
- [x] **Testing:** Vitest (37 tests), structured logger, try/catch na vseh 452 API routes
- [x] **0 vulnerabilities**, 0 TS errors, 0 ESLint errors

### Naslednji koraki
- [ ] UI komponente za v7.50-v7.71 funkcije v dashboard
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

Popolna zgodovina verzij v [CHANGELOG.md](./CHANGELOG.md) — od v1.0 (25. junij 2026) do v7.71 (avgust 2026). Starejše verzije (v1.0–v6.x) so arhivirane v [ARCHIVE.md](./ARCHIVE.md).

### Zadnje verzije
- **v7.71.0** (avgust 2026) — AI Deal Anatomy Analyzer, Market Gap Forecaster, AI Profit Accelerator
- **v7.70.0** (avgust 2026) — AI Profit Stream Predictor, Inventory Lifecycle Stage Classifier, Deal Source Comparison Matrix
- **v7.69.0** (avgust 2026) — AI Profit Leakage Detector, AI Deal Scoring Model v2, Market Saturation Forecaster
- **v7.68.0** (avgust 2026) — AI Supply Demand Balance Analyzer, Market Depth Analyzer, AI Risk Reward Calculator
- **v7.67.0** (avgust 2026) — Profit Efficiency Analyzer, Portfolio Health Dashboard, AI Market Share Analyzer
- **v7.66.0** (avgust 2026) — AI Competitive Landscape Analyzer, Price History Forecaster, FOMO/Scarcity Trigger Generator
- **v7.65.0** (avgust 2026) — AI Deal Quality Forecaster, Negotiation Success Rate Analyzer, Portfolio Concentration Risk Analyzer
- **v7.64.0** (avgust 2026) — AI Trading Coach, Deal Fatigue Detector, Seasonal Timing Optimizer
- **v7.63.0** (avgust 2026) — Profit Margin Heatmap, Listing Exposure Score, Capital Allocation Optimizer
- **v7.62.0** (avgust 2026) — Trade Replication Engine, Market Momentum Indicator, Cash Conversion Cycle Analyzer
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

