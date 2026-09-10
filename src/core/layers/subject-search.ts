import subjectData from '../../data/subjects.json';
import { normalizeArabic, isArabic } from '../../utils/normalization';
import type {
  VerseInput,
  ScoredVerse,
  AdvancedSearchOptions,
  InvertedIndex,
  SubjectNode,
} from '../../types';

interface SubjectConcept {
  english: string[];
  arabic: string[];
  category?: string;
}

export const buildSubjectMap = (): Map<string, SubjectNode> => {
  const map = new Map<string, SubjectNode>();
  const data = subjectData as SubjectConcept[];

  for (const concept of data) {
    const node: SubjectNode = {
      arabic: concept.arabic,
      english: concept.english,
      category: concept.category,
    };
    for (const word of concept.arabic) {
      const cleanWord = normalizeArabic(word);
      if (cleanWord) {
        map.set(cleanWord, node);
      }
    }

    for (const engWord of concept.english) {
      const cleanWord = engWord.replace(/[^a-zA-Z\s]/g, '').trim();
      if (cleanWord) {
        map.set(cleanWord.toLowerCase(), node);
      }
    }
  }

  return map;
};

export const subjectMap = buildSubjectMap();

interface ResolvedSubjectQuery {
  arabicWords: Set<string>;
  englishWords: string[];
  directTokens: string[];
}

const cleanEnglishToken = (token: string): string =>
  token
    .toLowerCase()
    .trim()
    .replace(/[^a-zA-Z]/g, '');

const expandNode = (node: SubjectNode | undefined, into: Set<string>): void => {
  if (node) {
    node.arabic.forEach((w) => into.add(w));
  }
};

/** Maps the raw query to theme words: full-phrase, Arabic tokens, English tokens. */
export const resolveSubjectQuery = (
  query: string,
  originalQuery: string | undefined,
  subjectMap: Map<string, SubjectNode>,
): ResolvedSubjectQuery => {
  const arabicWords = new Set<string>();
  const englishWords: string[] = [];
  const directTokens: string[] = [];

  if (query) {
    const normalizedQuery = normalizeArabic(query);
    if (normalizedQuery) {
      arabicWords.add(normalizedQuery);
    }
  }

  if (originalQuery) {
    for (const token of originalQuery.split(/\s+/)) {
      if (isArabic(token)) {
        const normalizedArabic = normalizeArabic(token);
        if (normalizedArabic) {
          directTokens.push(normalizedArabic);
          arabicWords.add(normalizedArabic);
          expandNode(subjectMap.get(normalizedArabic), arabicWords);
        }
        continue;
      }
      const cleanToken = cleanEnglishToken(token);
      const node = subjectMap.get(cleanToken);
      if (node) {
        expandNode(node, arabicWords);
        englishWords.push(cleanToken);
      }
    }
  }

  return { arabicWords, englishWords, directTokens };
};

/** Scope filters shared by both candidate paths (sura/juz/sura-name). */
const passesScopeFilter = <TVerse extends VerseInput>(
  verse: TVerse,
  options: AdvancedSearchOptions,
): boolean => {
  if (options.suraId && verse.sura_id !== options.suraId) return false;
  if (options.juzId && verse.juz_id !== options.juzId) return false;
  if (options.suraName && verse.sura_name !== options.suraName) return false;
  return true;
};

const toSubjectHit = <TVerse extends VerseInput>(
  verse: TVerse,
  matchedKeywords: string[],
): ScoredVerse<TVerse> => ({
  ...verse,
  matchType: 'subject',
  matchScore: matchedKeywords.length * 5,
  matchedTokens: matchedKeywords,
});

/** Gathers candidate gids from the subject index, falling back to the word index. */
const collectIndexedGids = (
  words: Set<string>,
  invertedIndex: InvertedIndex,
): Set<number> | null => {
  const { subjectIndex, wordIndex } = invertedIndex;
  const lookup = (index: Map<string, Set<number>>): Set<number> => {
    const gids = new Set<number>();
    for (const word of words) {
      const hits = index.get(word);
      if (hits) {
        for (const gid of hits) {
          gids.add(gid);
        }
      }
    }
    return gids;
  };
  if (subjectIndex) return lookup(subjectIndex);
  if (wordIndex) {
    const gids = new Set<number>();
    for (const word of words) {
      const hits = wordIndex.get(word) || wordIndex.get(normalizeArabic(word));
      if (hits) {
        for (const gid of hits) {
          gids.add(gid);
        }
      }
    }
    return gids;
  }
  return null;
};

const verseContains = (normalizedVerse: string, word: string): boolean =>
  normalizedVerse.includes(word);

/** Verifies one indexed candidate against the verse text. */
const verifyIndexedVerse = <TVerse extends VerseInput>(
  verse: TVerse,
  arabicWords: Set<string>,
  options: AdvancedSearchOptions,
): ScoredVerse<TVerse> | null => {
  if (!passesScopeFilter(verse, options)) return null;
  const normalizedVerse = normalizeArabic(verse.standard);
  const matchedKeywords = Array.from(arabicWords).filter((word) =>
    verseContains(normalizedVerse, word),
  );
  return matchedKeywords.length > 0 ? toSubjectHit(verse, matchedKeywords) : null;
};

/** Scores one verse by linear scan (no usable index). */
const scanVerse = <TVerse extends VerseInput>(
  verse: TVerse,
  resolved: ResolvedSubjectQuery,
  subjectMap: Map<string, SubjectNode>,
  options: AdvancedSearchOptions,
): ScoredVerse<TVerse> | null => {
  if (!passesScopeFilter(verse, options)) return null;
  const normalizedVerse = normalizeArabic(verse.standard);
  const matchedKeywords: string[] = [];

  for (const keyword of resolved.directTokens) {
    if (verseContains(normalizedVerse, keyword)) {
      matchedKeywords.push(keyword);
    }
  }
  for (const engWord of resolved.englishWords) {
    const node = subjectMap.get(engWord);
    if (node) {
      for (const themeWord of node.arabic) {
        if (verseContains(normalizedVerse, themeWord)) {
          matchedKeywords.push(themeWord);
        }
      }
    }
  }
  for (const themeWord of resolved.arabicWords) {
    if (!resolved.directTokens.includes(themeWord) && verseContains(normalizedVerse, themeWord)) {
      matchedKeywords.push(themeWord);
    }
  }

  return matchedKeywords.length > 0 ? toSubjectHit(verse, matchedKeywords) : null;
};

export const performSubjectSearch = <TVerse extends VerseInput>(
  query: string,
  quranData: Map<number, TVerse>,
  options: AdvancedSearchOptions,
  subjectMap?: Map<string, SubjectNode>,
  originalQuery?: string,
  invertedIndex?: InvertedIndex,
): ScoredVerse<TVerse>[] => {
  if (!options.subject || !subjectMap) return [];

  const resolved = resolveSubjectQuery(query, originalQuery, subjectMap);
  if (resolved.arabicWords.size === 0) return [];

  if (invertedIndex) {
    const matchedGids = collectIndexedGids(resolved.arabicWords, invertedIndex);
    if (matchedGids) {
      const results: ScoredVerse<TVerse>[] = [];
      for (const gid of matchedGids) {
        const verse = quranData.get(gid);
        if (!verse) continue;
        const hit = verifyIndexedVerse(verse, resolved.arabicWords, options);
        if (hit) results.push(hit);
      }
      return results;
    }
  }

  const results: ScoredVerse<TVerse>[] = [];
  for (const verse of quranData.values()) {
    const hit = scanVerse(verse, resolved, subjectMap, options);
    if (hit) results.push(hit);
  }
  return results;
};
