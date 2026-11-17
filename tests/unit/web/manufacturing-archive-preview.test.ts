import { createHash } from "node:crypto";
import { deflateRawSync, gzipSync } from "node:zlib";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ManufacturingArchivePreview } from "../../../apps/web/components/manufacturing-archive-preview.js";
import { inspectDownloadedManufacturingArchive } from "../../../apps/web/components/manufacturing-archive-preview-parser.js";

const sourceSha = "a".repeat(40);
const prefix = "build/boardreadyops-attested/";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function tarFile(name: string, data: Uint8Array, type = "0"): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8);
  header.write("0000000\0", 108, 8);
  header.write("0000000\0", 116, 8);
  header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124, 12);
  header.write("00000000000\0", 136, 12);
  header.fill(32, 148, 156);
  header.write(type, 156, 1);
  header.write("ustar\0", 257, 6);
  header.write("00", 263, 2);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, Buffer.from(data), pad]);
}

function archiveFixture(
  options: {
    sourceSha?: string;
    invalidDigest?: boolean;
    extraPath?: string;
    symlink?: boolean;
    omitBom?: boolean;
  } = {},
) {
  const encode = (value: string): Uint8Array => Buffer.from(value, "utf8");
  const outputs = [
    { path: "gerbers/demo-F_Cu.gtl", kind: "gerber", data: encode("G04 KiCad Gerber*\n") },
    { path: "gerbers/demo-job.gbrjob", kind: "gerber", data: encode('{"FileFunction":"Copper"}') },
    { path: "drill/demo.drl", kind: "drill", data: encode("M48\nM30\n") },
    ...(options.omitBom
      ? []
      : [
          {
            path: "assembly/bom.csv",
            kind: "bom",
            data: encode(
              '"Refs","Value","Footprint","Qty","DNP"\r\n"R1,R2","10k","R_0603","2",""\r\n"C1","100nF","C_0603","1",""\r\n',
            ),
          },
        ]),
    { path: "assembly/positions.csv", kind: "cpl", data: encode("Ref,Val,PosX,PosY\nR1,10k,5,10\nC1,100nF,7,8\n") },
  ];
  const manifest = {
    kind: "boardreadyops.export-provenance",
    sourceSnapshot: "stable",
    git: { sha: options.sourceSha ?? sourceSha, dirty: false },
    steps: [
      { kind: "gerbers", files: 2, status: "generated" },
      { kind: "drill", files: 1, status: "generated" },
    ],
    artifacts: outputs.map((item) => ({
      path: item.path,
      kind: item.kind,
      bytes: item.data.length,
      sha256: options.invalidDigest && item.path.endsWith(".gtl") ? "f".repeat(64) : sha256(item.data),
    })),
  };
  const entries = [
    ...outputs.map((item) => tarFile(prefix + item.path, item.data)),
    tarFile(`${prefix}manifest.json`, encode(JSON.stringify(manifest))),
    tarFile("bundle.sigstore.json", encode('{"bundle":"recorded"}')),
    ...(options.extraPath ? [tarFile(options.extraPath, encode("unsafe"))] : []),
    ...(options.symlink ? [tarFile(`${prefix}link`, new Uint8Array(), "2")] : []),
  ];
  const compressed = gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
  return {
    file: new Blob([new Uint8Array(compressed)]),
    expected: { bytes: compressed.length, sha256: sha256(compressed), sourceSha },
  };
}

/** A GitHub Actions-style ZIP wrapper, including the streaming data descriptor. */
async function githubArtifactZip(
  entries: readonly { name: string; data: Uint8Array; method?: 0 | 8 }[],
): Promise<Blob> {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(entry.data);
    const method = entry.method ?? 8;
    const compressed = method === 8 ? deflateRawSync(raw) : raw;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 6); // data descriptor
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(name.length, 26);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(compressed.length, 8);
    descriptor.writeUInt32LE(raw.length, 12);
    locals.push(header, name, compressed, descriptor);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += header.length + name.length + compressed.length + descriptor.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Blob([new Uint8Array(Buffer.concat([...locals, directory, end]))]);
}

