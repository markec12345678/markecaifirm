# v8.94: Audit — V1/V2/V3/V4/Pro duplikati AI endpointov

## Povzetek

AI Hub avto-odkrije VSE endpointe preko `/api/ai-list`. To pomeni, da so
vse različice (v1, v2, v3, Pro) hkrati izpostavljene uporabniku. Rezultat:
uporabnik vidi npr. 7 listing-performance endpointov in ne ve, kateri je
"current". Ta audit identificira duplikate in predlaga deprecacijski načrt.

**Statistika:**
- Skupaj endpointov: 432
- Koncepti z duplikati: 12 skupin, 32 endpointov skupaj
- % vseh endpointov ki so duplikati: ~7,4 %
- Če odstranimo zastarele: ~20 endpointov lahko izbrišemo (varčevanje z vzdrževalnim dolgom)

---

## Deprecacijski načrt (prioritetni vrstni red)

### PRIORITETA 1 — Jasni duplikati (odstrani takoj)

| Koncept | Current | Zastareli | Razlog |
|---|---|---|---|
| `profit-maximizer` | `profit-maximizer-pro` (1298 vrstic) | `profit-maximizer` (236), `profit-maximizer-v2` (426) | Pro je najbolj feature-rich |
| `profit-margin-forecaster` | `profit-margin-forecaster-pro` (1138) | `profit-margin-forecaster` (271) | Pro je najnovejši |
| `inventory-aging-predictor` | `inventory-aging-predictor-pro` (791) | `inventory-aging-predictor` (372), `inventory-aging-predictor-v2` (124) | Pro je najboljši |
| `listing-performance-forecaster` | `listing-performance-forecaster-v4` (364) | `listing-performance` (257), `-forecaster-v3` (350), `-forecaster-pro` (996) | v4 je najnovejši; Pro je prekompleksen |

### PRIORITETA 2 — Manjši duplikati (konsolidacija)

| Koncept | Current | Zastareli | Razlog |
|---|---|---|---|
| `profit-margin-predictor` | `profit-margin-predictor-v3` (347) | `profit-margin-predictor` (311) | v3 je najnovejši |
| `inventory-health-monitor` | `inventory-health-monitor-v2` (355) | `inventory-health-monitor` (212) | v2 je najnovejši |
| `inventory-lifecycle` | `inventory-lifecycle-optimizer-v2` (308) | `inventory-lifecycle` (196) | v2 je najnovejši |
| `buyer-matchmaker` | `buyer-matchmaker-v2` (343) | `buyer-matchmaker` (199) | v2 je najnovejši |
| `auction-sniper` | `auction-sniper-v2` (270) | `auction-sniper` (216) | v2 je najnovejši |

### PRIORITETA 3 — Mešani duplikati (potrebujejo analizo)

| Koncept | Current | Ostali | Razlog |
|---|---|---|---|
| `buyer-journey-mapper` | `buyer-journey-mapper` (336) | `buyer-journey-mapper-v2` (122) | v1 je VEČJI od v2 — v2 je morda stale/poenostavljen |
| `listing-description-generator` | `listing-description-generator-v3` (323) | `listing-description-generator-v2` (310) | v3 je najnovejši (v1 manjka — morda nikoli ni obstajal) |
| `listing-image-quality` | `listing-image-quality-scorer` (?) | `listing-image-quality-assessor-v2` (?) | Različna imena — preveri kaj počneta |
| `seller-reliability` | `seller-reliability-v2` (edini) | — | Samo v2 obstaja — preimenuj v `seller-reliability` |

### PRIORITETA 4 — listing-performance družina (kompleksna)

Sedem endpointov v isti družini — potrebuje temeljito analizo:

| Endpoint | Vrstice | Status | Komentar |
|---|---|---|---|
| `listing-performance` | 257 | ? | Osnovni — morda "current" za enostavne klice |
| `listing-performance-benchmark-v2` | 184 | ? | Benchmark — različen namen |
| `listing-performance-dashboard` | 143 | ? | Dashboard — različen namen |
| `listing-performance-forecaster-pro` | 996 | ? | Najbolj kompleksen — morda "current" za napovedi |
| `listing-performance-forecaster-v3` | 350 | ? | Zastarel |
| `listing-performance-forecaster-v4` | 364 | **Current** | Najnovejši forecaster |
| `listing-performance-tracker-v2` | 363 | ? | Tracker (ne forecaster) — morda različen namen |

**Akcija:** Preveri ali `benchmark`, `dashboard`, `tracker` delajo drugače od `forecaster`. Če so res različni koncepti, jih preimenuj (`listing-performance-benchmark`, brez `-v2`).

---

## Predlagana migracijska strategija

### Faza 1: Označi zastarele (ne-rupturalno)
Za vsak zastareli endpoint dodaj na vrh `route.ts`:
```typescript
// @deprecated v8.94 — uporabi `profit-maximizer-pro` namesto tega.
// Ta endpoint bo odstranjen v v9.0.
```

In v AI Hub UI dodaj "DEPRECATED" badge poleg imena (spremeni `ai-list` API
da vrača `deprecated: boolean` polje).

### Faza 2: Redirect (mehka deprecacija)
Ko AI Hub ali dashboard kliče zastareli endpoint, ga redirect-aj na nov
(HTTP 308 Permanent Redirect). Logiraj usage da vidiš koliko še se kliče.

### Faza 3: Odstrani (trda deprecacija po 30 dneh)
Po 30 dneh z logging-om da vidiš da se nihče več ne kliče zastarele
endpointe, jih izbriši (skupaj z njihovimi test-i če obstajajo).

### Faza 4: Preimenuj (počisti imena)
Končno stanje:
- `profit-maximizer` (ne `-pro`)
- `profit-margin-forecaster` (ne `-pro`)
- `inventory-aging-predictor` (ne `-pro`)
- `buyer-matchmaker` (ne `-v2`)
- itd.

Brez verzij v imenih. Naming convention dokumentiraj v CONTRIBUTING.md.

---

## Implementation checklist (za solo dev)

- [ ] Faza 1: Dodaj `@deprecated` komentarje na ~20 zastarelih endpointov (1 dan)
- [ ] Faza 1: Posodobi `/api/ai-list` da vrača `deprecated` polje (1 ura)
- [ ] Faza 1: AI Hub UI — prikaži "DEPRECATED" badge (2 uri)
- [ ] Faza 2: Dodaj redirect logiko za 5 najbolj kritičnih duplikatov (1 dan)
- [ ] Faza 3: Po 30 dneh preveri log-e, izbriši neuporabljene (1 dan)
- [ ] Faza 4: Preimenuj `*-pro` → osnovno ime, `*-v2` → osnovno ime (1 dan)
- [ ] Faza 4: Posodobi vse reference v UI kodi (1 dan)

**Skupaj trud:** ~5 delovnih dni za popolno čiščenje.

---

## Predlagana naming convention (za prihodnost)

Da se izognemo duplikatom v prihodnje:

1. **NO versioning v imenih** — uporabi git history za verzije
2. **Nova funkcionalnost = novo ime** (ne `v2`) — npr. `profit-maximizer-pro` → `profit-optimizer-advanced`
3. **Breaking change = major version bump** aplikacije (v8.94 → v9.0), ne endpoint-a
4. **A/B testing** = poseben endpoint (`title-abtest`) ne `title-generator-v2`
5. **"Pro" / "Advanced" / "Enterprise"** oznake so za UI plans, ne za endpoint imena

Dokumentiraj to v `CONTRIBUTING.md` pod "AI endpoint konvencije" sekcijo.
