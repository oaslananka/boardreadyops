export type CloudUploadMode = "metadata" | "snapshots" | "source";

export interface CloudUploadPolicyDecision {
  shouldPublish: boolean;
  uploadMode?: CloudUploadMode;
  reason?: string;
  allowSnapshots: boolean;
  allowSource: boolean;
}

export function evaluateCloudUploadPolicy(params: {
  uploadMode?: CloudUploadMode | string | undefined;
  hasToken: boolean;
}): CloudUploadPolicyDecision {
  const { uploadMode, hasToken } = params;

  if (!uploadMode || uploadMode === "unset") {
    return {
      shouldPublish: false,
      reason:
        "Cloud upload mode is unset. An explicit cloud-upload mode (metadata, snapshots, or source) is required for consent.",
      allowSnapshots: false,
      allowSource: false,
    };
  }

  if (uploadMode !== "metadata" && uploadMode !== "snapshots" && uploadMode !== "source") {
    return {
      shouldPublish: false,
      reason: `Invalid cloud upload mode: ${uploadMode}. Expected metadata, snapshots, or source.`,
      allowSnapshots: false,
      allowSource: false,
    };
  }

  if (!hasToken) {
    return {
      shouldPublish: false,
      uploadMode,
      reason: "BOARDREADYOPS_TOKEN is missing.",
      allowSnapshots: false,
      allowSource: false,
    };
  }

  return {
    shouldPublish: true,
    uploadMode,
    allowSnapshots: uploadMode === "snapshots",
    allowSource: uploadMode === "source",
  };
}
