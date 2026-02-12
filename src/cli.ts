#!/usr/bin/env bun

import { install } from "./commands/install";
import { remove } from "./commands/remove";
import { update } from "./commands/update";
import { enable } from "./commands/enable";
import { disable } from "./commands/disable";
import { switchWorkflows } from "./commands/switch";
import { list } from "./commands/list";
import { health } from "./commands/health";
import { build } from "./commands/build";
import type { CollisionWarning } from "./workflows/types";
import { errorMessage } from "./workflows/utils";
import pkg from "../package.json";

const VERSION = pkg.version;

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const HELP = `hugo — workflow manager for OpenCode

Usage:
  hugo install <package>       Install a workflow package
  hugo i <package>             Alias for install
  hugo remove <name>           Remove an installed workflow
  hugo rm <name>               Alias for remove
  hugo update [name]           Update all workflows, or a specific one
  hugo enable <name...>        Enable one or more workflows
  hugo enable --all            Enable all workflows
  hugo disable <name...>       Disable one or more workflows
  hugo disable --all           Disable all workflows
  hugo switch <name...>        Disable all others, enable only these
  hugo list [name]             List installed workflows
  hugo ls [name]               Alias for list
  hugo health [name]           Check for collisions and shadowing
  hugo health --all            Check all workflows (including disabled)
  hugo build                   Generate workflow.json (for workflow authors)

Options:
  --version, -v                Print version
  --force                      Force reinstall (install only)

Examples:
  hugo install @some-org/code-review
  hugo install github:org/code-review
  hugo install ./local-workflow
  hugo remove code-review
  hugo update
  hugo update code-review
  hugo enable code-review
  hugo enable code-review debugging
  hugo enable --all
  hugo disable code-review
  hugo disable --all
  hugo switch code-review
  hugo switch code-review debugging
  hugo list
  hugo health
  hugo health code-review
  hugo build`;

// ---------------------------------------------------------------------------
// Arg parsing helpers
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  command: string | undefined;
  args: string[];
  flags: { force: boolean; all: boolean; help: boolean; version: boolean };
} {
  const flags = { force: false, all: false, help: false, version: false };
  const positional: string[] = [];

  for (const arg of argv) {
    if (arg === "--force") flags.force = true;
    else if (arg === "--all") flags.all = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--version" || arg === "-v") flags.version = true;
    else if (arg.startsWith("-")) {
      // Reject unknown flags — prevents typos like --forse from being
      // silently treated as positional arguments (e.g. package specs).
      console.error(`Error: unknown flag "${arg}"\n`);
      console.log(HELP);
      process.exit(1);
    } else positional.push(arg);
  }

  return {
    command: positional[0],
    args: positional.slice(1),
    flags,
  };
}

// ---------------------------------------------------------------------------
// Output formatting helpers
// ---------------------------------------------------------------------------

function formatCount(agents: string[], commands: string[], skills: string[]): string {
  const parts: string[] = [];
  if (agents.length > 0) parts.push(`${agents.length} agent${agents.length === 1 ? "" : "s"}`);
  if (commands.length > 0) parts.push(`${commands.length} command${commands.length === 1 ? "" : "s"}`);
  if (skills.length > 0) parts.push(`${skills.length} skill${skills.length === 1 ? "" : "s"}`);
  return parts.join(", ");
}

