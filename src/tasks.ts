/** Reads the "I'm stuck" task list: a Markdown file kept however you like. */

export interface Task {
  text: string;
  /** The heading it sits under, as written */
  section: string;
  inProgress: boolean;
}

const WANTED = /^(to[\s-]?do|todo|in[\s-]?progress|doing)\b/i;
const IN_PROGRESS = /^(in[\s-]?progress|doing)\b/i;

/**
 * Every open item under a "To do" or "In progress" heading (any level, any
 * case, emoji allowed in front), until the next heading of the same level or
 * higher. Ticked items ([x]) are left out. In progress comes first.
 */
export function parseTasks(markdown: string): Task[] {
  const tasks: Task[] = [];
  let section: { name: string; level: number; inProgress: boolean } | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const name = heading[2].replace(/^[^\p{L}\p{N}]+/u, '').trim();
      if (WANTED.test(name)) section = { name, level, inProgress: IN_PROGRESS.test(name) };
      else if (section && level <= section.level) section = null;
      continue;
    }
    if (!section) continue;
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[( |x|X)\]\s+)?(.*\S)\s*$/.exec(line);
    if (!item || item[1]?.toLowerCase() === 'x') continue;
    tasks.push({ text: cleanText(item[2]), section: section.name, inProgress: section.inProgress });
  }
  return tasks.filter((t) => t.text).sort((a, b) => Number(b.inProgress) - Number(a.inProgress));
}

/** Plain text for a list item: links become their label, emphasis and code marks go. */
function cleanText(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, page, label) => label ?? page)
    .replace(/(\*\*|__|~~|`)/g, '')
    .trim();
}
