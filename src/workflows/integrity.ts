import { join } from "node:path";
import { exists } from "node:fs/promises";
import type { WorkflowEntry, FileStatus } from "./types";
import { hashFile } from "./utils";

export async function checkIntegrity(
  opencodeDir: string,
  entry: WorkflowEntry,
): Promise<FileStatus[]> {
  const results: FileStatus[] = [];

  for (const file of entry.files) {
    const fullPath = join(opencodeDir, file.destination);

    if (!(await exists(fullPath))) {
      results.push({ file, status: "deleted" });
      continue;
    }

    const currentHash = await hashFile(fullPath);
    results.push({
      file,
      status: currentHash === file.hash ? "clean" : "modified",
    });
  }

  return results;
}
