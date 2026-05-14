import { parsePatch } from "diff";
import type { BundledLanguage } from "shiki";
import { useMemo } from "react";

import { CodeBlock } from "./code-block";
import styles from "./content-diff.module.css";

type DiffRow = {
  left: string;
  right: string;
  leftLineNumber: number | null;
  rightLineNumber: number | null;
  type: "added" | "removed" | "unchanged" | "modified";
};

type MobileBlock = {
  type: "added" | "removed" | "unchanged";
  lines: string[];
};

type UnifiedLine = {
  content: string;
  type: "added" | "removed" | "unchanged";
  lineNumber: number | null;
};

export function ContentDiff({ diff, language }: { diff: string; language: BundledLanguage }) {
  const rows = useMemo<DiffRow[]>(() => {
    const diffRows: DiffRow[] = [];

    try {
      const patches = parsePatch(diff);

      for (const patch of patches) {
        for (const hunk of patch.hunks) {
          const lines = hunk.lines;
          let index = 0;
          let leftLineNumber = hunk.oldStart;
          let rightLineNumber = hunk.newStart;

          while (index < lines.length) {
            const line = lines[index];
            const content = line.slice(1);
            const prefix = line[0];

            if (prefix === "-") {
              const removals: string[] = [content];
              let cursor = index + 1;

              while (cursor < lines.length && lines[cursor][0] === "-") {
                removals.push(lines[cursor].slice(1));
                cursor += 1;
              }

              const additions: string[] = [];
              while (cursor < lines.length && lines[cursor][0] === "+") {
                additions.push(lines[cursor].slice(1));
                cursor += 1;
              }

              const maxLength = Math.max(removals.length, additions.length);
              for (let pair = 0; pair < maxLength; pair += 1) {
                const hasLeft = pair < removals.length;
                const hasRight = pair < additions.length;
                const leftNumber = hasLeft ? leftLineNumber++ : null;
                const rightNumber = hasRight ? rightLineNumber++ : null;

                if (hasLeft && hasRight) {
                  diffRows.push({
                    left: removals[pair]!,
                    right: additions[pair]!,
                    leftLineNumber: leftNumber,
                    rightLineNumber: rightNumber,
                    type: "modified",
                  });
                } else if (hasLeft) {
                  diffRows.push({
                    left: removals[pair]!,
                    right: "",
                    leftLineNumber: leftNumber,
                    rightLineNumber: null,
                    type: "removed",
                  });
                } else if (hasRight) {
                  diffRows.push({
                    left: "",
                    right: additions[pair]!,
                    leftLineNumber: null,
                    rightLineNumber: rightNumber,
                    type: "added",
                  });
                }
              }

              index = cursor;
            } else if (prefix === "+") {
              diffRows.push({
                left: "",
                right: content,
                leftLineNumber: null,
                rightLineNumber: rightLineNumber++,
                type: "added",
              });
              index += 1;
            } else if (prefix === " ") {
              const normalized = content === "" ? " " : content;
              diffRows.push({
                left: normalized,
                right: normalized,
                leftLineNumber: leftLineNumber++,
                rightLineNumber: rightLineNumber++,
                type: "unchanged",
              });
              index += 1;
            } else {
              index += 1;
            }
          }
        }
      }
    } catch {
      return [];
    }

    return diffRows;
  }, [diff]);

  const mobileBlocks = useMemo<MobileBlock[]>(() => {
    const blocks: MobileBlock[] = [];
    let index = 0;

    while (index < rows.length) {
      const removedLines: string[] = [];
      const addedLines: string[] = [];

      while (
        index < rows.length &&
        (rows[index]!.type === "modified" || rows[index]!.type === "removed" || rows[index]!.type === "added")
      ) {
        const row = rows[index]!;
        if (row.left && (row.type === "removed" || row.type === "modified")) {
          removedLines.push(row.left);
        }
        if (row.right && (row.type === "added" || row.type === "modified")) {
          addedLines.push(row.right);
        }
        index += 1;
      }

      if (removedLines.length > 0) {
        blocks.push({ type: "removed", lines: removedLines });
      }
      if (addedLines.length > 0) {
        blocks.push({ type: "added", lines: addedLines });
      }

      if (index < rows.length && rows[index]!.type === "unchanged") {
        blocks.push({ type: "unchanged", lines: [rows[index]!.left] });
        index += 1;
      }
    }

    return blocks;
  }, [rows]);

  const unifiedLines = useMemo<UnifiedLine[]>(() => {
    const lines: UnifiedLine[] = [];

    for (const row of rows) {
      if (row.type === "modified") {
        lines.push({
          content: row.left,
          type: "removed",
          lineNumber: row.leftLineNumber,
        });
        lines.push({
          content: row.right,
          type: "added",
          lineNumber: row.rightLineNumber,
        });
        continue;
      }

      if (row.type === "removed") {
        lines.push({
          content: row.left,
          type: "removed",
          lineNumber: row.leftLineNumber,
        });
        continue;
      }

      if (row.type === "added") {
        lines.push({
          content: row.right,
          type: "added",
          lineNumber: row.rightLineNumber,
        });
        continue;
      }

      lines.push({
        content: row.right,
        type: "unchanged",
        lineNumber: row.rightLineNumber,
      });
    }

    return lines;
  }, [rows]);

  return (
    <div className={styles.root}>
      <div className={styles.unified}>
        {unifiedLines.map((line, lineIndex) => (
          <div
            key={`line-${lineIndex}`}
            className={`${styles.unifiedLine} ${
              line.type === "removed" ? styles.removed : line.type === "added" ? styles.added : ""
            }`}
          >
            <span className={styles.lineNumber}>{line.lineNumber ?? ""}</span>
            <span className={styles.sign}>{line.type === "removed" ? "-" : line.type === "added" ? "+" : ""}</span>
            <CodeBlock className={styles.code} code={line.content} language={language} />
          </div>
        ))}
      </div>

      <div className={styles.mobileHidden}>
        {mobileBlocks.map((block, blockIndex) => (
          <div key={`block-${blockIndex}`} className={styles.block}>
            {block.lines.map((line, lineIndex) => (
              <div
                key={`block-${blockIndex}-line-${lineIndex}`}
                className={`${styles.blockLine} ${
                  block.type === "removed" ? styles.removed : block.type === "added" ? styles.added : ""
                }`}
              >
                <CodeBlock className={styles.code} code={line} language={language} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
