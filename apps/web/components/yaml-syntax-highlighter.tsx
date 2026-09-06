"use client";

import { useMemo } from "react";
import { CopyButton } from "./copy-button.js";

type YamlTokenType = "key" | "boolean" | "number" | "string" | "comment" | "punctuation" | "plain";

type YamlToken = {
  id: string;
  type: YamlTokenType;
  text: string;
};

export function tokenizeYamlLine(line: string, lineIndex: number): YamlToken[] {
  if (!line) return [{ id: `L${lineIndex}-empty`, type: "plain", text: "" }];

  // Comment line
  const commentMatch = line.match(/^(\s*)(#.*)$/);
  if (commentMatch) {
    const indent = commentMatch[1] ?? "";
    const comment = commentMatch[2] ?? "";
    const tokens: YamlToken[] = [];
    if (indent) tokens.push({ id: `L${lineIndex}-indent`, type: "plain", text: indent });
    tokens.push({ id: `L${lineIndex}-comment`, type: "comment", text: comment });
    return tokens;
  }

  // Key-value pair, e.g. "  bom.missing-mpn: true" or "version: 1" or "  - path: ."
  const kvMatch = line.match(/^(\s*(?:-\s*)?)([a-zA-Z0-9_.-]+)(\s*:\s*)(.*)$/);
  if (kvMatch) {
    const prefix = kvMatch[1] ?? "";
    const key = kvMatch[2] ?? "";
    const colon = kvMatch[3] ?? "";
    const rawValue = kvMatch[4] ?? "";
    const tokens: YamlToken[] = [];
    if (prefix) tokens.push({ id: `L${lineIndex}-prefix`, type: "punctuation", text: prefix });
    tokens.push({ id: `L${lineIndex}-k-${key}`, type: "key", text: key });
    tokens.push({ id: `L${lineIndex}-colon`, type: "punctuation", text: colon });

    if (rawValue) {
      const trimmedVal = rawValue.trim();
      if (trimmedVal === "true" || trimmedVal === "false") {
        tokens.push({ id: `L${lineIndex}-bool`, type: "boolean", text: rawValue });
      } else if (/^\d+(?:\.\d+)?$/.test(trimmedVal)) {
        tokens.push({ id: `L${lineIndex}-num`, type: "number", text: rawValue });
      } else {
        tokens.push({ id: `L${lineIndex}-str`, type: "string", text: rawValue });
      }
    }
    return tokens;
  }

  // List item without key: "  - foo"
  const listMatch = line.match(/^(\s*-\s*)(.*)$/);
  if (listMatch) {
    const marker = listMatch[1] ?? "";
    const content = listMatch[2] ?? "";
    return [
      { id: `L${lineIndex}-marker`, type: "punctuation", text: marker },
      { id: `L${lineIndex}-item`, type: "string", text: content },
    ];
  }

  return [{ id: `L${lineIndex}-plain`, type: "plain", text: line }];
}

function tokenClass(type: YamlTokenType): string {
  switch (type) {
    case "key":
      return "text-sky-600 dark:text-sky-400 font-medium";
    case "boolean":
      return "text-amber-600 dark:text-amber-400 font-semibold";
    case "number":
      return "text-purple-600 dark:text-purple-400 font-medium";
    case "string":
      return "text-emerald-600 dark:text-emerald-400";
    case "comment":
      return "text-muted-foreground/70 italic";
    case "punctuation":
      return "text-muted-foreground";
    default:
      return "text-foreground";
  }
}

export type YamlSyntaxHighlighterProps = {
  code: string;
  filename: string;
  presetName: string;
};

export function YamlSyntaxHighlighter({ code, filename, presetName }: Readonly<YamlSyntaxHighlighterProps>) {
  const lineTokens = useMemo(() => {
    return code.split("\n").map((line, index) => ({
      lineNumber: index + 1,
      id: `line-${index + 1}`,
      tokens: tokenizeYamlLine(line, index + 1),
    }));
  }, [code]);

  return (
    <figure className="mt-4 overflow-hidden rounded-md border border-border bg-card shadow-xs">
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2.5">
        <figcaption
          id="setup-config-preview-caption"
          className="flex items-center gap-2 font-mono text-xs font-medium text-foreground"
        >
          <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
          <span>
            {presetName} · {filename}
          </span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">YAML</span>
        </figcaption>
        <CopyButton label="Copy YAML" value={code} />
      </div>
      <div className="relative max-h-[580px] overflow-auto bg-muted/20">
        <pre className="p-4 font-mono text-xs leading-relaxed" aria-hidden="true">
          <code>
            {lineTokens.map((item) => (
              <span key={item.id} className="table-row">
                <span className="table-cell select-none pr-4 text-right font-mono text-[11px] text-muted-foreground/40">
                  {item.lineNumber}
                </span>
                <span className="table-cell whitespace-pre">
                  {item.tokens.map((token) => (
                    <span key={token.id} className={tokenClass(token.type)}>
                      {token.text}
                    </span>
                  ))}
                </span>
              </span>
            ))}
          </code>
        </pre>
        {/* Preserves keyboard focusable textarea contract required by test suite */}
        <textarea
          className="setup-code-preview sr-only"
          aria-labelledby="setup-config-preview-caption"
          readOnly
          rows={Math.min(lineTokens.length, 28)}
          spellCheck={false}
          value={code}
        />
      </div>
    </figure>
  );
}
