import { App } from "@modelcontextprotocol/ext-apps";

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required Review view element: ${id}`);
  return element;
}
const status = requiredElement("status");
const heading = requiredElement("heading");
const counts = requiredElement("counts");
const provenance = requiredElement("provenance");
const detailButton = requiredElement("detail-button") as HTMLButtonElement;

const app = new App({ name: "BoardReadyOps Review", version: "0.1.0" });

function display(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    status.textContent = "Source evidence unavailable";
    return;
  }
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== 1 || v.scope !== "pcb-footprints-only" || v.disclosure !== "counts-and-digests-only") {
    status.textContent = "No verified PCB footprint summary for this review";
    return;
  }
  const change = v.changes;
  if (!change || typeof change !== "object" || Array.isArray(change)) return;
  const c = change as Record<string, unknown>;
  const values = [c.added, c.removed, c.modified];
  if (!values.every((x) => typeof x === "number" && Number.isSafeInteger(x) && x >= 0)) return;
  heading.textContent = "Source-linked footprint changes";
  counts.textContent = `${values[0]} added · ${values[1]} removed · ${values[2]} modified`;
  status.textContent = "One KiCad PCB file · client-reported Git evidence · risk not evaluated";
  const baseCommit = typeof v.baseCommitSha === "string" ? v.baseCommitSha : "unavailable";
  const headCommit = typeof v.headCommitSha === "string" ? v.headCommitSha : "unavailable";
  provenance.textContent = `Base commit: ${baseCommit}\nHead commit: ${headCommit}`;
  detailButton.hidden = false;
}

app.ontoolresult = (result) => {
  if (result.isError) {
    status.textContent = "Evidence could not be verified. No release decision was made.";
    return;
  }
  try {
    const structured = result.structuredContent;
    const text = result.content?.find((c) => c.type === "text");
    display(structured ?? (text && "text" in text ? JSON.parse(text.text) : null));
  } catch {
    status.textContent = "Evidence unavailable";
  }
};

detailButton.addEventListener("click", () => {
  const open = provenance.hidden;
  provenance.hidden = !open;
  detailButton.textContent = open ? "Hide provenance" : "Show provenance";
});

async function connectReviewView(): Promise<void> {
  try {
    await app.connect();
  } catch {
    status.textContent = "Review widget connection unavailable";
  }
}
void connectReviewView();
