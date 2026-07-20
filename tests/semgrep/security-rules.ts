import { exec, execFile, spawn } from "node:child_process";
import https from "node:https";

declare const userInput: string;

// ruleid: boardreadyops.security.no-dynamic-code-execution
eval(userInput);

// ruleid: boardreadyops.security.no-dynamic-code-execution
new Function(userInput);

// ok: boardreadyops.security.no-dynamic-code-execution
JSON.parse(userInput);

// ruleid: boardreadyops.security.no-shell-child-process
exec(userInput);

// ruleid: boardreadyops.security.no-shell-child-process
spawn("sh", ["-c", userInput]);

// ruleid: boardreadyops.security.no-shell-child-process
spawn("bash", ["-c", userInput]);

// ruleid: boardreadyops.security.no-shell-child-process
spawn("git", ["status"], { shell: true });

// ok: boardreadyops.security.no-shell-child-process
execFile("git", ["status", "--short"]);

// ok: boardreadyops.security.no-shell-child-process
spawn("git", ["status", "--short"], { shell: false });

// ruleid: boardreadyops.security.no-disabled-tls-verification
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// ruleid: boardreadyops.security.no-disabled-tls-verification
new https.Agent({ rejectUnauthorized: false });

// ok: boardreadyops.security.no-disabled-tls-verification
new https.Agent({ rejectUnauthorized: true });
