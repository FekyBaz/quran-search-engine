# Subject & Multi-Word Search Guide

> Note: subject mode (`options.subject`) was added in PR #112 — use a version that includes it.

## Overview

This guide covers two ways to search beyond a single literal query:

- **Subject search** — one query word expands to a whole theme (weather, worship, …).
- **Multi-word array search** — several independent terms run through the full pipeline and merge by verse.

## Subject Graphs vs the Synonym Map

`semantic: true` expands a word through `src/data/semantic.json`, a flat list of same-meaning synonyms: `إنسان` also
finds `بشر`. When no synonym exists, the query returns nothing.

A subject graph (`src/data/subjects.json`) instead groups **topically related** lemmas under one theme node. The seed
ships five themes — `weather`, `worship`, `family`, `sustenance`, `celestial` — each node carrying the English keywords
that address it plus the Arabic theme words:

```json
{
  "english": ["weather", "climate", "rain", "wind", "storm", "cloud", "thunder", "lightning"],
  "arabic": ["مطر", "أمطار", "غيث", "رياح", "عواصف", "سحاب", "رعد", "برق", "صواعق"],
  "category": "weather"
}
```

Searching `climate` with `{ subject: true }` therefore returns verses containing `سحاب`, `الرياح`, `رعد`, `برق` — words
that are weather-related without being synonyms of each other.

## Loading, Enriching, and Reloading Subjects

Load the seed once and put it on the search context:

```ts
import {
  search,
  loadQuranData,
  loadMorphology,
  loadWordMap,
  loadSubjectData,
  buildInvertedIndex,
} from 'quran-search-engine';

const [quranData, morphologyMap, wordMap] = await Promise.all([
  loadQuranData(),
  loadMorphology(),
  loadWordMap(),
]);
const subjectMap = await loadSubjectData();
const invertedIndex = buildInvertedIndex(morphologyMap, quranData, undefined, subjectMap);
const context = { quranData, morphologyMap, wordMap, invertedIndex, subjectMap };
```

To enrich the graph, extend `src/data/subjects.json` with your own theme nodes (same shape: `english`, `arabic`,
optional `category`), then reload — `loadSubjectData()` re-reads the file on every call — and rebuild the inverted
index so `subjectIndex` picks up the new words:

```ts
const subjectMap = await loadSubjectData(); // re-reads subjects.json
const invertedIndex = buildInvertedIndex(morphologyMap, quranData, undefined, subjectMap);
```

You can also bypass the file entirely with a hand-built map, which is handy for user-defined themes at runtime:

```ts
import type { SubjectNode } from 'quran-search-engine';

const myThemes = new Map<string, SubjectNode>([
  [
    'sea',
    { arabic: ['بحر', 'موج', 'سفينة'], english: ['sea', 'ocean', 'ship'], category: 'sea' },
  ],
]);
```

Then search with the flag:

```ts
const response = search('climate', context, { lemma: true, root: true, subject: true });
// response.results[0].matchType === 'subject'
```

## Side-by-Side: `climate` With Synonyms vs Subjects

```ts
// Synonyms only: 'climate' has no entry in semantic.json → zero hits.
const synonyms = search('climate', context, { lemma: true, root: true, semantic: true });
console.log(synonyms.pagination.totalResults); // 0

// Subjects: the weather theme expands 'climate' → 34 weather-themed verses.
const themed = search('climate', context, { lemma: true, root: true, subject: true });
console.log(themed.pagination.totalResults); // 34
console.log(themed.counts.subject); // 34
// Hits include 24:43 (سحابا), 30:48 (الرياح … سحابا), 2:19 (رعد وبرق)
```

## Multi-Word Array API and Ranking Modes

Pass an array and each term runs through the full `search()` pipeline independently; hits merge by verse `gid`:

```ts
const response = search(
  ['muhammad', 'yunus', 'ibrahim'],
  context,
  { lemma: true, root: true },
  { rankBy: 'coverage', limit: 10 },
);
```

Every merged verse carries aggregation metadata:

- `matchedTerms` — which of your terms hit this verse.
- `distinctTermCount` — how many distinct terms hit it.
- `totalFrequency` — total matched-token hits across terms.

`rankBy` selects the ordering (ties always fall back to `matchScore`):

| Mode | Orders by | Best for |
| ---- | --------- | -------- |
| `score` (default) | summed per-term `matchScore` | best single match overall |
| `coverage` | `distinctTermCount`, then score | verses covering the most terms |
| `frequency` | `totalFrequency`, then score | verses mentioning terms most often |

Options are forwarded to every per-term search, so filters and flags compose: `{ subject: true, suraId: 2 }` runs a
themed, sura-scoped search per term.

## Worked Example: AI Pipeline to Coverage Ranking

A pipeline (entity extraction, translation, theme detection) produces a term list; rank for breadth with `coverage`:

```ts
// Step 1: the AI pipeline emits independent search terms.
const terms = ['muhammad', 'yunus', 'ibrahim'];

// Step 2: run them as one multi-word search, ranking verses that cover
// the most terms first.
const response = search(terms, context, { lemma: true, root: true }, { rankBy: 'coverage' });

// Step 3: read which terms each verse covers.
for (const verse of response.results.slice(0, 5)) {
  console.log(`${verse.sura_id}:${verse.aya_id} covers ${verse.distinctTermCount} terms`, verse.matchedTerms);
}
```

Swap `rankBy` to `'score'` when you want the single strongest hit, or `'frequency'` when repeated mentions matter more
than breadth.
