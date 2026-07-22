from pathlib import Path

path = Path("tests/integration/control-plane-operations-postgres.test.ts")
text = path.read_text()
old = '''    const operationId = randomUUID();
    const first = await store.replayDeadLetter({
      installationId: tenant.installationId,
      itemType: "job",
      itemId: jobId,
      operationId,
      actorId: "operator-a",
    });
    expect(first).toMatchObject({ outcome: "replayed" });
    expect(first.auditEventId).toBeTruthy();
    await expect(
      store.replayDeadLetter({
        installationId: tenant.installationId,
        itemType: "job",
        itemId: jobId,
        operationId,
        actorId: "operator-a",
      }),
    ).resolves.toEqual({ outcome: "already_applied", auditEventId: first.auditEventId });
'''
new = '''    const operationId = randomUUID();
    const replayInput = {
      installationId: tenant.installationId,
      itemType: "job" as const,
      itemId: jobId,
      operationId,
      actorId: "operator-a",
    };
    const results = await Promise.all([
      store.replayDeadLetter(replayInput),
      store.replayDeadLetter(replayInput),
    ]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["already_applied", "replayed"]);
    const auditEventIds = new Set(results.map((result) => result.auditEventId));
    expect(auditEventIds.size).toBe(1);
    expect([...auditEventIds][0]).toBeTruthy();
'''
if text.count(old) != 1:
    raise SystemExit(f"expected one replay assertion block, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
