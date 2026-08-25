import { configuredCredentialCipher } from "@boardreadyops/cloud-core/credential-encryption";
import {
  createSqlInstallationCredentialStore,
  type InstallationCredentialStore,
} from "@boardreadyops/db/installation-credential-store";
import { nexarProviderName } from "./component-intelligence-resolver.js";
import { settingsFormTokenValid } from "./settings-form-token.js";
import type { UserSession } from "./user-session.js";

/**
 * Accepts a customer's component-intelligence credential from the settings form.
 *
 * Three checks stand between a request and a write, in this order: a valid session, a CSRF
 * token bound to that session and this installation, and the viewer's actual access to the
 * installation. Order matters only for what it avoids — no database read happens until the
 * cheap checks have passed.
 *
 * The credential never leaves this function in plaintext. It is encrypted before it reaches
 * the store, and no branch here puts it in a response, a redirect, or an error.
 */

const maximumFieldLength = 512;

/**
 * Seams for tests.
 *
 * This path accepts someone else's secret, so the order of its checks is worth exercising
 * rather than asserting by reading. Production supplies neither and gets the real
 * implementations.
 */
export type ComponentCredentialDependencies = {
  authorize?: (
    environment: Readonly<Record<string, string | undefined>>,
    now: Date,
  ) => Promise<{
    session: UserSession | undefined;
    authorizeInstallation: (installationId: string) => Promise<boolean>;
  }>;
  credentialStore?: (
    connectionString: string,
  ) => Promise<{ store: InstallationCredentialStore; close: () => Promise<void> }>;
};

async function realCredentialStore(
  connectionString: string,
): Promise<{ store: InstallationCredentialStore; close: () => Promise<void> }> {
  const { createPgQueryExecutor } = await import("@boardreadyops/db/pg-executor");
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  return { store: createSqlInstallationCredentialStore(executor), close: () => executor.close() };
}

function redirect(status: string, detail?: string): Response {
  const query = new URLSearchParams({ status, ...(detail ? { detail } : {}) });
  return new Response(null, {
    status: 303,
    headers: { location: `/settings/component-intelligence?${query.toString()}` },
  });
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function handleComponentCredentialSubmission(
  request: Request,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  now: Date = new Date(),
  dependencies: ComponentCredentialDependencies = {},
): Promise<Response> {
  const secret = environment.SESSION_SECRET?.trim();
  const cipher = configuredCredentialCipher(environment);
  // Without a key there is nowhere safe to put the credential, so the form must not appear to
  // accept one.
  if (!secret || !cipher) return redirect("unavailable");

  // Imported here rather than at module scope: viewer-authorization reaches next/headers,
  // which only resolves inside a Next request, and this module must stay loadable without one.
  const authorize = dependencies.authorize ?? (await import("./viewer-authorization.js")).viewerAuthorization;
  const viewer = await authorize(environment, now);
  if (!viewer.session) return redirect("signed_out");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirect("invalid");
  }

  const installationId = field(form, "installation_id");
  const action = field(form, "action");
  if (!installationId || installationId.length > maximumFieldLength) return redirect("invalid");
  if (action !== "save" && action !== "remove") return redirect("invalid");

  if (!settingsFormTokenValid(field(form, "form_token"), viewer.session, installationId, secret, now)) {
    return redirect("expired");
  }
  if (!(await viewer.authorizeInstallation(installationId))) return redirect("forbidden");

  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return redirect("unavailable");
  const opened = await (dependencies.credentialStore ?? realCredentialStore)(connectionString);
  const store = opened.store;
  try {
    if (action === "remove") {
      await store.remove(installationId, nexarProviderName);
      return redirect("removed");
    }

    const clientId = field(form, "client_id");
    const clientSecret = field(form, "client_secret");
    const scope = field(form, "scope");
    if (!clientId || !clientSecret) return redirect("incomplete");
    if (
      clientId.length > maximumFieldLength ||
      clientSecret.length > maximumFieldLength ||
      scope.length > maximumFieldLength
    ) {
      return redirect("invalid");
    }

    await store.put(
      installationId,
      nexarProviderName,
      cipher.encrypt(JSON.stringify({ clientId, clientSecret, ...(scope ? { scope } : {}) })),
    );
    // Deliberately no verification call to the provider here: a form submission should not
    // block on a third party, and the watch already records a refusal against the credential
    // the first time it uses it.
    return redirect("saved");
  } catch {
    // No error detail reaches the caller: the only failures possible here involve the
    // credential or the database, and neither is safe to describe.
    return redirect("failed");
  } finally {
    await opened.close();
  }
}