describe("GitHub Actions ZIP manufacturing preview", () => {
  it.each([0, 8] as const)(
    "accepts the downloaded GitHub ZIP with compression method %i and checks inner source and digests",
    async (method) => {
      const { file, expected } = archiveFixture();
      const zip = await githubArtifactZip([
        {
          name: "boardreadyops-manufacturing-export.tar.gz",
          data: new Uint8Array(await file.arrayBuffer()),
          method,
        },
      ]);
      const result = await inspectDownloadedManufacturingArchive(zip, expected);
      expect(result).toMatchObject({ sourceSha, sha256: expected.sha256, totalBomRows: 2, outputCount: 5 });
    },
  );

  it("rejects extra files and unsafe paths in the downloaded ZIP", async () => {
    const { file, expected } = archiveFixture();
    const data = new Uint8Array(await file.arrayBuffer());
    const extra = await githubArtifactZip([
      { name: "boardreadyops-manufacturing-export.tar.gz", data },
      { name: "unrelated.txt", data: new Uint8Array([1]) },
    ]);
    await expect(inspectDownloadedManufacturingArchive(extra, expected)).rejects.toThrow(
      /ZIP.*(one|single|unexpected)/i,
    );
    const traversal = await githubArtifactZip([{ name: "../boardreadyops-manufacturing-export.tar.gz", data }]);
    await expect(inspectDownloadedManufacturingArchive(traversal, expected)).rejects.toThrow(/ZIP.*(path|name)/i);
  });

  it("never trusts an inner gzip that differs from the recorded run digest", async () => {
    const { file, expected } = archiveFixture();
    const corrupt = new Uint8Array(await file.arrayBuffer());
    corrupt[corrupt.length - 3] ^= 0x01;
    const zip = await githubArtifactZip([{ name: "boardreadyops-manufacturing-export.tar.gz", data: corrupt }]);
    await expect(inspectDownloadedManufacturingArchive(zip, expected)).rejects.toThrow("SHA-256 mismatch");
  });
});

describe("downloaded manufacturing preview: integrity and source-bound BOM", () => {
  it("checks the recorded archive and every manifest-listed Gerber, drill, BOM and placement file", async () => {
    const { file, expected } = archiveFixture();
    const result = await inspectDownloadedManufacturingArchive(file, expected);
    expect(result).toMatchObject({
      sha256: expected.sha256,
      sourceSha,
      outputCount: 5,
      totalBomRows: 2,
      positionRows: 2,
    });
    expect(result.gerberLayers).toEqual([{ name: "gerbers/demo-F_Cu.gtl", bytes: 18 }]);
    expect(result.gerberJobs).toHaveLength(1);
    expect(result.drills).toHaveLength(1);
    expect(result.bomHeaders).toEqual(["Refs", "Value", "Footprint", "Qty", "DNP"]);
    expect(result.bomRows[0]).toEqual(["R1,R2", "10k", "R_0603", "2", ""]);
    expect(result.bomRows[1]?.[0]).toBe("C1");
  });

  it("rejects the wrong file and an archive bound to a different source commit", async () => {
    const { file, expected } = archiveFixture();
    await expect(inspectDownloadedManufacturingArchive(file, { ...expected, sha256: "0".repeat(64) })).rejects.toThrow(
      "SHA-256 mismatch",
    );
    await expect(
      inspectDownloadedManufacturingArchive(file, { ...expected, bytes: expected.bytes + 1 }),
    ).rejects.toThrow("size does not match");
    const wrongSource = archiveFixture({ sourceSha: "b".repeat(40) });
    await expect(inspectDownloadedManufacturingArchive(wrongSource.file, wrongSource.expected)).rejects.toThrow(
      "does not match this run",
    );
  });

  it("rejects tampered inner digests, extra members, path traversal and links, even when outer digest matches", async () => {
    const invalidDigest = archiveFixture({ invalidDigest: true });
    await expect(inspectDownloadedManufacturingArchive(invalidDigest.file, invalidDigest.expected)).rejects.toThrow(
      "does not match the manifest digest",
    );
    const hidden = archiveFixture({ extraPath: `${prefix}unexpected.txt` });
    await expect(inspectDownloadedManufacturingArchive(hidden.file, hidden.expected)).rejects.toThrow(
      "unrecorded files",
    );
    const traversed = archiveFixture({ extraPath: `${prefix}../secret.txt` });
    await expect(inspectDownloadedManufacturingArchive(traversed.file, traversed.expected)).rejects.toThrow(
      "unsafe manufacturing archive path",
    );
    const linked = archiveFixture({ symlink: true });
    await expect(inspectDownloadedManufacturingArchive(linked.file, linked.expected)).rejects.toThrow(
      "Unsupported manufacturing archive member type",
    );
  });

  it("does not fabricate BOM rows when this archive has no BOM", async () => {
    const { file, expected } = archiveFixture({ omitBom: true });
    const result = await inspectDownloadedManufacturingArchive(file, expected);
    expect(result.bomHeaders).toEqual([]);
    expect(result.bomRows).toEqual([]);
    expect(result.totalBomRows).toBe(0);
    expect(result.gerberLayers).toHaveLength(1);
  });

  it("rejects invalid gzip even when the selected bytes match the recorded checksum", async () => {
    const bytes = Buffer.from("not a gzip");
    const file = new Blob([new Uint8Array(bytes)]);
    await expect(
      inspectDownloadedManufacturingArchive(file, {
        bytes: bytes.length,
        sha256: sha256(bytes),
        sourceSha,
      }),
    ).rejects.toThrow("not a supported gzip");
  });
});

