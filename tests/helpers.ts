import { mkdtemp, readFile, rm, cp, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { WorkflowState } from "../src/workflows/types";

const FIXTURES_DIR = resolve(__dirname, "fixtures/packages");

/**
 * Create a fresh temp directory for a test. Returns the path and a cleanup function.
 */
export async function createTempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "hugo-test-"));
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Read and parse state.json from an .opencode directory.
 * Returns null if the file doesn't exist.
 */
export async function readState(opencodeDir: string): Promise<WorkflowState | null> {
  const statePath = join(opencodeDir, "state.json");
  try {
    return JSON.parse(await readFile(statePath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Check if a file exists at the given path.
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read file content as a string.
 */
export async function readFileContent(path: string): Promise<string> {
  return readFile(path, "utf-8");
}

/**
 * Get the absolute path to a fixture package.
 */
export function fixtureDir(name: string): string {
  return join(FIXTURES_DIR, name);
}

/**
 * Copy a fixture into a temp directory for use as a `file:` install source.
 * Returns the staging directory path and the `file:` spec string.
 * Used by update tests that need to mutate the source package.
 */
export async function stageFixture(fixtureName: string): Promise<{
  dir: string;
  spec: string;
  cleanup: () => Promise<void>;
}> {
  const { dir: parentDir, cleanup } = await createTempDir();
  const stagingDir = join(parentDir, "source");
  await cp(fixtureDir(fixtureName), stagingDir, { recursive: true });
  return {
    dir: stagingDir,
    spec: `file:${stagingDir}`,
    cleanup,
  };
}

/**
 * Replace the content of a staging directory with a different fixture.
 * Used to simulate a version bump for update tests.
 */
export async function swapFixtureVersion(
  stagingDir: string,
  v2FixtureName: string,
): Promise<void> {
  await rm(stagingDir, { recursive: true, force: true });
  await cp(fixtureDir(v2FixtureName), stagingDir, { recursive: true });
}

/**
 * Run the Hugo CLI binary and capture output.
 * Returns stdout, stderr, and exit code.
 */
export async function runCLI(
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cliPath = resolve(__dirname, "../dist/cli.js");
  const timeout = options?.timeout ?? 10_000;

  const proc = Bun.spawn(["bun", cliPath, ...args], {
    cwd: options?.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, BUN_ENV: "test" },
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      proc.kill();
      reject(new Error(`CLI timed out after ${timeout}ms: hugo ${args.join(" ")}`));
    }, timeout);
  });

  const [exitCode, stdout, stderr] = await Promise.race([
    Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]),
    timeoutPromise,
  ]);

  return { stdout, stderr, exitCode };
}

/**
 * Get file permissions mode (for testing executable preservation).
 */
export async function getFileMode(path: string): Promise<number> {
  const s = await stat(path);
  return s.mode;
}
