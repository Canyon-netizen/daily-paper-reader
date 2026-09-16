# Writing Module

Writing module for DPR (Daily Paper Reader) - manages academic writing workflows including papers, reviews, notes, and translations.

## Types

### WritingType

```typescript
type WritingType = 'paper' | 'section' | 'note' | 'review' | 'translation';
```

| Type | Description | Default Sections |
|------|-------------|------------------|
| `paper` | Standard academic paper | 8 sections (abstract, introduction, method, experiments, results, discussion, conclusion, references) |
| `review` | Literature review | 11 sections (adds taxonomy, related-work, gaps, appendix) |
| `section` | Short section | 3 sections (introduction, main, summary) |
| `note` | Reading note | 1 section (body) |
| `translation` | Bilingual translation | 3 sections (source, translation, notes) |

### Writing

```typescript
interface Writing {
  id: string;           // kebab-case slug
  title: string;
  type: WritingType;
  status: WritingStatus;
  targetVenue?: string;
  abstract?: string;
  sections: WritingSection[];
  citedPapers: PaperRef[];
  relatedIdeas: string[];
  relatedExperiments: string[];
  wordCount: number;
  versions: WritingVersion[];
  createdAt: number;
  updatedAt: number;
}
```

## Storage

LocalStorage key: `dpr_writings_v1`

Schema:
```typescript
interface WritingsDoc {
  schemaVersion: 1;
  writings: Record<string, Writing>;
}
```

## Modules

### outline.ts

Generates outline skeletons based on writing type and cited papers.

```typescript
// Generate outline for a paper
const outline = generateOutline('paper', [
  { arxivId: '2501.00001' },
], { citationStrategy: 'spread' });

// Get template outline (empty placeholders)
const template = suggestOutlineForType('paper');

// Convert to WritingSection[]
const sections = outlineToSections(outline);

// Estimate total words and writing days
const totalWords = outlineTotalWords(outline);
const days = estimateWritingDays(outline, 500);
```

Citation strategies:
- `spread` - distribute citations across all content sections
- `front-loaded` - put all citations in introduction/related-work sections
- `cluster` - group citations by section index

### synthesis-integration.ts

Manages writing synthesis from multiple papers.

### version.ts

Version history management for writings.

```typescript
// Create a new version
const version = createVersion(writingId, content);

// List versions
const versions = listVersions(writingId);

// Restore from version
const restored = restoreVersion(writingId, versionId);
```

### citation-sync.ts

Synchronizes citations between writing content and known papers.

```typescript
// Extract all cited arxiv IDs from sections
const ids = extractAllCitedArxivIds(sections);

// Sync citations - returns added/removed/kept
const result = syncWritingCitedPapers(writingId, knownPaperIds, {
  sections,
  dryRun: false,
});

// Merge two citation lists
const { merged, added, removed } = mergeCitedPapers(existing, newRefs);

// Find orphan citations
const orphans = findOrphanCitations(writingId, knownPapers);
```

### validate.ts

Validates writing objects.

```typescript
// Validate a writing object
const result = validateWriting(writing);
// Returns: { errors: string[], warnings: string[] }

// Validate writing ID format (kebab-case)
const idResult = validateWritingId('my-paper-slug');

// Validate title
const titleResult = validateTitle('My Paper Title');
```

### wordcount.ts

Estimates word count for text (supports Chinese/English mixing).

```typescript
// Estimate words for mixed text
const { chinese, english, total } = estimateWords('这是中文 English mixed');

// Chinese characters only
const chars = estimateChineseChars('中文文本');

// English words only
const words = estimateEnglishWords('English text');
```

### tags.ts

Extracts keywords from text.

```typescript
// Extract top keywords
const keywords = extractKeywords(text, {
  topN: 10,
  minLength: 2,
  stopwords: DEFAULT_STOPWORDS,
});

// Extract common keywords from multiple texts
const common = extractCommonKeywords(texts, { topN: 5 });
```

## Usage Example

```typescript
import { generateOutline, outlineToSections } from './outline';
import { validateWriting } from './validate';
import { estimateWords } from './wordcount';
import type { Writing, WritingType } from './types';

// 1. Create a new paper
const type: WritingType = 'paper';
const outline = generateOutline(type, []);

// 2. Convert to sections
const sections = outlineToSections(outline);

// 3. Validate
const writing: Writing = {
  id: 'my-paper',
  title: 'My Paper Title',
  type,
  status: 'draft',
  sections,
  citedPapers: [],
  relatedIdeas: [],
  relatedExperiments: [],
  wordCount: 0,
  versions: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const validation = validateWriting(writing);
if (validation.errors.length > 0) {
  console.error('Validation errors:', validation.errors);
}

// 4. Estimate word count
const content = sections.map(s => s.content).join('\n');
const { total } = estimateWords(content);
```
