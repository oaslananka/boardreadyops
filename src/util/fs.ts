import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export async function sha256File(file: string): Promise<{ sha256: string; bytes: number }> {
  const content = await fs.readFile(file);
  return { sha256: createHash("sha256").update(content).digest("hex"), bytes: content.byteLength };
}

export async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function readTextFile(file: string): Promise<string> {
  const text = await fs.readFile(file, "utf8");
  // Node's utf8 decoder does not strip a leading UTF-8 BOM (U+FEFF); it stays as the first
  // character. Common exporters (Excel, some KiCad BOM plugins) write one, which would
  // otherwise corrupt the first CSV header cell or make JSON.parse/YAML parsing fail.
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export async function writeTextFile(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, "utf8");
}

export async function fileMtimeMs(file: string): Promise<number | undefined> {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return undefined;
  }
}
