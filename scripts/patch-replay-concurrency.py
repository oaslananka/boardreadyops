from pathlib import Path

path = Path("packages/db/migrations/0019_control_plane_reconciliation_operations.sql")
text = path.read_text()
replacements = [
    (
        "  audit_event_id text references audit_events(id) on delete restrict,",
        "  audit_event_id text references audit_events(id) on delete set null,",
        "audit replay reference",
    ),
    (
        "begin\n  select * into v_existing\n    from control_plane_replay_operations",
        "begin\n  perform pg_advisory_xact_lock(\n    hashtextextended(p_installation_id || ':' || p_operation_id, 0)\n  );\n\n  select * into v_existing\n    from control_plane_replay_operations",
        "replay operation lock",
    ),
]
for old, new, label in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    text = text.replace(old, new, 1)
path.write_text(text)