function formatWarnings(warnings: CollisionWarning[]): string[] {
  return warnings.map((w) => {
    return `  \u26A0 ${capitalize(w.entity)} "${w.name}" ${w.detail}`;
  });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function warnExtraArgs(args: string[], maxExpected: number): void {
  if (args.length > maxExpected) {
    const extra = args.slice(maxExpected).join(", ");
    console.error(`Warning: ignoring extra arguments: ${extra}`);
  }
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function handleInstall(
  args: string[],
  flags: { force: boolean },
): Promise<void> {
  if (args.length === 0) {
    console.error("Error: missing package spec\n\nUsage: hugo install <package>");
    process.exit(1);
  }
  warnExtraArgs(args, 1);

  const result = await install({
    projectDir: process.cwd(),
    spec: args[0],
    force: flags.force,
  });

  for (const line of formatWarnings(result.warnings)) {
    console.log(line);
  }

  const counts = formatCount(result.agents, result.commands, result.skills);
  const countsSuffix = counts ? ` (${counts})` : "";
  console.log(`Installed "${result.workflowName}" v${result.version}${countsSuffix}`);
}

async function handleRemove(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error("Error: missing workflow name\n\nUsage: hugo remove <name>");
    process.exit(1);
  }
  warnExtraArgs(args, 1);

  const result = await remove({
    projectDir: process.cwd(),
    name: args[0],
  });

  if (result.bunWarning) {
    console.log(`  Warning: ${result.bunWarning}`);
  }

  const counts = formatCount(result.agents, result.commands, result.skills);
  const countsSuffix = counts ? ` (${counts})` : "";
  console.log(`Removed "${result.workflowName}"${countsSuffix}`);
}

async function handleUpdate(args: string[]): Promise<void> {
  warnExtraArgs(args, 1);
  const result = await update({
    projectDir: process.cwd(),
    name: args[0],
  });

  const allUpToDate = result.workflows.every((w) => !w.updated);

  if (allUpToDate && !args[0]) {
    console.log("All workflows up to date.");
    return;
  }

  for (const w of result.workflows) {
    for (const warning of w.warnings) {
      console.log(`  \u26A0 ${w.workflowName}: ${warning}`);
    }

    if (!w.updated) {
      console.log(`"${w.workflowName}" already up to date.`);
      continue;
    }

    const changes: string[] = [];
    for (const a of w.addedAgents) changes.push(`added agent: ${a}`);
    for (const a of w.removedAgents) changes.push(`removed agent: ${a}`);
    for (const c of w.addedCommands) changes.push(`added command: ${c}`);
    for (const c of w.removedCommands) changes.push(`removed command: ${c}`);
    for (const s of w.addedSkills) changes.push(`added skill: ${s}`);
    for (const s of w.removedSkills) changes.push(`removed skill: ${s}`);

    const changeSuffix = changes.length > 0 ? ` (${changes.join(", ")})` : "";
    console.log(
      `Updated "${w.workflowName}" v${w.oldVersion} \u2192 v${w.newVersion}${changeSuffix}`,
    );
  }
}

async function handleEnable(
  args: string[],
  flags: { all: boolean },
): Promise<void> {
  if (args.length === 0 && !flags.all) {
    console.error("Error: missing workflow name (or use --all)\n\nUsage: hugo enable <name...>");
    process.exit(1);
  }

  const result = await enable({
    projectDir: process.cwd(),
    names: args,
    all: flags.all,
  });

  if (flags.all && result.workflows.every((w) => w.alreadyEnabled)) {
    console.log("All workflows are already enabled.");
    return;
  }

  for (const w of result.workflows) {
    if (w.alreadyEnabled) {
      console.log(`"${w.workflowName}" is already enabled.`);
      continue;
    }
    for (const line of formatWarnings(w.warnings)) {
      console.log(line);
    }
    const counts = formatCount(w.entry.agents, w.entry.commands, w.entry.skills);
    const countsSuffix = counts ? ` (${counts})` : "";
    console.log(`Enabled "${w.workflowName}"${countsSuffix}`);
  }
}

async function handleDisable(
  args: string[],
  flags: { all: boolean },
): Promise<void> {
  if (args.length === 0 && !flags.all) {
    console.error("Error: missing workflow name (or use --all)\n\nUsage: hugo disable <name...>");
    process.exit(1);
  }

  const result = await disable({
    projectDir: process.cwd(),
    names: args,
    all: flags.all,
  });

  if (flags.all && result.workflows.every((w) => w.alreadyDisabled)) {
    console.log("All workflows are already disabled.");
    return;
  }

  for (const w of result.workflows) {
    if (w.alreadyDisabled) {
      console.log(`"${w.workflowName}" is already disabled.`);
      continue;
    }
    console.log(`Disabled "${w.workflowName}"`);
  }
}

async function handleSwitch(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error("Error: missing workflow name\n\nUsage: hugo switch <name...>");
    process.exit(1);
  }

  const result = await switchWorkflows({
    projectDir: process.cwd(),
    names: args,
  });

  if (result.alreadyActive) {
    console.log(`Already active: ${args.join(", ")}.`);
    return;
  }

  for (const line of formatWarnings(result.warnings)) {
    console.log(line);
  }

  const enabledNames = result.enabled.map((w) => `"${w.workflowName}"`);
  console.log(`Switched to ${enabledNames.join(", ")}`);

  if (result.disabled.length > 0) {
    const disabledNames = result.disabled.map((w) => w.workflowName);
    console.log(`  disabled: ${disabledNames.join(", ")}`);
  }
}

