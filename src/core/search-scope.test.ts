import { describe, it, expect } from 'vitest';
import { search } from './search';
import type { QuranText, MorphologyAya } from '../types';

// Multi-sura mocks mirroring issue #94: "الرحمن" occurs in both
// sura 1 (الفاتحة) and sura 55 (الرحمن); a sura filter must narrow results.
const mockVerses: QuranText[] = [
  {
    gid: 1,
    uthmani: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ',
    standard: 'بسم الله الرحمن الرحيم',
    sura_id: 1,
    aya_id: 1,
    aya_id_display: '1',
    page_id: 1,
    juz_id: 1,
    standard_full: 'بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ',
    sura_name: 'الفاتحة',
    sura_name_en: 'The Opening',
    sura_name_romanization: 'Al-Fatihah',
  },
  {
    gid: 3,
    uthmani: 'ٱلرَّحْمَٰنِ ٱلرَّحِيمِ',
    standard: 'الرحمن الرحيم',
    sura_id: 1,
    aya_id: 3,
    aya_id_display: '3',
    page_id: 1,
    juz_id: 1,
    standard_full: 'الرَّحْمَنِ الرَّحِيمِ',
    sura_name: 'الفاتحة',
    sura_name_en: 'The Opening',
    sura_name_romanization: 'Al-Fatihah',
  },
  {
    gid: 4901,
    uthmani: 'ٱلرَّحْمَٰنُ',
    standard: 'الرحمن',
    sura_id: 55,
    aya_id: 1,
    aya_id_display: '1',
    page_id: 533,
    juz_id: 27,
    standard_full: 'الرَّحْمَنُ',
    sura_name: 'الرحمن',
    sura_name_en: 'The Most Gracious',
    sura_name_romanization: 'Ar-Rahman',
  },
];

const mockData = new Map(mockVerses.map((v) => [v.gid, v]));

const mockMorphology = new Map<number, MorphologyAya>([
  [
    1,
    {
      gid: 1,
      lemmas: ['بسم', 'الله', 'الرحمن', 'الرحيم'],
      roots: ['ب س م', 'ا ل ه', 'ر ح م', 'ر ح م'],
    },
  ],
  [3, { gid: 3, lemmas: ['الرحمن', 'الرحيم'], roots: ['ر ح م', 'ر ح م'] }],
  [4901, { gid: 4901, lemmas: ['الرحمن'], roots: ['ر ح م'] }],
]);

const mockWordMap = new Map(Object.entries({ الرحمن: { lemma: 'الرحمن', root: 'ر ح م' } }));

const context = { quranData: mockData, morphologyMap: mockMorphology, wordMap: mockWordMap };

describe('search() scope filters (refs #94)', () => {
  it('finds matches in every sura when no filter is given', () => {
    const result = search('الرحمن', context, { lemma: true, root: true });
    const suraIds = new Set(result.results.map((v) => v.sura_id));
    expect(suraIds.has(1)).toBe(true);
    expect(suraIds.has(55)).toBe(true);
  });

  it('narrows text search to the requested suraName', () => {
    const result = search('الرحمن', context, { lemma: true, root: true, suraName: 'الفاتحة' });
    expect(result.results.length).toBeGreaterThan(0);
    for (const verse of result.results) {
      expect(verse.sura_id).toBe(1);
    }
  });

  it('narrows text search to the requested suraId', () => {
    const result = search('الرحمن', context, { lemma: true, root: true, suraId: 55 });
    expect(result.results.length).toBeGreaterThan(0);
    for (const verse of result.results) {
      expect(verse.sura_id).toBe(55);
    }
  });

  it('narrows text search to the requested juzId', () => {
    const result = search('الرحمن', context, { lemma: true, root: true, juzId: 27 });
    expect(result.results.length).toBeGreaterThan(0);
    for (const verse of result.results) {
      expect(verse.juz_id).toBe(27);
    }
  });

  it('returns empty results (not an error) when the filter matches nothing', () => {
    const result = search('الرحمن', context, { lemma: true, root: true, suraId: 114 });
    expect(result.results).toHaveLength(0);
    expect(result.pagination.totalResults).toBe(0);
  });
});
