# Plan: Async Delegation Tools (Status: Finished)

## Problem

OpenCode's native `task` tool handles synchronous delegation well — a primary agent can invoke a subagent, block until it finishes, and receive the result. But it has no async path. The parent agent is frozen while the child works.

This means agents can't fan out parallel subtasks. An orchestrator that needs three independent pieces of research must run them sequentially, tripling wall-clock time for no reason.

The SDK already has `client.session.promptAsync()` — it creates a child session and returns immediately. Nobody wires it up.

## What Exists Natively

OpenCode ships a built-in `task` tool ([`packages/opencode/src/tool/task.ts`](https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/task.ts)) that already handles:

- **Sync delegation**: `SessionPrompt.prompt()` blocks until the subagent finishes
- **Child session creation**: `Session.create({ parentID, title, permission })`
- **Agent targeting**: `subagent_type` param, validated against `Agent.list()`
- **Session continuation**: `task_id` param reuses an existing child session
- **Model inheritance**: Falls back to parent message's model if agent has none configured
- **Tool restriction on children**: Denies `todowrite`, `todoread`, and `task` (unless the agent explicitly has task permission)
- **Permission gating**: `PermissionNext.evaluate("task", agentName, callerPermission)` respects the `permission.task` config
- **Abort propagation**: Parent abort signal cancels child via `SessionPrompt.cancel()`
- **Dynamic agent list**: Tool description auto-populates available subagents and their descriptions

**We are not rebuilding any of this.** The native tool is correct and maintained upstream. We build only what it lacks.

## What's Missing

| Capability | Native `task` tool | Gap |
|---|---|---|
| Sync delegation | ✅ Blocks, returns result | — |
| Async delegation (fire-and-forget) | ❌ | No `promptAsync` path |
| Parallel fan-out | ❌ | Can't launch multiple without blocking |
| Result retrieval for async tasks | ❌ | No way to poll or collect |
| Batch collection ("wait for all") | ❌ | No multi-task gather |

## Goal

Build two plugin tools — `async_task` and `async_task_result` — that extend OpenCode's delegation with async fan-out. The native `task` tool remains the default for simple sync cases; these tools add parallel execution when an orchestrator needs it.

## SDK Reference

The plugin SDK (`@opencode-ai/plugin` v1.1.19) provides these relevant APIs. All methods use flat parameter objects.

### Session APIs

```typescript
// Create a child session
client.session.create({
  parentID?: string,
  title?: string,
  directory?: string,
  permission?: PermissionRuleset,   // Array<{ permission, pattern, action }>
})

// Send prompt — blocks until agent finishes
client.session.prompt({
  sessionID: string,
  agent?: string,
  parts?: Array<TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput>,
  system?: string,
  model?: { providerID: string, modelID: string },
  tools?: Record<string, boolean>,
  directory?: string,
})

// Send prompt — returns immediately
client.session.promptAsync({
  // same shape as session.prompt
})

// Retrieve messages
client.session.messages({
  sessionID: string,
  directory?: string,
  limit?: number,
})

// Get status for all sessions
client.session.status({
  directory?: string,
})

// List agents
client.app.agents({
  directory?: string,
})
```

### Key Types

```typescript
// What we send as prompt content
type TextPartInput = { type: "text", text: string, ... }

// Session status (from session.status response)
type SessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry", attempt: number, message: string, next: number }
// Note: there is NO "error" status. Errors surface on the AssistantMessage.

// Assistant message (from session.messages response)
type AssistantMessage = {
  id: string,
  role: "assistant",
  error?: ProviderAuthError | UnknownError | MessageOutputLengthError
        | MessageAbortedError | ApiError,
  ...
}

// Message parts (from part events or message retrieval)
type TextPart = { type: "text", text: string, ... }

// Permission rules
type PermissionRuleset = Array<{
  permission: string,
  pattern: string,
  action: "allow" | "deny" | "ask"
}>
```

### Plugin Tool API

```typescript
import { tool } from "@opencode-ai/plugin"

tool({
  description: string,
  args: { [key]: z.ZodType },                    // zod schema for arguments
  execute(args, context: ToolContext): Promise<string>,  // must return string
})

// ToolContext provides:
// - sessionID, messageID, agent, directory, worktree
// - abort: AbortSignal
// - metadata(input: { title?, metadata? }): void
// - ask(input: { permission, patterns, always, metadata }): Promise<void>
```

### Plugin Registration

