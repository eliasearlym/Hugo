# Philosophy: How to Build This Tool

## The Core Idea

Instead of designing this system top-down from abstract principles, we should **reverse-engineer it from concrete, real-world usage**. The approach has two complementary tracks:

1. **Scenario mapping:** Define every scenario a user will encounter from start to finish. For each scenario, carefully specify how the system should behave — what it presents, what it asks, what it does behind the scenes, and what artifacts it produces. This gives us a functional blueprint of the system's behavior.

2. **Reference environment:** Take a real project and manually build the ideal working environment — the folder structures, context documents, plans, snippets, handoff artifacts. Use it to do real work, refining as we go. This gives us a concrete example of the system's outputs.

Together, the scenarios tell us **what the system does** and the reference environment tells us **what it produces**. The tools and APIs we need to build fall directly out of the gap between the two: what automation is required to make the system behave as described in the scenarios and produce environments like the reference?

## Why Scenario-Driven Design

### It defines behavior, not just structure

A hand-built reference environment shows us what the end state should look like, but it doesn't tell us how the system gets there. Scenarios fill that gap. When we define "User starts a new project," we're forced to answer concrete questions:

- What does the system ask the user first?
- How does it determine what pre-planning work is needed?
- When does it create the first context snippets, and from what input?
- At what point does the user transition from pre-planning to planning?
- What happens if the user's answers are vague or incomplete?

These behavioral definitions translate directly into tool requirements and API contracts. There's no guesswork about what to build — the scenarios already specify it.

### It captures the full user journey

It's easy to design for the happy path — the user has a clear goal, the plan decomposes neatly, each task completes successfully. But real work is messy. Scenarios force us to account for the full range of situations:

- **Starting from scratch:** User has a vague idea and needs help refining it.
- **Starting with existing work:** User has a codebase, partial plans, or prior context to import.
- **Mid-task pivots:** Requirements change or the current approach isn't working.
- **Context gaps:** The model is missing information it needs and has to retrieve it.
- **Error recovery:** Something was implemented wrong and needs to be corrected.
- **Session boundaries:** User needs to stop and resume later.
- **Plan revisions:** The plan itself turns out to be wrong and needs restructuring.

Each of these scenarios implies different system behaviors and different tooling. By mapping them upfront, we avoid building a system that only works when everything goes right.

### It gives us direct API and tool guidance

Every scenario contains implicit tool calls. When we write "the system assembles a tailored context payload for the next task," that implies an API that takes a task ID and returns composed context. When we write "the system captures outputs and updates planning state," that implies a handoff tool that persists results and marks tasks complete. The scenarios are essentially a functional spec written in narrative form — we just need to extract the interfaces.

## Why a Reference Environment

### It avoids premature abstraction

The biggest risk in building a tool like this is designing elegant systems that don't match how work actually happens. If we start by writing a planning framework spec, we'll encode untested assumptions about what context documents should look like, how tasks should be scoped, and what information matters.

By building a real environment for a real project, every design decision is grounded in an actual need. We're not guessing what a good context snippet looks like — we're writing real ones, seeing what the model actually needs, and learning from what works.

### It produces a test case and benchmark

The reference environment serves as:

- A **test case** for validating the tool. Can it reproduce something equivalent to what we built by hand?
- **Documentation by example.** Instead of explaining the system abstractly, we can point to a real project and say "this is what the tool creates."
- A **benchmark** for measuring the tool's output quality against the hand-built version.

### It forces us to experience the pain points

By manually constructing the environment, we feel every friction point firsthand. Which context documents were tedious to write? Which ones became stale quickly? Where did the planning hierarchy break down? These pain points become the tool's automation priorities — not hypothetical ones, but ones we actually encountered.

## The Process

### Step 1: Define Scenarios

Map every user scenario from project inception to completion. For each scenario, define:

- **Entry conditions:** What state is the user/system in when this scenario begins?
- **System behavior:** What does the system do, step by step?
- **User interactions:** What input does the system need from the user?
- **Artifacts produced:** What documents, snippets, or state changes result?
- **Exit conditions:** What state is the system in when this scenario ends?
- **Edge cases:** What can go wrong, and how does the system handle it?

### Step 2: Build the Reference Environment

Pick a real project and manually construct the ideal environment: pre-planning artifacts, hierarchical plans, scoped context documents, context composition logic, handoff artifacts, and learning logs. Execute the project using this environment and iterate.

### Step 3: Reconcile

Compare the scenarios against the reference environment. The scenarios describe the system's behavior; the environment demonstrates its outputs. The tools and APIs we need to build are whatever is required to bridge the two — to make the described behaviors produce the demonstrated outputs automatically.

### Step 4: Incremental Automation

Build tooling in priority order based on what the scenarios and reference environment revealed:

- What was most painful to do manually?
- What behaviors are most critical to the user experience?
- What has the highest token/time savings?

Each tool built should make a specific scenario work end-to-end. Progress is measured by how many scenarios the system can handle autonomously.

## The Guiding Principle

**Don't design the machine first. Define what the machine should do in every situation, build its outputs by hand, then construct the machine that performs those behaviors and produces those outputs.**
