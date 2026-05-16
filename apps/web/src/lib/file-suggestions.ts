export interface FileSuggestion {
  value: string;
  display: string;
  isDirectory: boolean;
}

export function extractMention(
  text: string,
  cursorPosition: number,
): { mentionStart: number; partialPath: string } | null {
  let atIndex = -1;

  for (let i = cursorPosition - 1; i >= 0; i -= 1) {
    const char = text[i];
    if (char === undefined || char === " " || char === "\t" || char === "\n") {
      break;
    }
    if (char === "@") {
      atIndex = i;
      break;
    }
  }

  if (atIndex === -1) {
    return null;
  }

  return { mentionStart: atIndex, partialPath: text.slice(atIndex + 1, cursorPosition) };
}

export function filterFileSuggestions(
  files: FileSuggestion[],
  partialPath: string,
  maxResults = 50,
): FileSuggestion[] {
  const query = partialPath.toLowerCase();

  if (!query) {
    const results: FileSuggestion[] = [];
    for (const file of files) {
      if (
        !file.value.includes("/") ||
        (file.isDirectory && !file.value.slice(0, -1).includes("/"))
      ) {
        results.push(file);
        if (results.length >= maxResults) break;
      }
    }
    return results;
  }

  const results: FileSuggestion[] = [];
  for (const file of files) {
    if (file.value.toLowerCase().includes(query)) {
      results.push(file);
      if (results.length >= maxResults) break;
    }
  }
  return results;
}
