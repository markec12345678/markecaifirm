# Changelog

Vse pomembne spremembe projekta **Markec AI Firm** bodo dokumentirane tukaj.

Format sledi [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), verzije sledijo [Semantic Versioning](https://semver.org/).

## [Unreleased]

Načrtovano za v6.70+:
- UI komponente za v6.45-v6.69 funkcije v dashboard
- Unit testi za lib/ai.ts
- Playwright E2E testi
- WebSocket real-time negotiation
- ML model za buyer matchmaker (fine-tuned na realni data)

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

[Unreleased]: https://github.com/markec12345678/markecaifirm/compare/v6.69.0...HEAD
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
