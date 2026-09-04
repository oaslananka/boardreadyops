import { timingSafeEqual } from "node:crypto";
import { clientIdentifierFromRequest } from "./auth-rate-limit.js";
import { checkOperatorRateLimit, recordFailedOperatorAttempt } from "./operator-rate-limit.js";

const actorIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const operatorTokenPattern = /^[\x21-\x7E]{32,512}$/u;
const bearerPrefix = "Bearer ";

export type ConfiguredControlPlaneOperator = {
  token: string;
  actorId: string;
};

export type ControlPlaneOperatorAuthentication =
  | { status: "authenticated"; actorId: string }
  | { status: "disabled" }
  | { status: "unauthorized" }
  | { status: "rate_limited"; retryAfterSeconds: number };

export function configuredControlPlaneOperator(
  environment: Readonly<Record<string, string | undefined>>,
): ConfiguredControlPlaneOperator | undefined {
  const token = environment.BOARDREADYOPS_OPERATOR_API_TOKEN;
  const actorId = environment.BOARDREADYOPS_OPERATOR_ACTOR_ID;
  if (!token || !actorId || !operatorTokenPattern.test(token) || !actorIdentifierPattern.test(actorId)) {
    return undefined;
  }
  return { token, actorId };
}

export function authenticateControlPlaneOperator(
  request: Request,
  environment: Readonly<Record<string, string | undefined>>,
): ControlPlaneOperatorAuthentication {
  const configured = configuredControlPlaneOperator(environment);
  if (!configured) return { status: "disabled" };

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith(bearerPrefix)) return { status: "unauthorized" };

  const clientId = clientIdentifierFromRequest(request);
  const rateLimit = checkOperatorRateLimit(clientId, { environment });
  if (!rateLimit.allowed) {
    return { status: "rate_limited", retryAfterSeconds: rateLimit.retryAfterSeconds };
  }

  const presentedToken = authorization.slice(bearerPrefix.length);
  if (!operatorTokenPattern.test(presentedToken)) {
    recordFailedOperatorAttempt(clientId);
    return { status: "unauthorized" };
  }
  const presented = Buffer.from(presentedToken, "utf8");
  const expected = Buffer.from(configured.token, "utf8");
  if (presented.byteLength !== expected.byteLength || !timingSafeEqual(presented, expected)) {
    recordFailedOperatorAttempt(clientId);
    return { status: "unauthorized" };
  }

  return { status: "authenticated", actorId: configured.actorId };
}
