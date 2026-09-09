"use client";

import { useMemo } from "react";
import { CopyButton } from "./copy-button.js";

type YamlTokenType = "key" | "boolean" | "number" | "string" | "comment" | "punctuation" | "plain";

type YamlToken = {
  id: string;
  type: YamlTokenType;
  text: string;
};

function isYamlWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t";
}

function yamlPrefixEnd(line: string): number {
  let index = 0;
  while (isYamlWhitespace(line[index])) index += 1;
  if (line[index] !== "-") return index;
  index += 1;
  while (isYamlWhitespace(line[index])) index += 1;
  return index;
}

function yamlKeyEnd(line: string, start: number): number {
  let index = start;
  while (index < line.length && /[a-zA-Z0-9_.-]/u.test(line[index] ?? "")) index += 1;
  return index;
}

function yamlKeyValueParts(line: string): { prefix: string; key: string; colon: string; rawValue: string } | undefined {
  const prefixEnd = yamlPrefixEnd(line);
  const keyEnd = yamlKeyEnd(line, prefixEnd);
  if (keyEnd === prefixEnd) return undefined;

  let colonIndex = keyEnd;
  while (isYamlWhitespace(line[colonIndex])) colonIndex += 1;
  if (line[colonIndex] !== ":") return undefined;

  let valueIndex = colonIndex + 1;
  while (isYamlWhitespace(line[valueIndex])) valueIndex += 1;
  return {
    prefix: line.slice(0, prefixEnd),
    key: line.slice(prefixEnd, keyEnd),
    colon: line.slice(keyEnd, valueIndex),
    rawValue: line.slice(valueIndex),
  };
}

function yamlListParts(line: string): { marker: string; content: string } | undefined {
  let index = 0;
  while (isYamlWhitespace(line[index])) index += 1;
  if (line[index] !== "-") return undefined;
  index += 1;
  while (isYamlWhitespace(line[index])) index += 1;
  return { marker: line.slice(0, index), content: line.slice(index) };
}

export function tokenizeYamlLine(line: string, lineIndex: number): YamlToken[] {
  if (!line) return [{ id: `L${lineIndex}-empty`, type: "plain", text: "" }];

  let contentIndex = 0;
  while (isYamlWhitespace(line[contentIndex])) contentIndex += 1;
  if (line[contentIndex] === "#") {
    const indent = line.slice(0, contentIndex);
    const comment = line.slice(contentIndex);
    const tokens: YamlToken[] = [];
    if (indent) tokens.push({ id: `L${lineIndex}-indent`, type: "plain", text: indent });
    tokens.push({ id: `L${lineIndex}-comment`, type: "comment", text: comment });
    return tokens;
  }

  const keyValue = yamlKeyValueParts(line);
  if (keyValue) {
    const { prefix, key, colon, rawValue } = keyValue;
    const tokens: YamlToken[] = [];
    if (prefix) tokens.push({ id: `L${lineIndex}-prefix`, type: "punctuation", text: prefix });
    tokens.push(
      { id: `L${lineIndex}-k-${key}`, type: "key", text: key },
      { id: `L${lineIndex}-colon`, type: "punctuation", text: colon },
    );

    if (rawValue) {
      const trimmedVal = rawValue.trim();
      if (trimmedVal === "true" || trimmedVal === "false") {
        tokens.push({ id: `L${lineIndex}-bool`, type: "boolean", text: rawValue });
      } else if (/^\d+(?:\.\d+)?$/u.test(trimmedVal)) {
        tokens.push({ id: `L${lineIndex}-num`, type: "number", text: rawValue });
      } else {
        tokens.push({ id: `L${lineIndex}-str`, type: "string", text: rawValue });
      }
    }
    return tokens;
  }

  const list = yamlListParts(line);
  if (list) {
    return [
      { id: `L${lineIndex}-marker`, type: "punctuation", text: list.marker },
      { id: `L${lineIndex}-item`, type: "string", text: list.content },
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
      return "text-muted-foreground italic";
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
          <code className="block min-w-max">
            {lineTokens.map((item) => (
              <span key={item.id} className="flex">
                <span className="w-10 shrink-0 select-none pr-4 text-right font-mono text-micro text-muted-foreground">
                  {item.lineNumber}
                </span>
                <span className="whitespace-pre">
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
