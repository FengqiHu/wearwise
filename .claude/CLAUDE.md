## Instruction Rules

- **Greeting**: Always start every reply with "Jirui," as a salutation.
- **Decision Confirmation**: When facing uncertain code design decisions, always ask Jirui for clarification first — never take action unilaterally.
- **No Compatibility Code**: Do not write compatibility or polyfill code unless Jirui explicitly requests it.
- **Workflow Awareness**: Before every task execution, first read `workflow.md` to understand Jirui's overall plan, current progress, and what needs to be done next. After completing any code changes, update `workflow.md` with a summary of what was changed and the current status.

## Core Instruction for CodeX MCP

At all times, you must consider how to collaborate with Codex during your current process, and how to invoke the Codex MCP tools as a safeguard for your objective and comprehensive analysis.
You **must execute** the following steps:
**1** After forming an initial analysis of the user's requirements, inform Codex of the user's needs and your preliminary approach, and ask it to refine the requirements analysis and implementation plan.
**2** Before implementing specific coding tasks, **you must request a code implementation prototype from Codex (require Codex to provide only a unified diff patch, strictly prohibiting any actual code modifications)**. After obtaining the code prototype, you **may only use it as a logical reference and must rewrite the code modifications**, creating enterprise-grade, highly readable, and highly maintainable code before executing the actual programming modification tasks.
**3** Whenever you complete actual coding actions, **you must immediately use Codex to review the code changes and the degree of requirement completion**.
**4** Codex can only provide references; you **must have your own thinking and even need to question Codex's answers**. "Reading books without thinking is worse than not reading" — your ultimate mission with Codex is to reach unified, comprehensive, and precise conclusions, so you must continuously debate to find the only path to truth.


## Codex Tool Invocation Specification

 1. Tool Overview

  Codex MCP provides a tool named `codex` for executing AI-assisted coding tasks. This tool **is invoked via the MCP protocol**, not via command line.

  2. Tool Parameters

  **Required** parameters:
  - PROMPT (string): Task instruction sent to Codex
  - cd (Path): Root path of the working directory for Codex execution

  Optional parameters:
  - sandbox (string): Sandbox policy, options:
    - "read-only" (default): Read-only mode, safest
    - "workspace-write": Allow writes within workspace
    - "danger-full-access": Full access permissions
  - SESSION_ID (UUID | null): For continuing previous sessions to enable multi-turn interactions with Codex, defaults to None (start new session)
  - skip_git_repo_check (boolean): Whether to allow running in non-Git repositories, defaults to False
  - return_all_messages (boolean): Whether to return all messages (including reasoning, tool calls, etc.), defaults to False
  - image (List[Path] | null): Attach one or more image files to the initial prompt, defaults to None
  - model (string | null): Specify the model to use, defaults to None (uses user's default configuration)
  - yolo (boolean | null): Run all commands without approval (skip sandboxing), defaults to False
  - profile (string | null): Configuration profile name to load from `~/.codex/config.toml`, defaults to None (uses user's default configuration)

  Return value:
  {
    "success": true,
    "SESSION_ID": "uuid-string",
    "agent_messages": "agent's text response",
    "all_messages": []  // Only included when return_all_messages=True
  }
  Or on failure:
  {
    "success": false,
    "error": "error message"
  }

  3. Usage Methods

  Starting a new conversation:
  - Don't pass SESSION_ID parameter (or pass None)
  - Tool will return a new SESSION_ID for subsequent conversations

  Continuing a previous conversation:
  - Pass the previously returned SESSION_ID as parameter
  - Context from the same session will be preserved

  4. Invocation Standards

  **Must comply**:
  - Every time you call the Codex tool, you must save the returned SESSION_ID for subsequent conversations
  - The cd parameter must point to an existing directory, otherwise the tool will fail silently
  - Strictly prohibit Codex from making actual code modifications; use sandbox="read-only" to prevent accidents, and require Codex to provide only unified diff patches

  Recommended usage:
  - If detailed tracking of Codex's reasoning process and tool calls is needed, set return_all_messages=True
  - For precise location, debugging, rapid code prototyping, and similar tasks, prioritize using the Codex tool

  5. Notes

  - Session management: Always track SESSION_ID to avoid session confusion
  - Working directory: Ensure the cd parameter points to a correct and existing directory
  - Error handling: Check the success field in return values and handle possible errors
