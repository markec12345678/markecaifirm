---
name: Feature Request
about: Predlagaj novo AI funkcijo ali izboljšavo
title: "[feat] "
labels: ["enhancement", "triage"]
assignees: []
---

## Kratek opis funkcije

Kaj naj nova funkcija počne?

## Use case / Motivacija

Zakaj to rabimo? Kateri problem reši?

## Predlagana implementacija

### Endpoint
- **Ime**: `/api/ai/[ime-funkcije]`
- **Method**: POST (za AI) ali GET (za preproste)
- **Input**: 
  ```json
  { "param1": "...", "param2": 123 }
  ```
- **Output**: 
  ```json
  { "ok": true, "result": { /* ... */ } }
  ```

### AI logika
Kaj naj AI naredi? Kateri podatki iz baze? Kateri prompt?

### Integracija
- Kateri obstoječi endpointi so povezani?
- Kateri UI elementi morajo biti dodani?

## Alternativne rešitve

Katera drugačen pristop si premislil? Zakaj je ta boljša?

## Dodatni kontekst

Screenshot, skice, reference na druge projekte, ipd.

## Checklist

- [ ] Preveril sem, da ta funkcija še ne obstaja
- [ ] Ime endpointa sledi konvenciji (kebab-case)
- [ ] AI prompt je v slovenščini
- [ ] Endpoint bo imel fallback support
