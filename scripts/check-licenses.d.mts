export declare const allowedLicenses: readonly string[];

export type LicensePolicyViolation = {
  license: string;
  packages: string[];
};

export type PnpmLicensePackage = {
  name: string;
  versions: string[];
};

export type PnpmLicenseReport = Record<string, PnpmLicensePackage[]>;

export declare function main(
  root?: string,
  options?: { includeAll?: boolean; includeDev?: boolean; packageName?: string },
): Promise<void>;
export declare function findLicensePolicyViolations(
  report: PnpmLicenseReport,
  allowed?: readonly string[],
): LicensePolicyViolation[];
export declare function isAllowedLicenseExpression(expression: string, allowedSet?: Set<string>): boolean;
export declare function formatLicensePolicyViolations(violations: LicensePolicyViolation[]): string;