describe("manufacturing package review affordance", () => {
  it("offers a private local chooser and an existing GitHub download, never a fabrication approval", () => {
    const html = renderToStaticMarkup(
      createElement(ManufacturingArchivePreview, {
        archive: {
          name: "signed-manufacturing-export.tar.gz",
          sha256: "e".repeat(64),
          bytes: 2048,
          downloadUrl: "https://github.com/octo/board/actions/runs/12/artifacts/45",
        },
        sourceSha,
        runId: "run-1",
      }),
    );
    expect(html).toContain("Preview verified BOM and fabrication files");
    expect(html).toContain("file");
    expect(html).toContain("never uploaded to BoardReadyOps");
    expect(html).toContain("Open the GitHub artifact ZIP");
    expect(html).toContain("Select the downloaded ZIP directly");
    expect(html).toContain(".zip,.gz,.tgz");
    expect(html).toContain("not a fabrication approval"); // initial summary must never assert approval
  });

  it("offers direct preview only for a recorded archive download route, never an arbitrary GitHub URL", () => {
    const directUrl =
      "https://boardreadyops.example/api/v1/runs/run-1/artifacts/11111111-1111-4111-8111-111111111111/download?exp=123&sig=test";
    const props = {
      sourceSha,
      runId: "run-1",
      archive: {
        name: "signed-manufacturing-export.tar.gz",
        sha256: "e".repeat(64),
        bytes: 2048,
        downloadUrl: directUrl,
      },
    };
    const page = renderToStaticMarkup(createElement(ManufacturingArchivePreview, props));
    expect(page).toContain("Inspect BOM and Gerber inventory");
    expect(page).toContain("Use a downloaded copy instead");
    expect(page).toContain('type="file"');
    const relativePage = renderToStaticMarkup(
      createElement(ManufacturingArchivePreview, {
        ...props,
        archive: { ...props.archive, downloadUrl: directUrl.slice("https://boardreadyops.example".length) },
      }),
    );
    expect(relativePage).toContain("Inspect BOM and Gerber inventory");
    const external = renderToStaticMarkup(
      createElement(ManufacturingArchivePreview, {
        ...props,
        archive: { ...props.archive, downloadUrl: "https://github.com/octo/board/actions/runs/12/artifacts/45" },
      }),
    );
    expect(external).not.toContain("Inspect BOM and Gerber inventory");
    expect(external).toContain("Select the downloaded ZIP directly");
  });

  it("keeps the signed download lazy until the user selects a one-click browser preview", async () => {
    const { file, expected } = archiveFixture();
    const url =
      "https://boardreadyops.example/api/v1/runs/run-1/artifacts/11111111-1111-4111-8111-111111111111/download?exp=123&sig=test";
    const win = new Window({ url: "https://boardreadyops.example" });
    const keys = [
      "window",
      "self",
      "document",
      "Node",
      "Element",
      "HTMLElement",
      "IS_REACT_ACT_ENVIRONMENT",
      "fetch",
    ] as const;
    const saved = Object.fromEntries(keys.map((key) => [key, Reflect.get(globalThis, key)]));
    const request = vi.fn(
      async () =>
        new Response(await file.arrayBuffer(), {
          status: 200,
          headers: { "content-type": "application/gzip", "content-length": String(expected.bytes) },
        }),
    );
    Object.assign(globalThis, {
      window: win,
      self: win,
      document: win.document,
      Node: win.Node,
      Element: win.Element,
      HTMLElement: win.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: true,
      fetch: request,
    });
    const host = win.document.createElement("div");
    win.document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          createElement(ManufacturingArchivePreview, {
            archive: {
              name: "signed-manufacturing-export.tar.gz",
              sha256: expected.sha256,
              bytes: expected.bytes,
              downloadUrl: url,
            },
            sourceSha,
            runId: "run-1",
          }),
        );
      });
      expect(request).not.toHaveBeenCalled();
      const button = [...host.querySelectorAll("button")].find((item) =>
        item.textContent?.includes("Inspect BOM and Gerber inventory"),
      );
      expect(button).toBeDefined();
      await act(async () => {
        button?.click();
      });
      await vi.waitFor(
        async () => {
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
          });
          expect(host.textContent).toContain("Recorded SHA-256 and source commit match");
        },
        { timeout: 10_000, interval: 20 },
      );
      expect(request).toHaveBeenCalledOnce();
      expect(host.textContent).toContain("Bill of materials");
      expect(host.textContent).toContain("R1,R2");
      expect(host.textContent).toContain("This is not a fabrication approval");
    } finally {
      await act(async () => root.unmount());
      for (const key of keys) {
        const prior = saved[key];
        if (prior === undefined) Reflect.deleteProperty(globalThis, key);
        else Reflect.set(globalThis, key, prior);
      }
      await win.happyDOM.abort();
    }
  });

  it("opens the selected file in the browser without a network request or server upload", async () => {
    const { file, expected } = archiveFixture();
    const win = new Window({ url: "https://boardreadyops.example" });
    const keys = ["window", "self", "document", "Node", "Element", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"] as const;
    const saved = Object.fromEntries(keys.map((key) => [key, Reflect.get(globalThis, key)]));
    Object.assign(globalThis, {
      window: win,
      self: win,
      document: win.document,
      Node: win.Node,
      Element: win.Element,
      HTMLElement: win.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    const host = win.document.createElement("div");
    win.document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          createElement(ManufacturingArchivePreview, {
            archive: {
              name: "signed-manufacturing-export.tar.gz",
              sha256: expected.sha256,
              bytes: expected.bytes,
              downloadUrl: "https://github.com/octo/board/actions/runs/12/artifacts/45",
            },
            sourceSha,
            runId: "run-1",
          }),
        );
      });
      const picker = host.querySelector('input[type="file"]');
      expect(picker).not.toBeNull();
      const localFile = new win.File([new Uint8Array(await file.arrayBuffer())], "signed-manufacturing-export.tar.gz", {
        type: "application/gzip",
      });
      // Simulate a slow local File read so the test must wait for verification to finish,
      // rather than assuming a fixed number of milliseconds is enough on CI runners.
      const readFileBytes = localFile.arrayBuffer.bind(localFile);
      Object.defineProperty(localFile, "arrayBuffer", {
        value: async () => {
          await new Promise((resolve) => setTimeout(resolve, 150));
          return await readFileBytes();
        },
      });
      Object.defineProperty(picker, "files", { configurable: true, value: [localFile] });
      await act(async () => {
        picker?.dispatchEvent(new win.Event("change", { bubbles: true }));
      });
      expect(host.textContent).toContain("Checking archive integrity and source evidence");
      await vi.waitFor(
        async () => {
          // Run asynchronous digest/decompression work inside React's act boundary
          // and only unmount after the verified browser UI has actually rendered.
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
          });
          expect(host.textContent).toContain("Recorded SHA-256 and source commit match");
        },
        { timeout: 10_000, interval: 20 },
      );
      expect(host.textContent).toContain("R1,R2");
      expect(host.textContent).toContain("Bill of materials");
      expect(host.querySelector('a[href="/runs/run-1/design"]')).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      for (const key of keys) {
        const prior = saved[key];
        if (prior === undefined) Reflect.deleteProperty(globalThis, key);
        else Reflect.set(globalThis, key, prior);
      }
      await win.happyDOM.abort();
    }
  });

  it("supports offline reinspection when the source download has expired", () => {
    const html = renderToStaticMarkup(
      createElement(ManufacturingArchivePreview, {
        archive: {
          name: "signed-manufacturing-export.tar.gz",
          sha256: "d".repeat(64),
          bytes: 2048,
          downloadUrl: undefined,
        },
        sourceSha,
        runId: "run-1",
      }),
    );
    expect(html).toContain("already downloaded copy can still be checked");
    expect(html).not.toContain("Open the GitHub artifact ZIP");
  });
});
