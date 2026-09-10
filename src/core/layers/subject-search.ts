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

export const performSubjectSearch = <TVerse extends VerseInput>(
  query: string,
  quranData: Map<number, TVerse>,
  options: AdvancedSearchOptions,
  subjectMap?: Map<string, SubjectNode>,
  originalQuery?: string,
  invertedIndex?: InvertedIndex,
): ScoredVerse<TVerse>[] => {
  if (!options.subject || !subjectMap) return [];

  const matchedArabicWords = new Set<string>();
  const matchedEnglishWords: string[] = [];
  const directArabicTokens: string[] = [];

  if (query) {
    const normalizedQuery = normalizeArabic(query);
    if (normalizedQuery) {
      matchedArabicWords.add(normalizedQuery);
    }
  }

  if (originalQuery) {
    const tokens = originalQuery.split(/\s+/);
    for (const token of tokens) {
      if (isArabic(token)) {
        const normalizedArabic = normalizeArabic(token);
        if (normalizedArabic) {
          directArabicTokens.push(normalizedArabic);
          matchedArabicWords.add(normalizedArabic);
          const node = subjectMap.get(normalizedArabic);
          if (node) {
            node.arabic.forEach((w) => matchedArabicWords.add(w));
          }
        }
        continue;
      }

      const cleanToken = token
        .toLowerCase()
        .trim()
        .replace(/[^a-zA-Z]/g, '');
      const node = subjectMap.get(cleanToken);
      if (node) {
        node.arabic.forEach((w) => matchedArabicWords.add(w));
        matchedEnglishWords.push(cleanToken);
      }
    }
  }

  if (matchedArabicWords.size === 0) return [];

  const subjectIndex = invertedIndex?.subjectIndex;
  const wordIndex = invertedIndex?.wordIndex;
  const results: ScoredVerse<TVerse>[] = [];
  const matchedGids = new Set<number>();

  if (subjectIndex) {
    for (const word of matchedArabicWords) {
      const gids = subjectIndex.get(word);
      if (gids) {
        for (const gid of gids) {
          matchedGids.add(gid);
        }
      }
    }
  } else if (wordIndex) {
    for (const word of matchedArabicWords) {
      const gids = wordIndex.get(word) || wordIndex.get(normalizeArabic(word));
      if (gids) {
        for (const gid of gids) {
          matchedGids.add(gid);
        }
      }
    }
  } else {
    for (const verse of quranData.values()) {
      if (options.suraId && verse.sura_id !== options.suraId) continue;
      if (options.juzId && verse.juz_id !== options.juzId) continue;
      if (options.suraName && verse.sura_name !== options.suraName) continue;

      const normalizedVerse = normalizeArabic(verse.standard);
      const matchedKeywords: string[] = [];

      if (directArabicTokens.length > 0) {
        for (const keyword of directArabicTokens) {
          if (normalizedVerse.includes(keyword)) {
            matchedKeywords.push(keyword);
          }
        }
      }

      if (matchedEnglishWords.length > 0) {
        for (const engWord of matchedEnglishWords) {
          const node = subjectMap.get(engWord);
          if (node) {
            for (const themeWord of node.arabic) {
              if (normalizedVerse.includes(themeWord)) {
                matchedKeywords.push(themeWord);
              }
            }
          }
        }
      }

      const arabicThemeTokens = Array.from(matchedArabicWords).filter(
        (w) => !directArabicTokens.includes(w),
      );
      if (arabicThemeTokens.length > 0) {
        for (const themeWord of arabicThemeTokens) {
          if (normalizedVerse.includes(themeWord)) {
            matchedKeywords.push(themeWord);
          }
        }
      }

      if (matchedKeywords.length > 0) {
        results.push({
          ...verse,
          matchType: 'subject',
          matchScore: matchedKeywords.length * 5,
          matchedTokens: matchedKeywords,
        });
      }
    }
    return results;
  }

  for (const gid of matchedGids) {
    const verse = quranData.get(gid);
    if (!verse) continue;
    if (options.suraId && verse.sura_id !== options.suraId) continue;
    if (options.juzId && verse.juz_id !== options.juzId) continue;
    if (options.suraName && verse.sura_name !== options.suraName) continue;

    const matchedKeywords = Array.from(matchedArabicWords).filter((word) => {
      const normalizedVerse = normalizeArabic(verse.standard);
      return normalizedVerse.includes(word);
    });

    if (matchedKeywords.length > 0) {
      results.push({
        ...verse,
        matchType: 'subject',
        matchScore: matchedKeywords.length * 5,
        matchedTokens: matchedKeywords,
      });
    }
  }

  return results;
};
