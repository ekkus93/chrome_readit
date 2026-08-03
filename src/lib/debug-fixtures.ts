const OVERSIZED_SENTENCE = [
  'This deliberately oversized sentence exercises ranked clause splitting while preserving every word exactly once;',
  'it continues with enough neutral fixture language to exceed the production hard chunk maximum,',
  'and it repeats a deterministic sequence for testability:',
  ...Array.from({ length: 80 }, (_, index) => `fixture${index + 1}`),
].join(' ') + '.'

export const DEBUG_COLLISION_FIXTURE = [
  [
    'Short one. Short two. Short three.',
    'A semicolon joins this clause; it must not force another synthesis request.',
    'The value is 3.14 and version 1.2.3 is current.',
    'Visit example.com or https://example.com/readit and email reader@example.com.',
    'Dr. Smith met Mr. Jones in the U.S. at 5 p.m. today.',
    'A.I. systems changed quickly.',
  ].join(' '),
  [
    'St. Louis is large. I live on Main St. It is quiet.',
    'John Smith Jr. arrived. He is John Smith Jr. He arrived again.',
    '“Quoted punctuation stays attached.” (Parenthesized text follows.)',
    'Wait... what happened? He stopped... Then he left.',
  ].join(' '),
  OVERSIZED_SENTENCE,
].join('\n\n')

// Backward-compatible name for existing development UI references.
export const DEBUG_PARAGRAPH_FIXTURE = DEBUG_COLLISION_FIXTURE
