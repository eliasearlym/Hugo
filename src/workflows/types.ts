export type WorkflowManifest = {
  name: string;
  description: string;
  agents: Array<{ path: string }>;
  skills: Array<{ path: string }>;
  commands: Array<{ path: string }>;
};

export type InstalledFile = {
  source: string;
  destination: string;
  hash: string;
};

export type PackageSource =
  | { type: "registry"; name: string }
  | { type: "git"; url: string; ref?: string }
  | { type: "file"; path: string };

export type WorkflowEntry = {
  name: string;
  package: string;
  source: PackageSource;
  version: string;
  syncedAt: string;
  files: InstalledFile[];
};

export type WorkflowState = {
  workflows: WorkflowEntry[];
};

export type FileStatus = {
  file: InstalledFile;
  status: "clean" | "modified" | "deleted";
};

export type SyncResult = {
  files: InstalledFile[];
  warnings: string[];
};
