from pathlib import Path

path = Path("packages/db/src/control-plane-operations-store.ts")
text = path.read_text()
old = '''class DatabaseRow {
  constructor(private readonly value: Record<string, unknown> | undefined) {}

  text(column: string): string | undefined {
    const value = this.value?.[column];
    return typeof value === "string" ? value : undefined;
  }

  integer(column: string): number | undefined {
    const value = this.value?.[column];
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
    if (typeof value === "string" && /^\\d+$/u.test(value)) return Number(value);
    return undefined;
  }

  boolean(column: string): boolean | undefined {
    const value = this.value?.[column];
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "t") return true;
    if (value === "false" || value === "f") return false;
    return undefined;
  }

  timestamp(column: string): string | undefined {
    const value = this.value?.[column];
    if (value instanceof Date && Number.isFinite(value.valueOf())) return value.toISOString();
    if (typeof value !== "string") return undefined;
    const parsed = new Date(value);
    return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : undefined;
  }
}
'''
new = '''class DatabaseRow {
  constructor(private readonly columns: Record<string, unknown> | undefined) {}

  private column(name: string): unknown {
    return this.columns?.[name];
  }

  text(name: string): string | undefined {
    const candidate = this.column(name);
    if (typeof candidate !== "string") return undefined;
    return candidate;
  }

  integer(name: string): number | undefined {
    const candidate = this.column(name);
    if (typeof candidate === "number") {
      return Number.isSafeInteger(candidate) ? candidate : undefined;
    }
    if (typeof candidate !== "string" || !/^\\d+$/u.test(candidate)) return undefined;
    return Number(candidate);
  }

  boolean(name: string): boolean | undefined {
    const candidate = this.column(name);
    if (typeof candidate === "boolean") return candidate;
    if (candidate === "true" || candidate === "t") return true;
    if (candidate === "false" || candidate === "f") return false;
    return undefined;
  }

  timestamp(name: string): string | undefined {
    const candidate = this.column(name);
    if (candidate instanceof Date && Number.isFinite(candidate.valueOf())) {
      return candidate.toISOString();
    }
    if (typeof candidate !== "string") return undefined;
    const parsed = new Date(candidate);
    return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : undefined;
  }
}
'''
if text.count(old) != 1:
    raise SystemExit(f"expected one row decoder block, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
