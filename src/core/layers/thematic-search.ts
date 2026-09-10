import { normalizeArabic, isArabic } from '../../utils/normalization';
import type { VerseInput, ScoredVerse, AdvancedSearchOptions, MatchType } from '../../types';

/**
 * Shared engine for theme-expansion search layers (semantic synonyms and
 * subject themes). Both layers expand query tokens to Arabic word sets and
 * score verses containing them; only the word source, the inverted index and
 * the resulting `matchType` differ.
 */
export interface ThematicSource {
  /** Theme words for a normalized Arabic token, if it addresses a theme. */
  expandArabic(normalizedWord: string): readonly string[] | undefined;
  /** Theme words for a cleaned English token, if it addresses a theme. */
  expandEnglish(cleanToken: string): readonly string[] | undefined;
}

export interface ResolvedThematicQuery {
  arabicWords: Set<string>;
  englishWords: string[];
  directTokens: string[];
}

const cleanEnglishToken = (token: string): string =>
  token
    .toLowerCase()
    .trim()
    .replace(/[^a-zA-Z]/g, '');

const expandInto = (words: readonly string[] | undefined, into: Set<string>): void => {
  if (words) {
    words.forEach((w) => into.add(w));
  }
};

/** Maps the raw query to theme words: full-phrase, Arabic tokens, English tokens. */
export const resolveThematicQuery = (
  query: string,
  originalQuery: string | undefined,
  source: ThematicSource,
): ResolvedThematicQuery => {
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
          expandInto(source.expandArabic(normalizedArabic), arabicWords);
        }
        continue;
      }
      const cleanToken = cleanEnglishToken(token);
      const themeWords = source.expandEnglish(cleanToken);
      if (themeWords) {
        expandInto(themeWords, arabicWords);
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

const toThematicHit = <TVerse extends VerseInput>(
  verse: TVerse,
  matchType: MatchType,
  matchedKeywords: string[],
): ScoredVerse<TVerse> => ({
  ...verse,
  matchType,
  matchScore: matchedKeywords.length * 5,
  matchedTokens: matchedKeywords,
});

/**
 * Gathers candidate gids from the theme index, falling back to the word
 * index. Returns null when no index is available (caller scans linearly).
 */
const collectIndexedGids = (
  words: Set<string>,
  themeIndex: Map<string, Set<number>> | undefined,
  wordIndex: Map<string, Set<number>> | undefined,
): Set<number> | null => {
  const union = (lookup: (word: string) => Set<number> | undefined): Set<number> => {
    const gids = new Set<number>();
    for (const word of words) {
      const hits = lookup(word);
      if (hits) {
        for (const gid of hits) {
          gids.add(gid);
        }
      }
    }
    return gids;
  };
  if (themeIndex) return union((word) => themeIndex.get(word));
  if (wordIndex) {
    return union((word) => wordIndex.get(word) || wordIndex.get(normalizeArabic(word)));
  }
  return null;
};

const verseContains = (normalizedVerse: string, word: string): boolean =>
  normalizedVerse.includes(word);

/** Verifies one indexed candidate against the verse text. */
const verifyIndexedVerse = <TVerse extends VerseInput>(
  verse: TVerse,
  matchType: MatchType,
  arabicWords: Set<string>,
  options: AdvancedSearchOptions,
): ScoredVerse<TVerse> | null => {
  if (!passesScopeFilter(verse, options)) return null;
  const normalizedVerse = normalizeArabic(verse.standard);
  const matchedKeywords = Array.from(arabicWords).filter((word) =>
    verseContains(normalizedVerse, word),
  );
  return matchedKeywords.length > 0 ? toThematicHit(verse, matchType, matchedKeywords) : null;
};

const collectDirectKeywords = (normalizedVerse: string, directTokens: string[]): string[] => {
  const matched: string[] = [];
  for (const keyword of directTokens) {
    if (verseContains(normalizedVerse, keyword)) {
      matched.push(keyword);
    }
  }
  return matched;
};

const collectEnglishKeywords = (
  normalizedVerse: string,
  englishWords: string[],
  source: ThematicSource,
): string[] => {
  const matched: string[] = [];
  for (const engWord of englishWords) {
    for (const themeWord of source.expandEnglish(engWord) ?? []) {
      if (verseContains(normalizedVerse, themeWord)) {
        matched.push(themeWord);
      }
    }
  }
  return matched;
};

const collectThemeKeywords = (
  normalizedVerse: string,
  arabicWords: Set<string>,
  directTokens: string[],
): string[] => {
  const matched: string[] = [];
  for (const themeWord of arabicWords) {
    if (!directTokens.includes(themeWord) && verseContains(normalizedVerse, themeWord)) {
      matched.push(themeWord);
    }
  }
  return matched;
};

/** Collects every theme keyword a verse contains (linear scan, no index). */
const collectScanKeywords = <TVerse extends VerseInput>(
  verse: TVerse,
  resolved: ResolvedThematicQuery,
  source: ThematicSource,
): string[] => {
  const normalizedVerse = normalizeArabic(verse.standard);
  return [
    ...collectDirectKeywords(normalizedVerse, resolved.directTokens),
    ...collectEnglishKeywords(normalizedVerse, resolved.englishWords, source),
    ...collectThemeKeywords(normalizedVerse, resolved.arabicWords, resolved.directTokens),
  ];
};

/** Scores one verse by linear scan (no usable index). */
const scanVerse = <TVerse extends VerseInput>(
  verse: TVerse,
  matchType: MatchType,
  resolved: ResolvedThematicQuery,
  source: ThematicSource,
  options: AdvancedSearchOptions,
): ScoredVerse<TVerse> | null => {
  if (!passesScopeFilter(verse, options)) return null;
  const matchedKeywords = collectScanKeywords(verse, resolved, source);
  return matchedKeywords.length > 0 ? toThematicHit(verse, matchType, matchedKeywords) : null;
};

export const performThematicSearch = <TVerse extends VerseInput>(args: {
  query: string;
  quranData: Map<number, TVerse>;
  options: AdvancedSearchOptions;
  source: ThematicSource;
  matchType: 'semantic' | 'subject';
  originalQuery?: string;
  themeIndex?: Map<string, Set<number>>;
  wordIndex?: Map<string, Set<number>>;
}): ScoredVerse<TVerse>[] => {
  const { query, quranData, options, source, matchType, originalQuery, themeIndex, wordIndex } =
    args;
  const resolved = resolveThematicQuery(query, originalQuery, source);
  if (resolved.arabicWords.size === 0) return [];

  const matchedGids = collectIndexedGids(resolved.arabicWords, themeIndex, wordIndex);
  if (matchedGids) {
    const results: ScoredVerse<TVerse>[] = [];
    for (const gid of matchedGids) {
      const verse = quranData.get(gid);
      if (!verse) continue;
      const hit = verifyIndexedVerse(verse, matchType, resolved.arabicWords, options);
      if (hit) results.push(hit);
    }
    return results;
  }

  const results: ScoredVerse<TVerse>[] = [];
  for (const verse of quranData.values()) {
    const hit = scanVerse(verse, matchType, resolved, source, options);
    if (hit) results.push(hit);
  }
  return results;
};