```typescript
const MyPlugin: Plugin = async (ctx) => {
  // ctx: { client, project, directory, worktree, serverUrl, $ }
  return {
    tool: {
      my_tool: tool({ ... }),
    },
  }
}
```

## Design

### Tool: `async_task`

Launches a subagent asynchronously and returns a task handle immediately.

**Arguments:**

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `agent` | string | yes | Target subagent name (must not be `mode: "primary"`) |
| `prompt` | string | yes | The task for the subagent to perform |
| `description` | string | yes | Short label (3-5 words), used as session title |

**Execution:**

1. Fetch available agents via `client.app.agents()`, filter to non-primary
2. Validate `agent` exists in the filtered list; if not, error with available agent names
3. Create child session via `client.session.create()`:
   - `parentID`: current `context.sessionID`
   - `title`: `description` + ` (@agent subagent)`
   - `directory`: `context.directory`
   - `permission`: deny `todowrite`, `todoread`, `task`, and `question` on children (mirrors native behavior, plus `question` since async children can't prompt the user)
4. Fire `client.session.promptAsync()` with:
   - `sessionID`: child session ID
   - `agent`: target agent name
   - `parts`: `[{ type: "text", text: prompt }]`
   - `tools`: `{ todowrite: false, todoread: false, task: false, question: false }`
5. Return immediately with the child session ID as the task handle

**Return format** (string):

```
task_id: <session_id>
agent: <agent_name>
description: <description>
status: launched

Use async_task_result with this task_id to retrieve the result when ready.
```

**Why separate from the native `task` tool?** Adding `async: boolean` to a single tool would shadow the native `task` tool for sync cases, creating two tools that do the same thing. Separate names make intent unambiguous: `task` for sync (native), `async_task` for async (plugin).

### Tool: `async_task_result`

Retrieves the result of a previously launched async task.

**Arguments:**

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `task_id` | string | yes | Session ID from a previous `async_task` call |

**Execution:**

1. Call `client.session.status()` to get status for all sessions
2. Find the entry matching `task_id`
3. Branch on status:

**If `busy` or `retry`:**
```
status: running
task_id: <session_id>

The task is still in progress. Try again shortly.
```

**If `idle`:**
1. Call `client.session.messages({ sessionID: task_id })` to retrieve messages
2. Find the last `AssistantMessage`
3. Check `message.error` — if present, format and return the error
4. Otherwise extract text from message parts (see "Extracting Text" section below)
5. Return:
```
status: complete
task_id: <session_id>

<task_result>
<extracted text from last assistant message>
</task_result>
```

**If no status found for session:**
```
status: error
task_id: <session_id>

Session not found. The task_id may be invalid or the session was deleted.
```

**Error on assistant message:**
```
status: error
task_id: <session_id>
error_type: <error.name>

<error.data.message or structured error details>
```

### Extracting Text from Completed Sessions

The native `task` tool uses the internal `SessionPrompt.prompt()` which returns parts directly in the response. The plugin SDK goes through the HTTP API, which returns messages and parts differently.

The approach:
1. Call `client.session.messages({ sessionID })` — returns `Message[]`
2. Find the last message with `role: "assistant"`
3. Check its `error` field for failures
4. To get the actual text: message parts are delivered via `message.part.updated` events. We need to determine whether `session.messages()` includes part content inline or if we need to subscribe to events.

**This is an open implementation question that Step 1 (SDK Spike) must resolve.** Possible paths:
- **Parts are inline in the message response** → straightforward extraction
- **Parts require separate event subscription** → we'd need to subscribe to SSE events during the async prompt and cache the final text
- **Parts are available via a per-message endpoint** → call `client.session.message({ sessionID, messageID })` for the specific assistant message

### What We're NOT Building

- **Sync delegation** — The native `task` tool handles this. Use it.
- **Session continuation/resume** — The native `task` tool's `task_id` param already does this.
- **Agent discovery tool** — The native `task` tool dynamically lists available agents in its description.
- **Category/model routing** — Agents specify targets directly. Model selection comes from agent config or inherits from parent.
- **Skill injection** — Out of scope. Agent prompts come from markdown files.
- **Toast notifications** — The TUI handles child session display natively.
- **Batch/gather tool** — Deferred. An orchestrator can call `async_task_result` multiple times. A `gather` tool that takes multiple task IDs and waits for all of them is a natural follow-up but not v1.

## Implementation Plan

### Step 1: SDK Spike — Async Round-Trip

Before building the tools, validate that the async flow works end-to-end through the plugin SDK.

**Goal:** Confirm that `client.session.promptAsync()` + `client.session.status()` + `client.session.messages()` can launch, monitor, and retrieve results from a child session.

**Spike tasks:**
1. Create a minimal test tool that calls `promptAsync` on a child session
2. Poll `session.status()` until the child session goes idle
3. Call `session.messages()` on the completed session
4. Determine how to extract the assistant's text response — specifically, how parts are returned through the HTTP API vs. the internal `SessionPrompt.prompt()`
5. Document: does `messages()` return parts inline? Do we need event subscription? Is there a simpler path?

**Output:** A working proof that async delegation round-trips through the SDK, and a documented method for extracting the final text.

### Step 2: `async_task` Tool

Implement the async launch tool.

**Files:**
- `src/tools/async-task.ts` — tool definition
- `src/index.ts` — register in plugin hooks

**Details:**
- Fetch agents via `client.app.agents()`, filter to non-primary
- Create child session with appropriate permissions (mirror native `task` tool restrictions + deny `question`)
- Call `client.session.promptAsync()`
- Return session ID as task handle
- Set metadata via `context.metadata()` for TUI display

**Validation:**
- Agent calls `async_task` targeting a subagent → returns immediately with task_id
- Child session appears in TUI session list
- Child session actually runs (visible in TUI child session navigation)

### Step 3: `async_task_result` Tool

Implement the result retrieval tool.

**Files:**
- `src/tools/async-task-result.ts` — tool definition
- `src/index.ts` — register in plugin hooks

**Details:**
- Call `session.status()` and filter to the target session
- Branch on `idle`/`busy`/`retry`/not-found
- For idle sessions: retrieve messages, extract text using the method from Step 1
- Check `AssistantMessage.error` for failure cases
- Format output as structured text

**Validation:**
- `async_task_result` on a running task → "still running"
- `async_task_result` on a completed task → returns the assistant's response text
- `async_task_result` on a failed task → returns error details
- `async_task_result` with an invalid session ID → returns "not found"

### Step 4: Integration Test — Parallel Fan-Out

End-to-end test with an orchestrator that uses both tools together.

**Setup:**
- Define an `orchestrator` primary agent and 2+ subagents in opencode config
- Orchestrator's prompt instructs it to use `async_task` for parallel work and `async_task_result` to collect

**Test scenario:**
1. Orchestrator receives a request requiring multiple independent research tasks
2. Orchestrator fires 2-3 `async_task` calls to different subagents
3. Orchestrator calls `async_task_result` for each, handling "still running" by retrying
4. Orchestrator synthesizes results and responds to user

**Success criteria:**
- All subtasks complete without errors
- Orchestrator correctly collects all results
- Wall-clock time is meaningfully less than sequential execution would take
- Child sessions are visible and navigable in TUI

### Step 5: Error Handling Hardening

- Agent name doesn't match any available agent → clear error listing available agents
- `promptAsync` fails (e.g., provider auth error) → surface error immediately, don't return a task_id for a dead session
- Child session gets aborted → `async_task_result` returns appropriate error
- Parent session gets aborted → investigate whether child sessions are cancelled automatically via `parentID` relationship, or if we need to handle it via the plugin's `event` hook

## Resolved Questions

These were open in the previous version of this plan. Answered from the SDK source and the native `task` tool implementation.

**1. Should child sessions have the `question` tool denied?**
Yes, for async tasks specifically. A question would block the child session indefinitely since the parent isn't waiting. The native sync `task` tool doesn't deny it (the parent is blocking, so a question could theoretically propagate), but for async this is a must.

**2. Should we pass the parent's directory to the child session?**
Yes. The plugin receives `directory` from `PluginInput` and the tool receives it from `ToolContext.directory`. Pass it to `session.create()`. The native tool inherits directory implicitly through internal APIs; the SDK requires it explicitly.

**3. Should we restrict child session tools?**
Yes, mirror the native tool's behavior:
- `todowrite: false` — subagents shouldn't manage the parent's todo list
- `todoread: false` — same reason
- `task: false` — prevent recursive delegation (unless the target agent explicitly has task permission, matching native behavior)
- `question: false` — added for async specifically (see #1)

**4. Do we need session continuation?**
Not for async tasks. The native `task` tool already supports continuation via `task_id` for sync cases. Async tasks are fire-and-forget with result collection — continuation doesn't fit the pattern.
