/**
 * Word-level highlighting inside a changed diff line, so a one-character edit
 * reads as one character rather than a whole red/green row. Modelled on the
 * T3 Code mobile review pane.
 */

export type WordDiffRange = { start: number; end: number };

export type DiffSegment = { text: string; highlight: boolean };

/** Long lines are almost always generated output; pairing them is not worth it. */
const MAX_LINE_LENGTH = 1_000;
const MAX_TOKENS = 400;

function tokenize(line: string): string[] {
  return line.match(/\s+|[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g) ?? [];
}

/** Longest common subsequence over tokens, returned as index pairs. */
function commonTokens(left: readonly string[], right: readonly string[]) {
  const lengths: number[][] = Array.from(
    { length: left.length + 1 },
    () => new Array<number>(right.length + 1).fill(0),
  );
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i]![j] = left[i] === right[j]
        ? lengths[i + 1]![j + 1]! + 1
        : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }

  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

function tokenOffsets(tokens: readonly string[]) {
  const offsets: number[] = [];
  let offset = 0;
  for (const token of tokens) {
    offsets.push(offset);
    offset += token.length;
  }
  offsets.push(offset);
  return offsets;
}

/** Joins ranges separated by at most one character so highlights stay legible. */
function mergeNearby(ranges: readonly WordDiffRange[]): WordDiffRange[] {
  const merged: WordDiffRange[] = [];
  for (const range of ranges) {
    if (range.end <= range.start) continue;
    const previous = merged.at(-1);
    if (previous && range.start - previous.end <= 1) {
      merged[merged.length - 1] = { start: previous.start, end: range.end };
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

function unmatchedRanges(
  tokens: readonly string[],
  matchedIndices: ReadonlySet<number>,
): WordDiffRange[] {
  const offsets = tokenOffsets(tokens);
  const ranges: WordDiffRange[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (matchedIndices.has(index)) continue;
    // Whitespace-only differences add noise without carrying meaning.
    if (tokens[index]!.trim().length === 0) continue;
    ranges.push({ start: offsets[index]!, end: offsets[index + 1]! });
  }
  return mergeNearby(ranges);
}

/**
 * Character ranges that differ between a paired deletion and addition line.
 */
export function computeWordDiffRanges(deletionLine: string, additionLine: string): {
  deletion: WordDiffRange[];
  addition: WordDiffRange[];
} {
  if (
    deletionLine === additionLine
    || deletionLine.length > MAX_LINE_LENGTH
    || additionLine.length > MAX_LINE_LENGTH
  ) {
    return { deletion: [], addition: [] };
  }

  const deletionTokens = tokenize(deletionLine);
  const additionTokens = tokenize(additionLine);
  if (deletionTokens.length > MAX_TOKENS || additionTokens.length > MAX_TOKENS) {
    return { deletion: [], addition: [] };
  }

  const pairs = commonTokens(deletionTokens, additionTokens);
  const deletionMatched = new Set(pairs.map(([index]) => index));
  const additionMatched = new Set(pairs.map(([, index]) => index));
  const deletion = unmatchedRanges(deletionTokens, deletionMatched);
  const addition = unmatchedRanges(additionTokens, additionMatched);

  // A rewrite that shares nothing reads better as a plain changed line.
  if (
    deletion.length > 0 && addition.length > 0
    && pairs.every(([index]) => deletionTokens[index]!.trim().length === 0)
  ) {
    return { deletion: [], addition: [] };
  }

  return { deletion, addition };
}

/** Splits a line into contiguous highlighted and plain runs. */
export function toSegments(content: string, ranges: readonly WordDiffRange[]): DiffSegment[] {
  if (ranges.length === 0) return [{ text: content, highlight: false }];

  const segments: DiffSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push({ text: content.slice(cursor, range.start), highlight: false });
    }
    segments.push({ text: content.slice(range.start, range.end), highlight: true });
    cursor = range.end;
  }
  if (cursor < content.length) {
    segments.push({ text: content.slice(cursor), highlight: false });
  }
  return segments.filter((segment) => segment.text.length > 0);
}
