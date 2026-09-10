import subjectData from '../../data/subjects.json';
import { normalizeArabic } from '../../utils/normalization';
import type {
  VerseInput,
  ScoredVerse,
  AdvancedSearchOptions,
  InvertedIndex,
  SubjectNode,
} from '../../types';
import { performThematicSearch } from './thematic-search';

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

  return performThematicSearch({
    query,
    quranData,
    options,
    source: {
      expandArabic: (word) => subjectMap.get(word)?.arabic,
      expandEnglish: (token) => subjectMap.get(token)?.arabic,
    },
    matchType: 'subject',
    originalQuery,
    themeIndex: invertedIndex?.subjectIndex,
    wordIndex: invertedIndex?.wordIndex,
  });
};
