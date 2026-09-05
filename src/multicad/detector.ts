import type { CadFormat } from "@boardreadyops/contracts";

export interface DetectedFormatResult {
  format: CadFormat;
  confidence: number;
  detectedVersion?: string | undefined;
  identifiedRoles: Record<string, string>;
}

export async function detectPackageFormat(
  files: string[],
  headerReader: (path: string) => Promise<string>,
): Promise<DetectedFormatResult> {
  const normalizedFiles = files.map((f) => f.replace(/\\/g, "/"));
  const identifiedRoles: Record<string, string> = {};

  // 1. Check for native KiCad project files
  const hasKicadPcb = normalizedFiles.some((f) => f.endsWith(".kicad_pcb"));
  const hasKicadPro = normalizedFiles.some((f) => f.endsWith(".kicad_pro") || f.endsWith(".pro"));
  const hasKicadSch = normalizedFiles.some((f) => f.endsWith(".kicad_sch") || f.endsWith(".sch"));

  if (hasKicadPcb || (hasKicadPro && hasKicadSch)) {
    return {
      format: "kicad",
      confidence: hasKicadPcb && hasKicadPro ? 0.98 : 0.92,
      identifiedRoles,
    };
  }

  // 2. Check for Autodesk Fusion Electronics / EAGLE
  const hasCamOutputs = normalizedFiles.some((f) => f.includes("CAMOutputs/"));
  if (hasCamOutputs) {
    return {
      format: "fusion360",
      confidence: 0.85,
      identifiedRoles,
    };
  }

  // 3. Check for IPC-2581 single-file packages (.cvg, .ipc, .xml)
  const candidateXmlFiles = normalizedFiles.filter((f) => /\.(cvg|ipc|xml)$/i.test(f));
  for (const file of candidateXmlFiles.slice(0, 3)) {
    try {
      const content = await headerReader(file);
      if (/<IPC-2581/i.test(content)) {
        const revMatch = content.match(/<IPC-2581[^>]*\s(?:revision|version)=["']([^"']+)["']/i);
        return {
          format: "ipc2581",
          confidence: 0.98,
          ...(revMatch?.[1] ? { detectedVersion: revMatch[1] } : {}),
          identifiedRoles,
        };
      }
    } catch {
      // Ignore read failures
    }
  }

  // Read headers for top gerber files (up to 5 files)
  const candidateGerberFiles = normalizedFiles.filter((f) =>
    /\.(gtl|gbl|gto|gbo|gts|gbs|gm\d+|gko|gbr|ger|drl|txt)$/i.test(f),
  );

  let easyEdaMatch = false;
  let altiumMatch = false;
  let altiumVersion: string | undefined;
  let easyEdaVersion: string | undefined;

  for (const file of candidateGerberFiles.slice(0, 5)) {
    try {
      const header = await headerReader(file);
      if (/EasyEDA/i.test(header)) {
        easyEdaMatch = true;
        const verMatch = header.match(/EasyEDA(?:\s+Pro)?\s+v?([0-9.]+)/i);
        if (verMatch) easyEdaVersion = verMatch[1];
        break;
      }
      if (/Altium\s+Designer/i.test(header) || /Protel/i.test(header)) {
        altiumMatch = true;
        const verMatch = header.match(/Altium\s+Designer\s+([0-9.]+)/i);
        if (verMatch) altiumVersion = verMatch[1];
        break;
      }
    } catch {
      // Ignore individual file read errors
    }
  }

  if (easyEdaMatch || normalizedFiles.some((f) => f.startsWith("Gerber_") && f.endsWith(".GTL"))) {
    return {
      format: "easyeda",
      confidence: 0.9,
      detectedVersion: easyEdaVersion,
      identifiedRoles,
    };
  }

  if (altiumMatch) {
    return {
      format: "altium",
      confidence: 0.9,
      detectedVersion: altiumVersion,
      identifiedRoles,
    };
  }

  // Check extensions characteristic of Altium (e.g. GM1, Status Report.Txt)
  const hasProtelExtensions = normalizedFiles.some((f) => /\.(gtl|gbl|gm\d+|gko)$/i.test(f));
  const hasAltiumStatusReport = normalizedFiles.some((f) => /Status\s+Report\.Txt$/i.test(f));
  if (hasProtelExtensions && hasAltiumStatusReport) {
    return {
      format: "altium",
      confidence: 0.85,
      identifiedRoles,
    };
  }

  // Generic Gerber fallback
  const hasAnyGerber = candidateGerberFiles.length > 0;
  if (hasAnyGerber) {
    return {
      format: "generic_gerber",
      confidence: 0.5,
      identifiedRoles,
    };
  }

  return {
    format: "generic_gerber",
    confidence: 0.1,
    identifiedRoles,
  };
}
