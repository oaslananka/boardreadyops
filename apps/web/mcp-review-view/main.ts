import { App } from "@modelcontextprotocol/ext-apps";
import { updateReviewToolResult } from "./review-evidence.js";

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

const elements = { status, heading, counts, provenance, detailButton, initialHeading: heading.textContent };
app.ontoolresult = (result) => updateReviewToolResult(elements, result);

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
