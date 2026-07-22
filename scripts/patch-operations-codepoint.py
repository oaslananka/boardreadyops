from pathlib import Path

path = Path("packages/db/src/control-plane-operations-store.ts")
text = path.read_text()
old = '  const code = value.toLowerCase().charCodeAt(0);\n'
new = '  const code = value.toLowerCase().codePointAt(0) ?? -1;\n'
if text.count(old) != 1:
    raise SystemExit(f"expected one identifier code lookup, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
