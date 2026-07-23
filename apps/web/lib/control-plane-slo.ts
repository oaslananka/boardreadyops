import type { ControlPlaneSliSnapshot } from "@boardreadyops/db/control-plane-operations-store";

export const CONTROL_PLANE_SLO_POLICY_VERSION = "github-cloud-ga-v1" as const;

export type ControlPlaneSloSignal =
  | "webhook_acceptance_p95"
  | "lifecycle_queue_age"
  | "outbox_lag"
  | "dispatch_latency_p95"
  | "completion_latency_p95"
  | "stale_attempts"
  | "reconciliation_backlog"
  | "terminal_failure_rate";

export type ControlPlaneSloSeverity = "critical" | "warning";
export type ControlPlaneSloTransitionState = "firing" | "recovered";

export type ControlPlaneSloTransition = {
  policyVersion: typeof CONTROL_PLANE_SLO_POLICY_VERSION;
  signal: ControlPlaneSloSignal;
  state: ControlPlaneSloTransitionState;
  severity: ControlPlaneSloSeverity;
  observedValue: number;
  threshold: number;
  observedAt: string;
  reasonCode: string;
};

export type ControlPlaneSloEvaluation = {
  policyVersion: typeof CONTROL_PLANE_SLO_POLICY_VERSION;
  healthy: boolean;
  activeSignals: ControlPlaneSloSignal[];
  events: ControlPlaneSloTransition[];
};

export type ControlPlaneSloEvaluator = {
  evaluate(snapshot: ControlPlaneSliSnapshot, observedAt?: Date): ControlPlaneSloEvaluation;
};

type SignalState = {
  active: boolean;
  breachStartedAt: number | undefined;
  consecutiveBreaches: number;
  previousValue: number | undefined;
  increasingSnapshots: number;
  activeReasonCode: string | undefined;
  activeSeverity: ControlPlaneSloSeverity | undefined;
  activeThreshold: number | undefined;
};

type SignalObservation = {
  signal: ControlPlaneSloSignal;
  observedValue: number;
  threshold: number;
  severity: ControlPlaneSloSeverity;
  reasonCode: string;
  breached: boolean;
  eligible: boolean;
};

const signalOrder: ControlPlaneSloSignal[] = [
  "webhook_acceptance_p95",
  "lifecycle_queue_age",
  "outbox_lag",
  "dispatch_latency_p95",
  "completion_latency_p95",
  "stale_attempts",
  "reconciliation_backlog",
  "terminal_failure_rate",
];

function initialState(): SignalState {
  return {
    active: false,
    breachStartedAt: undefined,
    consecutiveBreaches: 0,
    previousValue: undefined,
    increasingSnapshots: 0,
    activeReasonCode: undefined,
    activeSeverity: undefined,
    activeThreshold: undefined,
  };
}

function durationObservation(input: {
  signal: ControlPlaneSloSignal;
  observedValue: number;
  threshold: number;
  durationMilliseconds: number;
  severity: ControlPlaneSloSeverity;
  reasonCode: string;
  state: SignalState;
  observedAt: number;
}): SignalObservation {
  const breached = input.observedValue > input.threshold;
  if (!breached) {
    input.state.breachStartedAt = undefined;
    return { ...input, breached, eligible: false };
  }

  input.state.breachStartedAt ??= input.observedAt;
  return {
    ...input,
    breached,
    eligible: input.observedAt - input.state.breachStartedAt >= input.durationMilliseconds,
  };
}

function consecutiveObservation(input: {
  signal: ControlPlaneSloSignal;
  observedValue: number;
  threshold: number;
  requiredSnapshots: number;
  severity: ControlPlaneSloSeverity;
  reasonCode: string;
  state: SignalState;
}): SignalObservation {
  const breached = input.observedValue > input.threshold;
  input.state.consecutiveBreaches = breached ? input.state.consecutiveBreaches + 1 : 0;
  return {
    ...input,
    breached,
    eligible: breached && input.state.consecutiveBreaches >= input.requiredSnapshots,
  };
}

function immediateObservation(input: {
  signal: ControlPlaneSloSignal;
  observedValue: number;
  threshold: number;
  severity: ControlPlaneSloSeverity;
  reasonCode: string;
  breached: boolean;
}): SignalObservation {
  return { ...input, eligible: input.breached };
}

function transition(
  observation: SignalObservation,
  state: SignalState,
  observedAt: string,
): ControlPlaneSloTransition | undefined {
  if (observation.breached && observation.eligible) {
    if (state.active) return undefined;
    state.active = true;
    state.activeReasonCode = observation.reasonCode;
    state.activeSeverity = observation.severity;
    state.activeThreshold = observation.threshold;
    return {
      policyVersion: CONTROL_PLANE_SLO_POLICY_VERSION,
      signal: observation.signal,
      state: "firing",
      severity: observation.severity,
      observedValue: observation.observedValue,
      threshold: observation.threshold,
      observedAt,
      reasonCode: observation.reasonCode,
    };
  }

  if (observation.breached || !state.active) return undefined;
  const event: ControlPlaneSloTransition = {
    policyVersion: CONTROL_PLANE_SLO_POLICY_VERSION,
    signal: observation.signal,
    state: "recovered",
    severity: state.activeSeverity ?? observation.severity,
    observedValue: observation.observedValue,
    threshold: state.activeThreshold ?? observation.threshold,
    observedAt,
    reasonCode: state.activeReasonCode ?? observation.reasonCode,
  };
  state.active = false;
  state.activeReasonCode = undefined;
  state.activeSeverity = undefined;
  state.activeThreshold = undefined;
  return event;
}

