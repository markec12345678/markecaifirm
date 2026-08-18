// v8.94: Tests za AI JSON parser (parseJsonLooseExported iz lib/ai.ts).
//
// parseJsonLoose je KLJUČEN za celoten sistem — vsi 432 AI endpointi
// ga uporabljajo za parsanje AI odgovorov. LLM-ji pogosto vračajo:
// - JSON v ```json ... ``` code fences
// - JSON z dodatnim tekstom pred/za
// - JSON z trailing commas (invalid)
// - JSON z narobe postavljenimi narekovaji
//
// Parser mora biti robusten — nikoli ne sme throw-atiti (endpointi
// ne smejo crashati zaradi slabega AI odgovora).
//
// Pokrivamo:
// 1. Valid JSON (pass-through)
// 2. JSON v code fences (```json ... ```)
// 3. JSON z tekstom pred/za
// 4. Prazni / null input
// 5. Invalid JSON (vrne null, ne throw)
// 6. Realni LLM output primeri
// 7. Edge cases: nested objects, arrays, strings z narekovaji

import { describe, it, expect } from 'vitest';
import { parseJsonLooseExported } from '../../src/lib/ai';

describe('ai — parseJsonLooseExported', () => {
  // --- Valid JSON (pass-through) ---

  describe('valid JSON', () => {
    it('parses simple object', () => {
      const result = parseJsonLooseExported('{"a": 1, "b": "test"}');
      expect(result).toEqual({ a: 1, b: 'test' });
    });

    it('parses object z array value', () => {
      const result = parseJsonLooseExported('{"items": [1, 2, 3]}');
      expect(result).toEqual({ items: [1, 2, 3] });
    });

    it('parses nested object', () => {
      const result = parseJsonLooseExported('{"outer": {"inner": {"deep": true}}}');
      expect(result).toEqual({ outer: { inner: { deep: true } } });
    });

    it('parses object z boolean in null', () => {
      const result = parseJsonLooseExported('{"active": true, "disabled": false, "empty": null}');
      expect(result).toEqual({ active: true, disabled: false, empty: null });
    });

    it('parses object z float', () => {
      const result = parseJsonLooseExported('{"price": 19.99, "tax": 0.22}');
      expect(result).toEqual({ price: 19.99, tax: 0.22 });
    });

    it('parses object z negativnim številom', () => {
      const result = parseJsonLooseExported('{"score": -50}');
      expect(result).toEqual({ score: -50 });
    });

    it('parses object z stringom ki vsebuje narekovaje', () => {
      const result = parseJsonLooseExported('{"msg": "hello \\"world\\""}');
      expect(result).toEqual({ msg: 'hello "world"' });
    });

    it('parses object z newlines v stringu', () => {
      const result = parseJsonLooseExported('{"text": "line1\\nline2"}');
      expect(result).toEqual({ text: 'line1\nline2' });
    });
  });

  // --- JSON v code fences ---

  describe('JSON v code fences (```json ... ```)', () => {
    it('parses JSON z ```json prefix', () => {
      const input = '```json\n{"verdict": "PRILIKA", "score": 8}\n```';
      const result = parseJsonLooseExported(input);
      expect(result).toEqual({ verdict: 'PRILIKA', score: 8 });
    });

    it('parses JSON z ``` (brez json oznake)', () => {
      const input = '```\n{"verdict": "OK"}\n```';
      const result = parseJsonLooseExported(input);
      expect(result).toEqual({ verdict: 'OK' });
    });

    it('parses JSON z code fences in tekstom pred', () => {
      const input = 'Tu je odgovor:\n```json\n{"x": 1}\n```\nUpam da pomaga.';
      const result = parseJsonLooseExported(input);
      expect(result).toEqual({ x: 1 });
    });

    it('parses JSON z code fences in whitespace', () => {
      const input = '  ```json\n  {"y": 2}  \n```  ';
      const result = parseJsonLooseExported(input);
      expect(result).toEqual({ y: 2 });
    });
  });

  // --- JSON z tekstom pred/za ---

  describe('JSON z additional text', () => {
    it('parses JSON z besedilom pred', () => {
      const input = 'Odgovor je:\n{"verdict": "PRILIKA"}';
      const result = parseJsonLooseExported(input);
      expect(result).toEqual({ verdict: 'PRILIKA' });
    });

    it('parses JSON z besedilom za', () => {
      const input = '{"verdict": "PRILIKA"}\nTo je moj odgovor.';
      const result = parseJsonLooseExported(input);
      expect(result).toEqual({ verdict: 'PRILIKA' });
    });

    it('parses JSON z besedilom pred in za', () => {
      const input = 'Tukaj je JSON:\n{"score": 7}\nUpam da je prav.';
      const result = parseJsonLooseExported(input);
      expect(result).toEqual({ score: 7 });
    });

    it('parses JSON z multi-line besedilom okoli', () => {
      const input = `
Analiza:

{"deal_score": 85, "reason": "Dobra cena"}

Hvala.
`;
      const result = parseJsonLooseExported(input);
      expect(result).toEqual({ deal_score: 85, reason: 'Dobra cena' });
    });

    it('vzame vse od PRVEGA { do ZADNJEGA } (limitation: ne podpira več objektov)', () => {
      // POZNANO LIMITATION: parser uporablja indexOf('{') in lastIndexOf('}')
      // → za input z dvema objektoma vzame VSE vmes (vključno z besedilom)
      // → rezultat je invalid JSON → vrne null.
      // Caller mora poskrbeti, da AI vrne SAMO EN objekt.
      const input = '{"first": 1} nek tekst {"second": 2}';
      const result = parseJsonLooseExported(input);
      expect(result).toBeNull();
    });
  });

  // --- Empty / null input ---

  describe('empty in null input', () => {
    it('vrne null za prazen string', () => {
      expect(parseJsonLooseExported('')).toBeNull();
    });

    it('vrne null za whitespace-only string', () => {
      expect(parseJsonLooseExported('   \n\t  ')).toBeNull();
    });

    it('vrne null za string brez { }', () => {
      expect(parseJsonLooseExported('samo tekst brez json-a')).toBeNull();
    });

    it('vrne null za "null" string (valid JSON null = our error value)', () => {
      // "null" JE valid JSON — JSON.parse("null") vrne null.
      // To je konflikt: null je tako "valid JSON null" kot "error return".
      // Parser vrne null v obeh primerih — caller mora preverjati
      // ali je rezultat non-null pred uporabo.
      expect(parseJsonLooseExported('null')).toBeNull();
    });

    it('vrne primitivne vrednosti za "true" / "false" / "42" (valid JSON)', () => {
      // Parser je loose — vrne karkoli kar je valid JSON.
      // Caller je odgovoren za preverjanje tipa rezultata.
      expect(parseJsonLooseExported('true')).toBe(true);
      expect(parseJsonLooseExported('false')).toBe(false);
      expect(parseJsonLooseExported('42')).toBe(42);
    });
  });

  // --- Invalid JSON (ne sme throw) ---

  describe('invalid JSON (graceful null)', () => {
    it('ne throw-a za invalid JSON', () => {
      expect(() => parseJsonLooseExported('{invalid json}')).not.toThrow();
    });

    it('vrne null za invalid JSON', () => {
      expect(parseJsonLooseExported('{invalid json}')).toBeNull();
    });

    it('ne throw-a za truncated JSON', () => {
      expect(() => parseJsonLooseExported('{"a": 1, "b":')).not.toThrow();
    });

    it('ne throw-a za narekovaje v narekovajih brez escape', () => {
      expect(() => parseJsonLooseExported('{"msg": "hello "world""}')).not.toThrow();
    });

    it('ne throw-a za samo odprt {', () => {
      expect(() => parseJsonLooseExported('{')).not.toThrow();
    });

    it('ne throw-a za samo zaprt }', () => {
      expect(() => parseJsonLooseExported('}')).not.toThrow();
    });
  });

  // --- Realni LLM output primeri ---

  describe('realni LLM output primeri', () => {
    it('parses Bolha listing evaluation', () => {
      const llmOutput = `{
        "prilika": true,
        "ocena_tveganja": 2,
        "ocena_prilike": 8,
        "razlog": "iPhone 13 Pro za 350€ je pod tržno (realna vrednost ~600€).",
        "predvidena_trzna_vrednost": 600,
        "verdict": "PRILIKA",
        "image_analysis": "Realna amaterska fotografija",
        "image_verdict": "AUTHENTIC"
      }`;
      const result = parseJsonLooseExported(llmOutput);
      expect(result).toEqual({
        prilika: true,
        ocena_tveganja: 2,
        ocena_prilike: 8,
        razlog: 'iPhone 13 Pro za 350€ je pod tržno (realna vrednost ~600€).',
        predvidena_trzna_vrednost: 600,
        verdict: 'PRILIKA',
        image_analysis: 'Realna amaterska fotografija',
        image_verdict: 'AUTHENTIC',
      });
    });

    it('parses deal score output', () => {
      const llmOutput = '{"deal_score": 85, "reason": "Cena 20% pod tržno, dobro stanje"}';
      const result = parseJsonLooseExported(llmOutput);
      expect(result).toEqual({ deal_score: 85, reason: 'Cena 20% pod tržno, dobro stanje' });
    });

    it('parses output z LLM uvodnim tekstom (ChatGPT-style)', () => {
      const llmOutput = `Tukaj je moja analiza oglasa:

\`\`\`json
{
  "verdict": "SUMNJIVO",
  "ocena_tveganja": 7,
  "razlog": "Nuja prodaja, plačilo predračun"
}
\`\`\`

Če potrebuješ še kaj, povej.`;
      const result = parseJsonLooseExported(llmOutput);
      expect(result).toEqual({
        verdict: 'SUMNJIVO',
        ocena_tveganja: 7,
        razlog: 'Nuja prodaja, plačilo predračun',
      });
    });

    it('parses output z array of objects (issues)', () => {
      const llmOutput = `{
        "issues": [
          {"type": "jargon", "severity": "medium", "description": "Preveč žargonov"},
          {"type": "long_sentences", "severity": "low", "description": "Predolg stavek"}
        ],
        "score": 65
      }`;
      const result = parseJsonLooseExported(llmOutput);
      expect(result).toEqual({
        issues: [
          { type: 'jargon', severity: 'medium', description: 'Preveč žargonov' },
          { type: 'long_sentences', severity: 'low', description: 'Predolg stavek' },
        ],
        score: 65,
      });
    });

    it('parses output z unicode (slovenski znaki)', () => {
      const llmOutput = '{"reason": "Čudovita priložnost — nujno!"}';
      const result = parseJsonLooseExported(llmOutput);
      expect(result).toEqual({ reason: 'Čudovita priložnost — nujno!' });
    });

    it('parses output z velikimi števili', () => {
      const llmOutput = '{"market_value": 1500000, "count": 1000000}';
      const result = parseJsonLooseExported(llmOutput);
      expect(result).toEqual({ market_value: 1500000, count: 1000000 });
    });

    it('parses output z decimalnimi verjetnostmi', () => {
      const llmOutput = '{"probability": 0.85, "confidence": 0.92}';
      const result = parseJsonLooseExported(llmOutput);
      expect(result).toEqual({ probability: 0.85, confidence: 0.92 });
    });

    it('parses output z negativnim sentiment score', () => {
      const llmOutput = '{"sentiment_score": -75, "sentiment": "negative"}';
      const result = parseJsonLooseExported(llmOutput);
      expect(result).toEqual({ sentiment_score: -75, sentiment: 'negative' });
    });
  });

  // --- Edge cases ---

  describe('edge cases', () => {
    it('parses minimal object {}', () => {
      expect(parseJsonLooseExported('{}')).toEqual({});
    });

    it('parses object z eno ključ-vrednost par', () => {
      expect(parseJsonLooseExported('{"k": "v"}')).toEqual({ k: 'v' });
    });

    it('parses object z veliko whitespace', () => {
      const input = '{\n  "a": 1,\n  "b": 2\n}';
      expect(parseJsonLooseExported(input)).toEqual({ a: 1, b: 2 });
    });

    it('parses object z komenti (non-standard, neki LLM-ji)', () => {
      // JSON5 stil — neki LLM-ji dodajo komentarje
      // Standard JSON.parse ne podpira, ampak parser proba
      const input = '{\n  "a": 1 // komentar\n}';
      // To ni valid JSON — vrne null
      expect(parseJsonLooseExported(input)).toBeNull();
    });

    it('vzame ZADNJI } kot konec (ignorira tekst vmes)', () => {
      const input = '{"a": {"nested": true}, "b": 2}';
      const result = parseJsonLooseExported(input);
      expect(result).toEqual({ a: { nested: true }, b: 2 });
    });

    it('parses object kjer value vsebuje }', () => {
      const input = '{"msg": "uporabi } simbol"}';
      const result = parseJsonLooseExported(input);
      expect(result).toEqual({ msg: 'uporabi } simbol' });
    });
  });

  // --- Consistency (parseJsonLooseExported ne throw-a za NIC) ---

  describe('robustnost — nikoli ne throw', () => {
    const weirdInputs = [
      '',
      '   ',
      '\n\t\r',
      'null',
      'undefined',
      'NaN',
      'Infinity',
      '{}',
      '{ }',
      '{}}',
      '{{}',
      '{',
      '}',
      '{"a"}',
      '{"a":}',
      '{,}',
      '{"a":1,}',
      '[]',
      '[1, 2, 3]',
      '"string"',
      '42',
      'true',
      'false',
      Buffer.from([0x00, 0x01, 0x02]).toString(), // binary garbage
      '🤖'.repeat(1000),
      'a'.repeat(100000),
    ];

    for (const input of weirdInputs) {
      it(`ne throw-a za input: ${JSON.stringify(input).slice(0, 50)}`, () => {
        expect(() => parseJsonLooseExported(input)).not.toThrow();
      });
    }
  });
});
