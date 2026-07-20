export type CopyDirectoryPortableOptions = {
  dereferenceSymlinks?: boolean;
};

export declare function copyDirectoryPortable(
  source: string,
  destination: string,
  options?: CopyDirectoryPortableOptions,
): Promise<void>;