export function createControlPlaneSloEvaluator(): ControlPlaneSloEvaluator {
  const states = new Map<ControlPlaneSloSignal, SignalState>(signalOrder.map((signal) => [signal, initialState()]));

  return {
    evaluate(snapshot, observedAt = new Date()): ControlPlaneSloEvaluation {
      if (!Number.isFinite(observedAt.valueOf())) throw new Error("observedAt must be a valid date");
      const observedAtValue = observedAt.valueOf();
      const observedAtIso = observedAt.toISOString();
      const state = (signal: ControlPlaneSloSignal) => states.get(signal) ?? initialState();

      const backlogState = state("reconciliation_backlog");
      const previousBacklog = backlogState.previousValue;
      backlogState.increasingSnapshots =
        previousBacklog === undefined || snapshot.reconciliationBacklog <= previousBacklog
          ? 1
          : backlogState.increasingSnapshots + 1;
      backlogState.previousValue = snapshot.reconciliationBacklog;
      const backlogAboveThreshold = snapshot.reconciliationBacklog > 20;
      const backlogIncreasing = snapshot.reconciliationBacklog > 0 && backlogState.increasingSnapshots >= 3;

      const observations: SignalObservation[] = [
        durationObservation({
          signal: "webhook_acceptance_p95",
          observedValue: snapshot.webhookAcceptanceP95Ms,
          threshold: 1_000,
          durationMilliseconds: 5 * 60 * 1_000,
          severity: "warning",
          reasonCode: "webhook_acceptance_p95_sustained",
          state: state("webhook_acceptance_p95"),
          observedAt: observedAtValue,
        }),
        durationObservation({
          signal: "lifecycle_queue_age",
          observedValue: snapshot.lifecycleQueueAgeSeconds,
          threshold: 60,
          durationMilliseconds: 5 * 60 * 1_000,
          severity: "critical",
          reasonCode: "lifecycle_queue_age_sustained",
          state: state("lifecycle_queue_age"),
          observedAt: observedAtValue,
        }),
        durationObservation({
          signal: "outbox_lag",
          observedValue: snapshot.outboxLagSeconds,
          threshold: 60,
          durationMilliseconds: 5 * 60 * 1_000,
          severity: "critical",
          reasonCode: "outbox_lag_sustained",
          state: state("outbox_lag"),
          observedAt: observedAtValue,
        }),
        durationObservation({
          signal: "dispatch_latency_p95",
          observedValue: snapshot.dispatchLatencyP95Seconds,
          threshold: 30,
          durationMilliseconds: 10 * 60 * 1_000,
          severity: "warning",
          reasonCode: "dispatch_latency_p95_sustained",
          state: state("dispatch_latency_p95"),
          observedAt: observedAtValue,
        }),
        durationObservation({
          signal: "completion_latency_p95",
          observedValue: snapshot.completionLatencyP95Seconds,
          threshold: 1_800,
          durationMilliseconds: 10 * 60 * 1_000,
          severity: "warning",
          reasonCode: "completion_latency_p95_sustained",
          state: state("completion_latency_p95"),
          observedAt: observedAtValue,
        }),
        consecutiveObservation({
          signal: "stale_attempts",
          observedValue: snapshot.staleAttempts,
          threshold: 0,
          requiredSnapshots: 2,
          severity: "critical",
          reasonCode: "stale_attempts_consecutive",
          state: state("stale_attempts"),
        }),
        immediateObservation({
          signal: "reconciliation_backlog",
          observedValue: snapshot.reconciliationBacklog,
          threshold: 20,
          severity: "warning",
          reasonCode: backlogAboveThreshold ? "reconciliation_backlog_threshold" : "reconciliation_backlog_increasing",
          breached: backlogAboveThreshold || backlogIncreasing,
        }),
        immediateObservation({
          signal: "terminal_failure_rate",
          observedValue: snapshot.terminalFailureRateBasisPoints,
          threshold: 500,
          severity: "critical",
          reasonCode: "terminal_failure_rate_exceeded",
          breached: snapshot.terminalRuns24h >= 20 && snapshot.terminalFailureRateBasisPoints > 500,
        }),
      ];

      const events = observations.flatMap((observation) => {
        const event = transition(observation, state(observation.signal), observedAtIso);
        return event ? [event] : [];
      });
      const activeSignals = signalOrder.filter((signal) => state(signal).active);
      return {
        policyVersion: CONTROL_PLANE_SLO_POLICY_VERSION,
        healthy: activeSignals.length === 0,
        activeSignals,
        events,
      };
    },
  };
}
