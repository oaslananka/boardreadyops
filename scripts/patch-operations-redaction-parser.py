from pathlib import Path

source = Path("packages/db/src/control-plane-operations-store.ts")
text = source.read_text()
old_constants = '''const credentialAssignmentKeyPatterns = [
  "authorization",
  "cookie",
  "credential",
  "password",
  "private[_-]?key",
  "secret",
  "token",
] as const;
'''
new_constants = '''const credentialAssignmentKeys = [
  "authorization",
  "cookie",
  "credential",
  "password",
  "private-key",
  "private_key",
  "privatekey",
  "secret",
  "token",
] as const;
'''
old_function = '''function redactCredentialAssignments(value: string): string {
  return credentialAssignmentKeyPatterns.reduce((redacted, keyPattern) => {
    const assignmentPattern = new RegExp(`\\b${keyPattern}\\s*[=:]\\s*(?:"[^"]*"|'[^']*'|[^\\s,;]+)`, "giu");
    return redacted.replace(assignmentPattern, "credential=[REDACTED]");
  }, value);
}
'''
new_function = '''function isIdentifierCharacter(value: string | undefined): boolean {
  if (!value) return false;
  const code = value.toLowerCase().charCodeAt(0);
  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || value === "_";
}

function isAssignmentWhitespace(value: string | undefined): boolean {
  return value === " " || value === "\\t" || value === "\\r" || value === "\\n";
}

function assignmentValueEnd(value: string, start: number): number {
  const quote = value[start];
  if (quote === '"' || quote === "'") {
    const closingQuote = value.indexOf(quote, start + 1);
    return closingQuote === -1 ? value.length : closingQuote + 1;
  }

  let cursor = start;
  while (
    cursor < value.length &&
    !isAssignmentWhitespace(value[cursor]) &&
    value[cursor] !== "," &&
    value[cursor] !== ";"
  ) {
    cursor += 1;
  }
  return cursor;
}

function redactCredentialAssignment(value: string, key: string): string {
  const normalized = value.toLowerCase();
  let searchFrom = 0;
  let copiedUntil = 0;
  let redacted = "";

  while (searchFrom < value.length) {
    const keyIndex = normalized.indexOf(key, searchFrom);
    if (keyIndex === -1) break;

    const keyEnd = keyIndex + key.length;
    if (isIdentifierCharacter(normalized[keyIndex - 1]) || isIdentifierCharacter(normalized[keyEnd])) {
      searchFrom = keyEnd;
      continue;
    }

    let cursor = keyEnd;
    while (isAssignmentWhitespace(value[cursor])) cursor += 1;
    if (value[cursor] !== "=" && value[cursor] !== ":") {
      searchFrom = keyEnd;
      continue;
    }

    cursor += 1;
    while (isAssignmentWhitespace(value[cursor])) cursor += 1;
    const valueEnd = assignmentValueEnd(value, cursor);
    redacted += `${value.slice(copiedUntil, keyIndex)}credential=[REDACTED]`;
    copiedUntil = valueEnd;
    searchFrom = valueEnd;
  }

  return redacted ? redacted + value.slice(copiedUntil) : value;
}

function redactCredentialAssignments(value: string): string {
  return credentialAssignmentKeys.reduce(redactCredentialAssignment, value);
}
'''
for old, new, label in [
    (old_constants, new_constants, "credential keys"),
    (old_function, new_function, "credential parser"),
]:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    text = text.replace(old, new, 1)
source.write_text(text)

test = Path("tests/unit/db/control-plane-operations-store.test.ts")
text = test.read_text()
old_assertions = '''        expect(String(params?.[5])).not.toContain("x".repeat(20));
        expect(String(params?.[5])).toContain("[REDACTED]");
'''
new_assertions = '''        expect(String(params?.[5])).not.toContain("x".repeat(20));
        expect(String(params?.[5])).not.toContain("private-value");
        expect(String(params?.[5])).not.toContain("session-value");
        expect(String(params?.[5])).toContain("[REDACTED]");
'''
old_message = '''        errorMessage: `authorization=Bearer ${"x".repeat(200)}`,
'''
new_message = '''        errorMessage: `authorization=Bearer ${"x".repeat(200)} private_key='private-value' cookie=session-value`,
'''
for old, new, label in [
    (old_assertions, new_assertions, "redaction assertions"),
    (old_message, new_message, "redaction fixture"),
]:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    text = text.replace(old, new, 1)
test.write_text(text)
