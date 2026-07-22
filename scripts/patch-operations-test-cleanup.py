from pathlib import Path

path = Path("tests/integration/control-plane-operations-postgres.test.ts")
text = path.read_text()
old = '''async function cleanup(): Promise<void> {
  if (!executor) return;
  await executor.query("delete from installations where account_login like $1", [`${testPrefix}%`]);
}
'''
new = '''async function cleanup(): Promise<void> {
  if (!executor) return;
  await executor.query("delete from webhook_inbox where delivery_id like $1", [`${testPrefix}%`]);
  await executor.query("delete from installations where account_login like $1", [`${testPrefix}%`]);
}
'''
if text.count(old) != 1:
    raise SystemExit(f"expected one cleanup block, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
