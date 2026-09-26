import { cn } from "@autopr/ui/lib/utils";
import type { CSSProperties, HTMLAttributes } from "react";
import { memo, useEffect, useMemo, useState } from "react";
import type {
  BundledLanguage,
  BundledTheme,
  HighlighterGeneric,
  ThemedToken,
} from "shiki";
import { createHighlighter } from "shiki";

// Shiki uses bitflags for font styles: 1=italic, 2=bold, 4=underline
// oxlint-disable-next-line eslint(no-bitwise)
const isItalic = (fontStyle: number | undefined) => fontStyle && fontStyle & 1;
// oxlint-disable-next-line eslint(no-bitwise)
const isBold = (fontStyle: number | undefined) => fontStyle && fontStyle & 2;
const isUnderline = (fontStyle: number | undefined) =>
  // oxlint-disable-next-line eslint(no-bitwise)
  fontStyle && fontStyle & 4;

// Transform tokens to include pre-computed keys to avoid noArrayIndexKey lint
interface KeyedToken {
  token: ThemedToken;
  key: string;
}
interface KeyedLine {
  tokens: KeyedToken[];
  key: string;
}

type CodeBlockColorPalette = "shiki" | "diff";

const addKeysToTokens = (lines: ThemedToken[][]): KeyedLine[] =>
  lines.map((line, lineIdx) => ({
    key: `line-${lineIdx}`,
    tokens: line.map((token, tokenIdx) => ({
      key: `line-${lineIdx}-${tokenIdx}`,
      token,
    })),
  }));

function diffPaletteColorForToken(token: ThemedToken) {
  const content = token.content.trim();
  const htmlStyle = token.htmlStyle as (CSSProperties & Record<string, string | undefined>) | undefined;
  const lightColor = (htmlStyle?.color ?? token.color ?? "").toLowerCase();
  const darkColor = (htmlStyle?.["--shiki-dark"] ?? "").toLowerCase();

  if (!content) {
    return null;
  }

  if (/^[{}()[\].,;:=<>/+*\-|&!?]+$/.test(content)) {
    return {
      dark: "color-mix(in srgb, var(--muted-foreground) 72%, transparent)",
      light: "color-mix(in srgb, var(--muted-foreground) 82%, transparent)",
    };
  }

  if (
    lightColor === "#032f62" ||
    darkColor === "#9ecbff" ||
    /^["'`]/.test(content)
  ) {
    return {
      dark: "color-mix(in srgb, var(--diffs-added-dark, #22c55e) 82%, var(--foreground))",
      light: "color-mix(in srgb, var(--diffs-added-light, #22c55e) 72%, var(--foreground))",
    };
  }

  if (
    lightColor === "#d73a49" ||
    darkColor === "#f97583" ||
    /^(?:class|const|export|function|import|interface|let|return|type|var)$/.test(content)
  ) {
    return {
      dark: "color-mix(in srgb, var(--diffs-deleted-dark, #ff5577) 78%, var(--foreground))",
      light: "color-mix(in srgb, var(--diffs-deleted-light, #ff5577) 70%, var(--foreground))",
    };
  }

  if (
    lightColor === "#005cc5" ||
    lightColor === "#6f42c1" ||
    darkColor === "#79b8ff" ||
    darkColor === "#b392f0"
  ) {
    return {
      dark: "color-mix(in srgb, var(--diffs-modified-dark, #b7a4ff) 80%, var(--foreground))",
      light: "color-mix(in srgb, var(--diffs-modified-light, #6b4eff) 74%, var(--foreground))",
    };
  }

  if (lightColor === "#22863a" || darkColor === "#85e89d") {
    return {
      dark: "color-mix(in srgb, var(--diffs-added-dark, #22c55e) 70%, var(--foreground))",
      light: "color-mix(in srgb, var(--diffs-added-light, #22c55e) 62%, var(--foreground))",
    };
  }

  return {
    dark: "color-mix(in srgb, var(--foreground) 84%, transparent)",
    light: "color-mix(in srgb, var(--foreground) 78%, transparent)",
  };
}

function tokenStyle(
  token: ThemedToken,
  colorPalette: CodeBlockColorPalette
): CSSProperties {
  const style = {
    backgroundColor: token.bgColor,
    color: token.color,
    fontStyle: isItalic(token.fontStyle) ? "italic" : undefined,
    fontWeight: isBold(token.fontStyle) ? "bold" : undefined,
    textDecoration: isUnderline(token.fontStyle) ? "underline" : undefined,
    ...token.htmlStyle,
  } as CSSProperties & Record<string, string | undefined>;

  if (colorPalette === "diff") {
    const paletteColor = diffPaletteColorForToken(token);
    if (paletteColor) {
      style.color = paletteColor.light;
      style["--shiki-dark"] = paletteColor.dark;
    }
  }

  return style;
}

// Token rendering component
const TokenSpan = ({
  colorPalette,
  token,
}: {
  colorPalette: CodeBlockColorPalette;
  token: ThemedToken;
}) => (
  <span
    className="dark:!text-[var(--shiki-dark)]"
    style={tokenStyle(token, colorPalette)}
  >
    {token.content}
  </span>
);

// Line number styles using CSS counters
const LINE_NUMBER_CLASSES = cn(
  "block",
  "before:content-[counter(line)]",
  "before:inline-block",
  "before:[counter-increment:line]",
  "before:w-8",
  "before:mr-4",
  "before:text-right",
  "before:text-muted-foreground/50",
  "before:font-mono",
  "before:select-none"
);

// Line rendering component
const LineSpan = ({
  colorPalette,
  keyedLine,
  showLineNumbers,
}: {
  colorPalette: CodeBlockColorPalette;
  keyedLine: KeyedLine;
  showLineNumbers: boolean;
}) => (
  <span className={showLineNumbers ? LINE_NUMBER_CLASSES : "block"}>
    {keyedLine.tokens.length === 0
      ? "\n"
      : keyedLine.tokens.map(({ token, key }) => (
          <TokenSpan colorPalette={colorPalette} key={key} token={token} />
        ))}
  </span>
);

// Types
type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  colorPalette?: CodeBlockColorPalette;
  language: BundledLanguage;
  codeClassName?: string;
  preClassName?: string;
  showLineNumbers?: boolean;
  useShikiBackground?: boolean;
};

