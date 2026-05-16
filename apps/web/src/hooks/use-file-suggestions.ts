import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";

import {
  extractMention,
  filterFileSuggestions,
  type FileSuggestion,
} from "#/lib/file-suggestions";

interface UseFileSuggestionsOptions {
  inputValue: string;
  cursorPosition: number;
  files: FileSuggestion[] | null;
  onSelect: (value: string, mentionStart: number, cursorPosition: number) => void;
}

export function useFileSuggestions({
  inputValue,
  cursorPosition,
  files,
  onSelect,
}: UseFileSuggestionsOptions) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const mentionInfo = useMemo(() => {
    if (dismissed) return null;
    return extractMention(inputValue, cursorPosition);
  }, [cursorPosition, dismissed, inputValue]);

  const suggestions = useMemo(() => {
    if (!mentionInfo || !files) return [];
    return filterFileSuggestions(files, mentionInfo.partialPath);
  }, [files, mentionInfo]);

  const partialPath = mentionInfo?.partialPath;
  useEffect(() => {
    setSelectedIndex(0);
    setDismissed(false);
  }, [partialPath]);

  const showSuggestions = mentionInfo !== null && suggestions.length > 0;

  const closeSuggestions = useCallback(() => setDismissed(true), []);

  const handleKeyDown = useCallback((event: KeyboardEvent): boolean => {
    if (!showSuggestions) return false;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
        return true;
      case "ArrowUp":
        event.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return true;
      case "Tab":
      case "Enter": {
        const selected = suggestions[selectedIndex];
        if (!selected || !mentionInfo) return false;
        event.preventDefault();
        onSelect(selected.value, mentionInfo.mentionStart, cursorPosition);
        setDismissed(true);
        return true;
      }
      case "Escape":
        event.preventDefault();
        setDismissed(true);
        return true;
      default:
        return false;
    }
  }, [cursorPosition, mentionInfo, onSelect, selectedIndex, showSuggestions, suggestions]);

  return { showSuggestions, suggestions, selectedIndex, handleKeyDown, mentionInfo, closeSuggestions };
}
