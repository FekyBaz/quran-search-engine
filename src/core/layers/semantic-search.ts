import semanticData from '../../data/semantic.json';
import { normalizeArabic } from '../../utils/normalization';
import type { VerseInput, ScoredVerse, AdvancedSearchOptions, InvertedIndex } from '../../types';
import { performThematicSearch } from './thematic-search';

interface SemanticConcept {
  english: string[];
  arabic: string[];
}

export const buildSemanticMap = (): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  const data = semanticData as SemanticConcept[];

  for (const concept of data) {
    for (const word of concept.arabic) {
      const cleanWord = normalizeArabic(word);
      if (cleanWord) {
        map.set(cleanWord, concept.arabic);
      }
    }

    for (const engWord of concept.english) {
      const cleanWord = engWord.replace(/[^a-zA-Z\s]/g, '').trim();
      if (cleanWord) {
        map.set(cleanWord.toLowerCase(), concept.arabic);
      }
    }
  }

  return map;
};

export const semanticMap = buildSemanticMap();

export const performSemanticSearch = <TVerse extends VerseInput>(
  query: string,
  quranData: Map<number, TVerse>,
  options: AdvancedSearchOptions,
  semanticMap?: Map<string, string[]>,
  originalQuery?: string,
  invertedIndex?: InvertedIndex,
): ScoredVerse<TVerse>[] => {
  if (!options.semantic || !semanticMap) return [];

  return performThematicSearch({
    query,
    quranData,
    options,
    source: {
      expandArabic: (word) => semanticMap.get(word),
      expandEnglish: (token) => semanticMap.get(token),
    },
    matchType: 'semantic',
    originalQuery,
    themeIndex: invertedIndex?.semanticIndex,
    wordIndex: invertedIndex?.wordIndex,
  });
};