interface TokenizedCode {
  tokens: ThemedToken[][];
  style: CSSProperties;
}

type HighlighterCacheEntry = {
  highlighter?: HighlighterGeneric<BundledLanguage, BundledTheme>;
  promise: Promise<HighlighterGeneric<BundledLanguage, BundledTheme>>;
};

// Highlighter cache (singleton per language)
const highlighterCache = new Map<string, HighlighterCacheEntry>();

// Token cache
const tokensCache = new Map<string, TokenizedCode>();

// Subscribers for async token updates
const subscribers = new Map<string, Set<(result: TokenizedCode) => void>>();

const getTokensCacheKey = (code: string, language: BundledLanguage) => {
  const start = code.slice(0, 100);
  const end = code.length > 100 ? code.slice(-100) : "";
  return `${language}:${code.length}:${start}:${end}`;
};

const getHighlighterEntry = (language: BundledLanguage): HighlighterCacheEntry => {
  const cached = highlighterCache.get(language);
  if (cached) {
    return cached;
  }

  const entry: HighlighterCacheEntry = {
    promise: createHighlighter({
      langs: [language],
      themes: ["github-light", "github-dark"],
    }),
  };

  entry.promise
    // oxlint-disable-next-line eslint-plugin-promise/prefer-await-to-then
    .then((highlighter) => {
      entry.highlighter = highlighter;
      return highlighter;
    })
    // oxlint-disable-next-line eslint-plugin-promise/prefer-await-to-then
    .catch(() => {
      highlighterCache.delete(language);
    });

  highlighterCache.set(language, entry);
  return entry;
};

const getHighlighter = (
  language: BundledLanguage
): Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> =>
  getHighlighterEntry(language).promise;

