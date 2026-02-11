#!/usr/bin/env bun

import { join } from "node:path";
import { install } from "./commands/install";
import { update } from "./commands/update";
import { list } from "./commands/list";
import { remove } from "./commands/remove";
import { status } from "./commands/status";

const OPENCODE_DIR = join(process.cwd(), ".opencode");

const HELP = `
hugo — workflow manager for OpenCode

Usage:
  hugo install <package>       Install a workflow package
  hugo i <package>             Alias for install
  hugo update [name]           Update all workflows, or a specific one
  hugo list                    List installed workflows
  hugo ls                      Alias for list
  hugo remove <name>           Remove an installed workflow
  hugo rm <name>               Alias for remove
  hugo status [name]           Show integrity status of installed files

Options:
  --force                      Overwrite modified/unmanaged files (install only)

Examples:
  hugo i @some-org/code-review-workflow
  hugo i github:org/code-review-workflow
  hugo i --force github:org/code-review-workflow
  hugo update
  hugo list
  hugo rm code-review
  hugo rm code-review
`.trim();

/**
 * Parse args for a command. Extracts known flags, collects positional args,
 * and exits with an error for any unrecognized flags.
 */
function parseArgs(
  rawArgs: string[],
  knownFlags: string[] = [],
): { flags: Record<string, boolean>; args: string[] } {
  const flags: Record<string, boolean> = {};
  const args: string[] = [];

  for (const arg of rawArgs) {
    if (arg.startsWith("--")) {
      if (knownFlags.includes(arg)) {
        flags[arg] = true;
      } else {
        console.error(`Unknown option: ${arg}\n`);
        console.log(HELP);
        process.exit(1);
      }
    } else {
      args.push(arg);
    }
  }

  return { flags, args };
}

async function main() {
  const [command, ...rawArgs] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    process.exit(0);
  }

  switch (command) {
    case "install":
    case "i": {
      const { flags, args } = parseArgs(rawArgs, ["--force"]);
      const force = flags["--force"] ?? false;
      const packageSpec = args[0];
      if (!packageSpec) {
        console.error("Error: missing package spec\n");
        console.error("Usage: hugo install <package>");
        process.exit(1);
      }

      try {
        const result = await install(OPENCODE_DIR, packageSpec, { force });

        if (result.warnings.length > 0) {
          for (const warning of result.warnings) {
            console.warn(`  ⚠ ${warning}`);
          }
        }

        console.log(
          `Installed workflow "${result.workflowName}" v${result.version} ` +
            `(${result.agents} agents, ${result.skills} skills, ${result.commands} commands)`,
        );
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
      break;
    }

    case "update": {
      const { args } = parseArgs(rawArgs);
      const target = args[0]; // optional — specific workflow name
      try {
        const result = await update(OPENCODE_DIR, target);

        if (result.workflows.length === 0 && result.unchanged.length > 0) {
          console.log("All workflows already up to date.");
          break;
        }

        for (const wf of result.workflows) {
          console.log(`Updated ${wf.name}: ${wf.oldVersion} → ${wf.newVersion}`);
          for (const path of wf.updated) {
            console.log(`  Updated: ${path}`);
          }
          for (const path of wf.added) {
            console.log(`  Added:   ${path}`);
          }
          for (const path of wf.removed) {
            console.log(`  Removed: ${path}`);
          }
          for (const { path, reason } of wf.skipped) {
            console.log(`  Skipped: ${path} (${reason})`);
          }
        }

        for (const name of result.unchanged) {
          console.log(`${name}: already up to date`);
        }
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
      break;
    }

    case "list":
    case "ls": {
      parseArgs(rawArgs);
      try {
        const result = await list(OPENCODE_DIR);

        if (result.workflows.length === 0) {
          console.log("No workflows installed.");
          break;
        }

        console.log("Installed workflows:");
        for (const wf of result.workflows) {
          console.log(
            `  ${wf.name}  v${wf.version}  ${wf.package}  ` +
              `(${wf.agents} agents, ${wf.skills} skills, ${wf.commands} commands)`,
          );
        }
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
      break;
    }

    case "remove":
    case "rm": {
      const { args } = parseArgs(rawArgs);
      const workflowName = args[0];
      if (!workflowName) {
        console.error("Error: missing workflow name\n");
        console.error("Usage: hugo remove <name>");
        process.exit(1);
      }

      try {
        const result = await remove(OPENCODE_DIR, workflowName);

        if (result.keptFiles.length > 0) {
          for (const file of result.keptFiles) {
            console.warn(`  Leaving ${file} — locally modified`);
          }
        }

        console.log(
          `Removed workflow "${result.name}". ` +
            `${result.removed} files removed` +
            (result.kept > 0 ? `, ${result.kept} left in place (locally modified).` : "."),
        );
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
      break;
    }

    case "status": {
      const { args } = parseArgs(rawArgs);
      const target = args[0];
      try {
        const result = await status(OPENCODE_DIR, target);

        if (result.workflows.length === 0) {
          console.log("No workflows installed.");
          break;
        }

        for (const wf of result.workflows) {
          const clean = wf.files.filter((f) => f.status === "clean").length;
          const modified = wf.files.filter((f) => f.status === "modified").length;
          const deleted = wf.files.filter((f) => f.status === "deleted").length;

          console.log(`${wf.name}  v${wf.version}  (${clean} clean, ${modified} modified, ${deleted} deleted)`);

          for (const f of wf.files) {
            if (f.status === "modified") {
              console.log(`  modified: ${f.file.destination}`);
            } else if (f.status === "deleted") {
              console.log(`  deleted:  ${f.file.destination}`);
            }
          }
        }
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main();
