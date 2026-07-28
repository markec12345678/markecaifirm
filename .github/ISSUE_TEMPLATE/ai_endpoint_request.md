---
name: AI Endpoint Request
about: Predlog za nov AI endpoint
title: "[ai-endpoint] "
labels: ["ai-endpoint", "enhancement"]
assignees: []
---

## Endpoint specifikacija

**Ime**: `/api/ai/ime-funkcije`
**Method**: POST
**Max duration**: 60s / 90s / 120s

## Input (Body)

```json
{
  "tradeId": "string (optional)",
  "category": "string (optional)",
  "filters": { "minPrice": 0, "maxPrice": 1000 }
}
```

## Output

```json
{
  "ok": true,
  "result": {
    "mainField": "...",
    "items": [],
    "summary": {}
  }
}
```

## AI prompt osnutek

```
Si AI [ funkcija ]. Analiziraj [ podatke ] in predlagaj [ akcije ].
...
```

## Podprti AI providerji

- [ ] Ollama (lokalno)
- [ ] OpenAI
- [ ] Anthropic
- [ ] OpenRouter
- [ ] Gemini
- [ ] OpenAI-compatible

## Kategorija

- [ ] Statistike (analytics, predictions)
- [ ] Skladišče (inventory management)
- [ ] Oglasi (listing optimization)
- [ ] Negotiation
- [ ] Buyers/Customers
- [ ] Risk/Insurance
- [ ] Finance/Profit
- [ ] Automation

## Povezani endpointi

- `/api/ai/related-1` — ker [razlog]
- `/api/ai/related-2` — ker [razlog]

## Verzija

Načrtovano za: v6.XX.0