async function handleList(args: string[]): Promise<void> {
  warnExtraArgs(args, 1);
  const result = await list({
    projectDir: process.cwd(),
    name: args[0],
  });

  if (result.workflows.length === 0) {
    console.log("No workflows installed.");
    return;
  }

  if (!args[0]) {
    console.log("Installed workflows:");
    console.log("");
  }

  for (let i = 0; i < result.workflows.length; i++) {
    const w = result.workflows[i];
    const status = w.enabled ? "enabled" : "disabled";
    console.log(`  ${w.workflowName}  v${w.version}  ${w.packageName}  (${status})`);

    if (w.agents.length > 0) {
      console.log(`    agents: ${w.agents.join(", ")}`);
    }
    if (w.commands.length > 0) {
      console.log(`    commands: ${w.commands.join(", ")}`);
    }
    if (w.skills.length > 0) {
      console.log(`    skills: ${w.skills.join(", ")}`);
    }

    if (!args[0] && i < result.workflows.length - 1) {
      console.log("");
    }
  }
}

async function handleHealth(
  args: string[],
  flags: { all: boolean },
): Promise<void> {
  warnExtraArgs(args, 1);
  const result = await health({
    projectDir: process.cwd(),
    name: args[0],
    all: flags.all,
  });

  if (result.reports.length === 0 && !args[0] && !flags.all) {
    console.log("No enabled workflows to check. Use --all to check all workflows.");
    return;
  }

  const allHealthy = result.reports.every((r) => r.warnings.length === 0);

  if (allHealthy && !args[0] && !flags.all) {
    console.log("All workflows healthy.");
    return;
  }

  for (let i = 0; i < result.reports.length; i++) {
    const r = result.reports[i];

    const statusSuffix = flags.all ? ` (${r.enabled ? "enabled" : "disabled"})` : "";
    console.log(`${r.workflow}${statusSuffix}:`);

    if (r.warnings.length === 0) {
      console.log("  \u2713 no issues");
    } else {
      for (const w of r.warnings) {
        console.log(`  \u26A0 ${w.entity} "${w.name}" \u2014 ${w.detail}`);
      }
    }

    if (i < result.reports.length - 1) {
      console.log("");
    }
  }
}

async function handleBuild(args: string[]): Promise<void> {
  warnExtraArgs(args, 0);
  const result = await build({
    projectDir: process.cwd(),
  });

  for (const w of result.warnings) {
    console.log(`Warning: ${w}`);
  }

  const counts = formatCount(result.agents, result.commands, result.skills);
  console.log(`Built workflow.json (${counts})`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { command, args, flags } = parseArgs(process.argv.slice(2));

  if (flags.version) {
    console.log(VERSION);
    process.exit(0);
  }

  if (!command || flags.help) {
    console.log(HELP);
    process.exit(0);
  }

  try {
    switch (command) {
      case "install":
      case "i":
        await handleInstall(args, flags);
        break;
      case "remove":
      case "rm":
        await handleRemove(args);
        break;
      case "update":
        await handleUpdate(args);
        break;
      case "enable":
        await handleEnable(args, flags);
        break;
      case "disable":
        await handleDisable(args, flags);
        break;
      case "switch":
        await handleSwitch(args);
        break;
      case "list":
      case "ls":
        await handleList(args);
        break;
      case "health":
        await handleHealth(args, flags);
        break;
      case "build":
        await handleBuild(args);
        break;
      default:
        console.error(`Error: unknown command "${command}"\n`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (err) {
    const message = errorMessage(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
