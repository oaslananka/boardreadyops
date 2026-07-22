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
  },
): Promise<void>;
export declare function renderNotice(report: PnpmLicenseReport): string;
