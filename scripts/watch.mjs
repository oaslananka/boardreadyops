import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["scripts/build.mjs", "--watch"], {
  stdio: "inherit",
  shell: false,
  windowsHide: true,
});

child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
