export type ControlPlaneWorkerMetafile = {
  inputs?: Record<string, unknown>;
  outputs?: Record<
    string,
    {
      imports?: Array<{
        path?: string;
      }>;
    }
  >;
};

export function findControlPlaneWorkerBoundaryViolations(metafile: ControlPlaneWorkerMetafile): string[];

export function verifyControlPlaneWorkerBoundary(metafile: ControlPlaneWorkerMetafile): void;
