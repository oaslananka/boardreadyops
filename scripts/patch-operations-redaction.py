from pathlib import Path

path = Path("packages/db/src/control-plane-operations-store.ts")
text = path.read_text()
old_constants = '''const credentialAssignmentPattern =
  /\\b(authorization|cookie|credential|password|private[_-]?key|secret|token)\\s*[=:]\\s*(?:"[^"]*"|'[^']*'|[^\\s,;]+)/giu;
const bearerPattern = /\\bBearer\\s+[a-z0-9._~+/=-]+/giu;
'''
new_constants = '''const credentialAssignmentKeyPatterns = [
  "authorization",
  "cookie",
  "credential",
  "password",
  "private[_-]?key",
  "secret",
  "token",
] as const;
const bearerPattern = /\\bBearer\\s+[a-z0-9._~+/=-]+/giu;
'''
old_function = '''function boundedFailure(value: string, maximum: number, fallback: string): string {
  const normalized = value
    .replace(bearerPattern, "Bearer [REDACTED]")
    .replace(credentialAssignmentPattern, "$1=[REDACTED]")
    .replace(/[\\r\\n\\t]+/gu, " ")
    .trim();
  return (normalized || fallback).slice(0, maximum);
}
'''
new_function = '''function redactCredentialAssignments(value: string): string {
  return credentialAssignmentKeyPatterns.reduce((redacted, keyPattern) => {
    const assignmentPattern = new RegExp(
      `\\\\b${keyPattern}\\\\s*[=:]\\\\s*(?:"[^"]*"|'[^']*'|[^\\\\s,;]+)`,
      "giu",
    );
    return redacted.replace(assignmentPattern, "credential=[REDACTED]");
  }, value);
}

function boundedFailure(value: string, maximum: number, fallback: string): string {
  const normalized = redactCredentialAssignments(value.replace(bearerPattern, "Bearer [REDACTED]"))
    .replace(/[\\r\\n\\t]+/gu, " ")
    .trim();
  return (normalized || fallback).slice(0, maximum);
}
'''
for old, new, label in [
    (old_constants, new_constants, "credential constants"),
    (old_function, new_function, "bounded failure function"),
]:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    text = text.replace(old, new, 1)
path.write_text(text)
