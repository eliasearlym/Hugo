# Add `hugo --version` / `-v` Command

## Context

- `src/cli.ts` has hand-rolled arg parsing (`parseArgs()`) and a `main()` with a `switch` dispatching to handler functions
- `src/commands/*.ts` each export typed functions (options -> result) for workflow operations
- `--version` / `-v` don't exist yet. `-v` is currently rejected as an unknown flag (test on line 69-74 of `cli.test.ts`)
- Version lives in `package.json` as `"version": "0.0.1"`

## Design Decision

This is a **top-level flag** (like `--help`), not a subcommand file in `src/commands/`. The version output has no business logic -- it just prints a string. Creating a `src/commands/version.ts` would break the project's convention where commands are workflow operations that take options and return typed results.

## Steps

### 1. Add `version` flag to `parseArgs()` in `src/cli.ts`

Handle `--version` and `-v` alongside the existing `--help` / `-h` pattern. Add `version: boolean` to the flags object.

### 2. Add version output logic in `main()`

Check `flags.version` **before** the existing `if (!command || flags.help)` guard. If version is checked after, `hugo --version` (no subcommand) would match `!command` first and print help instead of the version. The check should be:

```ts
if (flags.version) {
  console.log(VERSION);
  process.exit(0);
}
```

Then the existing help check follows unchanged.

### 3. Read version from `package.json`

The CLI is built with `bun build src/cli.ts --outdir dist`, so a relative `import` of `../package.json` from `src/cli.ts` won't resolve correctly at runtime from `dist/cli.js`. Two viable approaches:

- **Preferred:** Use `import pkg from "../package.json"` -- Bun's bundler inlines JSON imports at build time, so the version string gets baked into `dist/cli.js`. No runtime file read needed.
- **Fallback:** If the JSON import doesn't inline correctly, hardcode a `const VERSION` and update it as part of the release process (or read it at runtime via `fs`).

Verify the chosen approach works by building and running `dist/cli.js --version`.

### 4. Update HELP text

Add `hugo --version` / `hugo -v` to the Options section of the help string.

### 5. Update `cli.test.ts`

- Add tests for `--version` and `-v` (prints version, exits 0)
- Remove or update the existing test (line 69-74) that asserts `-v` is an unknown flag -- that behavior will change

### 6. Build and run tests

Build the project and run the full test suite to verify nothing is broken.