function shikiThemeStyle(
  property: "backgroundColor" | "color",
  value: string | undefined
): CSSProperties {
  if (!value) {
    return {};
  }

  const [baseValue, ...variableDeclarations] = value.split(";");
  const style: CSSProperties & Record<string, string> = {};

  if (baseValue) {
    style[property] = baseValue;
  }

  for (const declaration of variableDeclarations) {
    const separatorIndex = declaration.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const name = declaration.slice(0, separatorIndex).trim();
    const variableValue = declaration.slice(separatorIndex + 1).trim();

    if (name.startsWith("--") && variableValue) {
      style[name] = variableValue;
    }
  }

  return style;
}

function tokenizedFromResult(result: {
  bg?: string;
  fg?: string;
  tokens: ThemedToken[][];
}): TokenizedCode {
  return {
    style: {
      ...shikiThemeStyle("backgroundColor", result.bg),
      ...shikiThemeStyle("color", result.fg),
    },
    tokens: result.tokens,
  };
}

function tokenizeWithHighlighter(
  highlighter: HighlighterGeneric<BundledLanguage, BundledTheme>,
  code: string,
  language: BundledLanguage
): TokenizedCode {
  const availableLangs = highlighter.getLoadedLanguages();
  const langToUse = availableLangs.includes(language) ? language : "text";

  return tokenizedFromResult(
    highlighter.codeToTokens(code, {
      lang: langToUse,
      themes: {
        dark: "github-dark",
        light: "github-light",
      },
    })
  );
}

// Create raw tokens for immediate display while highlighting loads
const createRawTokens = (code: string): TokenizedCode => ({
  style: {
    backgroundColor: "transparent",
    color: "inherit",
  },
  tokens: code.split("\n").map((line) =>
    line === ""
      ? []
      : [
          {
            color: "inherit",
            content: line,
          } as ThemedToken,
        ]
  ),
});

// Synchronous highlight with callback for async results
const highlightCode = (
  code: string,
  language: BundledLanguage,
  // oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-callbacks)
  callback?: (result: TokenizedCode) => void
): TokenizedCode | null => {
  const tokensCacheKey = getTokensCacheKey(code, language);

  // Return cached result if available
  const cached = tokensCache.get(tokensCacheKey);
  if (cached) {
    return cached;
  }

  const highlighterEntry = highlighterCache.get(language);
  if (highlighterEntry?.highlighter) {
    const tokenized = tokenizeWithHighlighter(
      highlighterEntry.highlighter,
      code,
      language
    );
    tokensCache.set(tokensCacheKey, tokenized);
    return tokenized;
  }

  // Subscribe callback if provided
  if (callback) {
    if (!subscribers.has(tokensCacheKey)) {
      subscribers.set(tokensCacheKey, new Set());
    }
    subscribers.get(tokensCacheKey)?.add(callback);
  }

  // Start highlighting in background - fire-and-forget async pattern
  getHighlighter(language)
    // oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then)
    .then((highlighter) => {
      const tokenized = tokenizeWithHighlighter(highlighter, code, language);

      // Cache the result
      tokensCache.set(tokensCacheKey, tokenized);

      // Notify all subscribers
      const subs = subscribers.get(tokensCacheKey);
      if (subs) {
        for (const sub of subs) {
          sub(tokenized);
        }
        subscribers.delete(tokensCacheKey);
      }
    })
    // oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then), eslint-plugin-promise(prefer-await-to-callbacks)
    .catch((error) => {
      console.error("Failed to highlight code:", error);
      subscribers.delete(tokensCacheKey);
    });

  return null;
};

function withoutShikiBackground(style: CSSProperties): CSSProperties {
  const { backgroundColor: _backgroundColor, ...rest } =
    style as CSSProperties & Record<string, string | undefined>;
  const next = { ...rest };
  delete next["--shiki-dark-bg"];
  return next;
}

