import type { CadFormat } from "@boardreadyops/contracts";

export interface DetectedFormatResult {
  format: CadFormat;
  confidence: number;
  detectedVersion?: string | undefined;
  identifiedRoles: Record<string, string>;
}

function detectKicad(files: string[]): DetectedFormatResult | null {
  const hasKicadPcb = files.some((f) => f.endsWith(".kicad_pcb"));
  const hasKicadPro = files.some((f) => f.endsWith(".kicad_pro") || f.endsWith(".pro"));
  const hasKicadSch = files.some((f) => f.endsWith(".kicad_sch") || f.endsWith(".sch"));
  if (!hasKicadPcb && !(hasKicadPro && hasKicadSch)) return null;

  return {
    format: "kicad",
    confidence: hasKicadPcb && hasKicadPro ? 0.98 : 0.92,
    identifiedRoles: {},
  };
}

function detectFusion360(files: string[]): DetectedFormatResult | null {
  if (!files.some((f) => f.includes("CAMOutputs/"))) return null;
  return { format: "fusion360", confidence: 0.85, identifiedRoles: {} };
}

async function detectIpc2581(
  files: string[],
  headerReader: (path: string) => Promise<string>,
): Promise<DetectedFormatResult | null> {
  const candidates = files.filter((f) => /\.(cvg|ipc|xml)$/i.test(f)).slice(0, 3);

  for (const file of candidates) {
    try {
      const content = await headerReader(file);
      if (!/<IPC-2581/i.test(content)) continue;

      const revMatch = /<IPC-2581[^>]*\s(?:revision|version)=["']([^"']+)["']/i.exec(content);
      return {
        format: "ipc2581",
        confidence: 0.98,
        ...(revMatch?.[1] ? { detectedVersion: revMatch[1] } : {}),
        identifiedRoles: {},
      };
    } catch {
      // Ignore read failures
    }
  }

  return null;
}

interface GerberHeaderScan {
  easyEdaMatch: boolean;
  altiumMatch: boolean;
  easyEdaVersion: string | undefined;
  altiumVersion: string | undefined;
}

async function scanGerberHeaders(
  files: string[],
  headerReader: (path: string) => Promise<string>,
): Promise<GerberHeaderScan> {
  const scan: GerberHeaderScan = {
    easyEdaMatch: false,
    altiumMatch: false,
    easyEdaVersion: undefined,
    altiumVersion: undefined,
  };

  for (const file of files.slice(0, 5)) {
    try {
      const header = await headerReader(file);
      if (/EasyEDA/i.test(header)) {
        scan.easyEdaMatch = true;
        scan.easyEdaVersion = /EasyEDA(?:\s+Pro)?\s+v?([0-9.]+)/i.exec(header)?.[1];
        break;
      }
      if (/Altium\s+Designer/i.test(header) || /Protel/i.test(header)) {
        scan.altiumMatch = true;
        scan.altiumVersion = /Altium\s+Designer\s+([0-9.]+)/i.exec(header)?.[1];
        break;
      }
    } catch {
      // Ignore individual file read errors
    }
  }

  return scan;
}

function detectAltiumByExtensions(files: string[]): DetectedFormatResult | null {
  const hasProtelExtensions = files.some((f) => /\.(gtl|gbl|gm\d+|gko)$/i.test(f));
  const hasAltiumStatusReport = files.some((f) => /Status\s+Report\.Txt$/i.test(f));
  if (!hasProtelExtensions || !hasAltiumStatusReport) return null;

  return { format: "altium", confidence: 0.85, identifiedRoles: {} };
}

export async function detectPackageFormat(
  files: string[],
  headerReader: (path: string) => Promise<string>,
): Promise<DetectedFormatResult> {
  const normalizedFiles = files.map((f) => f.replaceAll("\\", "/"));

  const kicad = detectKicad(normalizedFiles);
  if (kicad) return kicad;

  const fusion360 = detectFusion360(normalizedFiles);
  if (fusion360) return fusion360;

  const ipc2581 = await detectIpc2581(normalizedFiles, headerReader);
  if (ipc2581) return ipc2581;

  const candidateGerberFiles = normalizedFiles.filter((f) =>
    /\.(gtl|gbl|gto|gbo|gts|gbs|gm\d+|gko|gbr|ger|drl|txt)$/i.test(f),
  );
  const headerScan = await scanGerberHeaders(candidateGerberFiles, headerReader);

  if (headerScan.easyEdaMatch || normalizedFiles.some((f) => f.startsWith("Gerber_") && f.endsWith(".GTL"))) {
    return {
      format: "easyeda",
      confidence: 0.9,
      detectedVersion: headerScan.easyEdaVersion,
      identifiedRoles: {},
    };
  }

  if (headerScan.altiumMatch) {
    return {
      format: "altium",
      confidence: 0.9,
      detectedVersion: headerScan.altiumVersion,
      identifiedRoles: {},
    };
  }

  const altiumByExtensions = detectAltiumByExtensions(normalizedFiles);
  if (altiumByExtensions) return altiumByExtensions;

  return {
    format: "generic_gerber",
    confidence: candidateGerberFiles.length > 0 ? 0.5 : 0.1,
    identifiedRoles: {},
  };
}
