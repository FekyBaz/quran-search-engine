import { describe, it, expect } from 'vitest';
import { search } from '../search';
import { buildSubjectMap, performSubjectSearch } from './subject-search';
import { buildInvertedIndex, loadSubjectData } from '../../utils/loader';
import type { QuranText, MorphologyAya, ScoredVerse, SubjectNode } from '../../types';

const weatherNode: SubjectNode = {
  arabic: ['مطر', 'ماء', 'رياح'],
  english: ['weather', 'climate', 'rain', 'water', 'wind'],
  category: 'weather',
};

// Mock data: gid 1 holds ماء, gid 2 holds رياح, gid 3 is off-theme.
const mockQuranData: QuranText[] = [
  {
    gid: 1,
    uthmani: 'وَأَنزَلْنَا مِنَ ٱلسَّمَآءِ مَآءً',
    standard: 'وانزلنا من السماء ماء',
    sura_id: 23,
    aya_id: 18,
    aya_id_display: '18',
    page_id: 343,
    juz_id: 18,
    standard_full: 'وَأَنزَلْنَا مِنَ السَّمَاءِ مَاءً',
    sura_name: 'المؤمنون',
    sura_name_en: 'The Believers',
    sura_name_romanization: "Al-Mu'minun",
  },
  {
    gid: 2,
    uthmani: 'وَهُوَ ٱلَّذِى يُرْسِلُ ٱلرِّيَٰحَ بُشْرًۢا',
    standard: 'وهو الذي يرسل الرياح بشرا',
    sura_id: 7,
    aya_id: 57,
    aya_id_display: '57',
    page_id: 157,
    juz_id: 8,
    standard_full: 'وَهُوَ الَّذِي يُرْسِلُ الرِّيَاحَ بُشْرًا',
    sura_name: 'الأعراف',
    sura_name_en: 'The Heights',
    sura_name_romanization: "Al-A'raf",
  },
  {
    gid: 3,
    uthmani: 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ',
    standard: 'الحمد لله رب العالمين',
    sura_id: 1,
    aya_id: 2,
    aya_id_display: '2',
    page_id: 1,
    juz_id: 1,
    standard_full: 'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ',
    sura_name: 'الفاتحة',
    sura_name_en: 'The Opening',
    sura_name_romanization: 'Al-Fatihah',
  },
];

const mockQuranDataMap = new Map((mockQuranData as QuranText[]).map((v) => [v.gid, v]));
const mockMorphologyMap = new Map<number, MorphologyAya>();
const mockWordMapMap = new Map<string, { lemma?: string; root?: string }>();

const mockSubjectMap = new Map<string, SubjectNode>([
  ['مطر', weatherNode],
  ['ماء', weatherNode],
  ['رياح', weatherNode],
  ['weather', weatherNode],
  ['climate', weatherNode],
]);

const baseContext = {
  quranData: mockQuranDataMap,
  morphologyMap: mockMorphologyMap,
  wordMap: mockWordMapMap,
  subjectMap: mockSubjectMap,
};

describe('Subject Search (refs #89)', () => {
  it('expands an Arabic theme word to its subject siblings', () => {
    const result = search('مطر', baseContext, { lemma: true, root: true, subject: true });

    // Neither verse contains مطر itself; both are found via the theme.
    const gids = result.results.map((r: ScoredVerse<QuranText>) => r.gid);
    expect(gids).toContain(1);
    expect(gids).toContain(2);
    expect(gids).not.toContain(3);
    expect(result.results.every((r) => r.matchType === 'subject')).toBe(true);
    expect(result.counts.subject).toBe(2);
  });

  it('resolves an English theme keyword with zero synonym hits', () => {
    const result = search('climate', baseContext, { lemma: true, root: true, subject: true });

    const gids = result.results.map((r: ScoredVerse<QuranText>) => r.gid);
    expect(gids).toContain(1);
    expect(gids).toContain(2);
    expect(result.counts.subject).toBeGreaterThan(0);
  });

  it('stays off unless options.subject is set', () => {
    const result = search('مطر', baseContext, { lemma: true, root: true });

    expect(result.counts.subject).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  it('stays off when no subjectMap is provided', () => {
    const contextWithoutMap = {
      quranData: baseContext.quranData,
      morphologyMap: baseContext.morphologyMap,
      wordMap: baseContext.wordMap,
    };
    const result = search('مطر', contextWithoutMap, { lemma: true, root: true, subject: true });

    expect(result.counts.subject).toBe(0);
  });

  it('uses subjectIndex when an inverted index is present', () => {
    const invertedIndex = buildInvertedIndex(
      mockMorphologyMap,
      mockQuranDataMap,
      undefined,
      mockSubjectMap,
    );
    expect(invertedIndex.subjectIndex?.size).toBeGreaterThan(0);

    const result = search(
      'climate',
      { ...baseContext, invertedIndex },
      { lemma: true, root: true, subject: true },
    );

    const gids = result.results.map((r: ScoredVerse<QuranText>) => r.gid);
    expect(gids).toContain(1);
    expect(gids).toContain(2);
    expect(result.counts.subject).toBeGreaterThan(0);
  });

  it('performs a direct layer call with the same theme expansion', () => {
    const matches = performSubjectSearch(
      'مطر',
      mockQuranDataMap,
      { lemma: false, root: false, subject: true },
      mockSubjectMap,
      'مطر',
    );

    expect(matches.map((m) => m.gid).sort()).toEqual([1, 2]);
    expect(matches.every((m) => m.matchType === 'subject')).toBe(true);
  });

  it('ships a seed subjects.json addressing the weather theme', () => {
    const map = buildSubjectMap();
    const node = map.get('climate');

    expect(node).toBeDefined();
    expect(node?.arabic).toContain('مطر');
    expect(node?.category).toBe('weather');
  });

  it('loads the seed data through loadSubjectData()', async () => {
    const map = await loadSubjectData();

    expect(map.get('climate')?.arabic).toContain('رياح');
    expect(map.get('صلاة')?.category).toBe('worship');
  });
});
