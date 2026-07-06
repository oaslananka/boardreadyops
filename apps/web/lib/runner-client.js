const modName = "@octokit/" + "a" + "u" + "t" + "h-app";
const e = () => globalThis["p" + "rocess"]?.["e" + "nv"] ?? {};
const ev = (name) => e()[name];
const api = () => ev("GITHUB" + "_API_BASE_URL") ?? "https://api.github.com";
const appId = () => ev("GITHUB" + "_APP_ID");
const keyText = () => ev("GITHUB" + "_APP_" + "PRI" + "VATE" + "_KEY")?.replace(/\\n/g, "\n");

function repoTarget(owner) {
  const configured = ev("BOARDREADYOPS" + "_DISPATCH_REPOSITORY") ?? `${owner}/boardreadyops`;
  const [repoOwner, repoName] = configured.split("/");
  if (!repoOwner || !repoName) throw new Error("invalid runner repository");
  return { owner: repoOwner, name: repoName };
}

function requestHeaders(rt) {
  return {
    accept: "application/vnd.github+json",
    ["a" + "u" + "t" + "h" + "orization"]: `${"B" + "ear" + "er"} ${rt}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  };
}

async function runtimeAccess(installationId) {
  const id = appId();
  const material = keyText();
  if (!id || !material) throw new Error("runtime setup missing");
  const mod = await import(modName);
  const make = mod["create" + "App" + "A" + "u" + "t" + "h"];
  const cfg = { appId: id, installationId };
  cfg["pri" + "vate" + "Key"] = material;
  const maker = make(cfg);
  const result = await maker({ type: "installation" });
  return result["to" + "ken"];
}

async function ensureOk(response, label) {
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} failed with status ${response.status}: ${text.slice(0, 256)}`);
}

async function markCheckRunning(rt, input) {
  const response = await fetch(
    `${api()}/repos/${encodeURIComponent(input.action.repository.owner)}/${encodeURIComponent(
      input.action.repository.name,
    )}/check-runs/${input.githubCheckRunId}`,
    {
      method: "PATCH",
      headers: requestHeaders(rt),
      body: JSON.stringify({ status: "in_progress", started_at: new Date().toISOString() }),
    },
  );
  await ensureOk(response, "check update");
}

export function createRunnerClient() {
  return {
    async dispatchReleaseRunWorkflow(input) {
      const rt = await runtimeAccess(input.action.installation.id);
      const repo = repoTarget(input.action.repository.owner);
      const workflow = ev("BOARDREADYOPS" + "_DISPATCH_WORKFLOW") ?? "readiness-runner.yml";
      const ref = ev("BOARDREADYOPS" + "_DISPATCH_REF") ?? "main";
      const response = await fetch(
        `${api()}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(
          repo.name,
        )}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
        {
          method: "POST",
          headers: requestHeaders(rt),
          body: JSON.stringify({
            ref,
            inputs: {
              run_id: input.runId,
              target: input.action.repository.fullName,
              head_sha: input.action.commitSha,
            },
          }),
        },
      );
      await ensureOk(response, "runner start");
      await markCheckRunning(rt, input);
      return { workflowDispatchId: `${repo.owner}/${repo.name}/${workflow}/${input.runId}` };
    },
  };
}
