export const DEBUG_PARAGRAPH_FIXTURE = [
  [
    'This is the first sentence of the first paragraph.',
    'It is intentionally long enough to make the background chunker produce more than one chunk before the paragraph ends.',
    'That gives the debug harness a reliable sentence transition inside a paragraph.',
    'It also keeps the paragraph boundary close to a chunk boundary so the handoff can be inspected more easily in the DEV logs.',
    'If overlap still exists, this is where it should be easiest to hear.',
  ].join(' '),
  'This is the first sentence of the second paragraph. If the transition is wrong, this line is where overlap is easiest to hear.',
  'This third paragraph gives the queue one more boundary so DEV traces show sentence and paragraph transitions distinctly.',
].join('\n\n')
