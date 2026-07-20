import type { ControlPlaneJobStore } from "@boardreadyops/db/control-plane-job-store";

export declare function getControlPlaneJobStore(): ControlPlaneJobStore;
export declare function resetControlPlaneJobStoreForTests(): void;
export declare function setControlPlaneJobStoreForTests(store: ControlPlaneJobStore): void;
