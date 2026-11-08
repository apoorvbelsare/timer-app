import { describe, expect, it } from 'vitest';
import { parseTasks } from './tasks';

const FILE = `# Projects

## Backlog
- someday thing

## To Do
- [ ] Write the **report** intro
- [x] Already done
- Call [the bank](https://example.com)
1. Book the dentist

## 🚧 In progress
* [ ] Fix the [[Timer app|timer]] widget
  - [ ] a nested sub-task

## Done
- [x] Shipped
`;

describe('parseTasks', () => {
  it('takes open items under To do and In progress, In progress first', () => {
    expect(parseTasks(FILE).map((t) => t.text)).toEqual([
      'Fix the timer widget',
      'a nested sub-task',
      'Write the report intro',
      'Call the bank',
      'Book the dentist',
    ]);
  });

  it('leaves out ticked items and other sections', () => {
    const texts = parseTasks(FILE).map((t) => t.text);
    expect(texts).not.toContain('Already done');
    expect(texts).not.toContain('someday thing');
    expect(texts).not.toContain('Shipped');
  });

  it('keeps going through sub-headings inside a wanted section', () => {
    const md = '# To do\n## Work\n- one\n## Home\n- two\n# Later\n- three';
    expect(parseTasks(md).map((t) => t.text)).toEqual(['one', 'two']);
  });

  it('finds nothing in a file without those headings', () => {
    expect(parseTasks('# Notes\n- just notes')).toEqual([]);
  });
});
