/** Deploy the exact protected main commit without linking an unrelated Vercel Git account. */
const { GITHUB_SHA, GITHUB_REF, GITHUB_REPOSITORY, GITHUB_REPOSITORY_ID, VERCEL_API_TOKEN } = process.env;

if (
  GITHUB_REF !== "refs/heads/main" ||
  GITHUB_REPOSITORY !== "oaslananka/boardreadyops" ||
  !/^[a-f0-9]{40}$/u.test(GITHUB_SHA ?? "") ||
  !/^[1-9][0-9]{0,19}$/u.test(GITHUB_REPOSITORY_ID ?? "") ||
  !VERCEL_API_TOKEN
) {
  throw new Error("Vercel deployment requires exact main source and production credentials");
}

const repoId = Number(GITHUB_REPOSITORY_ID);
if (!Number.isSafeInteger(repoId)) throw new Error("Invalid numeric GitHub repository identity");

const base = "https://api.vercel.com";
const query = "?slug=boardreadyops";
const headers = { authorization: `Bearer ${VERCEL_API_TOKEN}` };
const deploymentPayload = {
  name: "boardreadyops",
  project: "boardreadyops",
  target: "production",
  gitSource: { type: "github", repoId, ref: "main", sha: GITHUB_SHA },
};

async function vercel(path, init = {}) {
  const response = await fetch(`${base}${path}${query}`, {
    ...init,
    headers: { ...headers, ...init.headers },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Vercel API ${response.status} on ${path.split("?")[0]}`);
  return await response.json();
}

const created = await vercel("/v13/deployments", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(deploymentPayload),
});
const id = created.id;
if (typeof id !== "string" || !/^dpl_[A-Za-z0-9]+$/u.test(id)) {
  throw new Error("Vercel did not return a deployment identity");
}
process.stdout.write(`Vercel production deployment created: ${id}\n`);

for (let attempt = 0; attempt < 36; attempt++) {
  const deployment = await vercel(`/v13/deployments/${id}`);
  const state = deployment.readyState;
  if (state === "READY") {
    if (deployment.target !== "production" || deployment.meta?.githubCommitSha !== GITHUB_SHA) {
      throw new Error("Vercel deployed a different target or GitHub commit");
    }
    process.stdout.write(`Vercel production READY at exact source ${GITHUB_SHA.slice(0, 12)}: ${id}\n`);
    process.exit(0);
  }
  if (["ERROR", "CANCELED"].includes(state)) {
    throw new Error(`Vercel production deployment ended in ${state}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}
throw new Error(`Vercel deployment ${id} did not become READY within the bounded acceptance period`);