const CodeBlockBody = memo(
  ({
    codeClassName,
    colorPalette,
    preClassName,
    tokenized,
    showLineNumbers,
    useShikiBackground,
  }: {
    codeClassName?: string;
    colorPalette: CodeBlockColorPalette;
    preClassName?: string;
    tokenized: TokenizedCode;
    showLineNumbers: boolean;
    useShikiBackground: boolean;
  }) => {
    const preStyle = useMemo(
      () =>
        useShikiBackground
          ? tokenized.style
          : withoutShikiBackground(tokenized.style),
      [tokenized.style, useShikiBackground]
    );

    const keyedLines = useMemo(
      () => addKeysToTokens(tokenized.tokens),
      [tokenized.tokens]
    );

    return (
      <pre
        className={cn(
          "m-0 p-4 text-sm dark:!text-[var(--shiki-dark)]",
          useShikiBackground && "dark:!bg-[var(--shiki-dark-bg)]",
          preClassName
        )}
        style={preStyle}
      >
        <code
          className={cn(
            "font-mono text-sm",
            showLineNumbers && "[counter-increment:line_0] [counter-reset:line]",
            codeClassName
          )}
        >
          {keyedLines.map((keyedLine) => (
            <LineSpan
              colorPalette={colorPalette}
              key={keyedLine.key}
              keyedLine={keyedLine}
              showLineNumbers={showLineNumbers}
            />
          ))}
        </code>
      </pre>
    );
  },
  (prevProps, nextProps) =>
    prevProps.codeClassName === nextProps.codeClassName &&
    prevProps.colorPalette === nextProps.colorPalette &&
    prevProps.preClassName === nextProps.preClassName &&
    prevProps.tokenized === nextProps.tokenized &&
    prevProps.showLineNumbers === nextProps.showLineNumbers &&
    prevProps.useShikiBackground === nextProps.useShikiBackground
);

CodeBlockBody.displayName = "CodeBlockBody";

const CodeBlockContainer = ({
  className,
  language,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & { language: string }) => (
  <div
    className={cn(
      "group relative w-full overflow-hidden rounded-md border bg-background text-foreground",
      className
    )}
    data-language={language}
    style={{
      containIntrinsicSize: "auto 200px",
      contentVisibility: "auto",
      ...style,
    }}
    {...props}
  />
);

const CodeBlockContent = ({
  code,
  codeClassName,
  colorPalette = "shiki",
  language,
  preClassName,
  showLineNumbers = false,
  useShikiBackground = true,
}: {
  code: string;
  codeClassName?: string;
  colorPalette?: CodeBlockColorPalette;
  language: BundledLanguage;
  preClassName?: string;
  showLineNumbers?: boolean;
  useShikiBackground?: boolean;
}) => {
  // Memoized raw tokens for immediate display
  const rawTokens = useMemo(() => createRawTokens(code), [code]);

  // Synchronous cache lookup — avoids setState in effect for cached results
  const syncTokens = useMemo(
    () => highlightCode(code, language) ?? rawTokens,
    [code, language, rawTokens]
  );

  const [asyncResult, setAsyncResult] = useState<{
    code: string;
    language: BundledLanguage;
    tokens: TokenizedCode;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    highlightCode(code, language, (result) => {
      if (!cancelled) {
        setAsyncResult({ code, language, tokens: result });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  const asyncTokens =
    asyncResult?.code === code && asyncResult.language === language
      ? asyncResult.tokens
      : null;
  const tokenized = asyncTokens ?? syncTokens;

  return (
    <div className="relative overflow-auto">
      <CodeBlockBody
        codeClassName={codeClassName}
        colorPalette={colorPalette}
        preClassName={preClassName}
        showLineNumbers={showLineNumbers}
        tokenized={tokenized}
        useShikiBackground={useShikiBackground}
      />
    </div>
  );
};

export const CodeBlock = ({
  code,
  codeClassName,
  colorPalette = "shiki",
  language,
  preClassName,
  showLineNumbers = false,
  useShikiBackground = true,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  return (
    <CodeBlockContainer className={className} language={language} {...props}>
      {children}
      <CodeBlockContent
        code={code}
        codeClassName={codeClassName}
        colorPalette={colorPalette}
        language={language}
        preClassName={preClassName}
        showLineNumbers={showLineNumbers}
        useShikiBackground={useShikiBackground}
      />
    </CodeBlockContainer>
  );
};
