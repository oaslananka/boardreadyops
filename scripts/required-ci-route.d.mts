export type RequiredCiRouteInput = {
  check: string;
  classifierResult?: string | undefined;
  needsWork?: string | undefined;
  buildResult?: string | undefined;
};

export declare function validateRequiredCiRoute(input: RequiredCiRouteInput): "required" | "not-applicable";
