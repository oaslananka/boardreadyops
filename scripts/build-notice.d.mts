export type PnpmLicensePackage = {
  name: string;
  versions: string[];
  license?: string;
  homepage?: string;
  description?: string;
};

export type PnpmLicenseReport = Record<string, PnpmLicensePackage[]>;

export declare function main(
  root?: string,
  options?: {
    check?: boolean;
    readReport?: (root: string) => Promise<PnpmLicenseReport>;
    excludedPackageVersions?: ReadonlySet<string>;
  },
): Promise<void>;

export declare function readPlatformOnlyPackageVersions(root: string): Set<string>;
export declare function platformOnlyPackageVersionsFromLockfile(lockfile: unknown): Set<string>;
export declare function renderNotice(report: PnpmLicenseReport, excludedPackageVersions?: ReadonlySet<string>): string;
