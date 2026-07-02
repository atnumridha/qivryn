#!/usr/bin/env node

// MUST be the first import - intercepts console/stdout/stderr before any dependencies load
import "./init.js";

import { Command } from "commander";

import { chat } from "./commands/chat.js";
import { agentsCommand } from "./commands/agents.js";
import { checks } from "./commands/checks.js";
import { listSessionsCommand } from "./commands/ls.js";
import { review } from "./commands/review.js";
import { serve } from "./commands/serve.js";
import { terminalCommand } from "./commands/terminal.js";
import { browserCommand } from "./commands/browser.js";
import { slackCommand } from "./commands/slack.js";
import { commitMessageCommand } from "./commands/commitMessage.js";
import { shadowCheck } from "./commands/shadowCheck.js";
import { skillsCommand } from "./commands/skills.js";
import {
  handleValidationErrors,
  validateFlags,
} from "./flags/flagValidator.js";
import { configureConsoleForHeadless, safeStderr } from "./init.js";
import { addCommonOptions, mergeParentOptions } from "./shared-options.js";
import { post } from "./util/apiClient.js";
import { markUnhandledError } from "./util/errorState.js";
import { gracefulExit } from "./util/exit.js";
import { logger } from "./util/logger.js";
import { readStdinSync } from "./util/stdin.js";
import { getVersion } from "./version.js";

// TUI lifecycle and two-stage exit state management
let tuiUnmount: (() => void) | null;
let showExitMessage: boolean;
let exitMessageCallback: (() => void) | null;
let lastCtrlCTime: number;

// Agent ID for serve mode - set when serve command is invoked with --id
let agentId: string | undefined;

// Initialize state immediately to avoid temporal dead zone issues with exported functions
(function initializeTUIState() {
  tuiUnmount = null;
  showExitMessage = false;
  exitMessageCallback = null;
  lastCtrlCTime = 0;
})();

// Set the agent ID for error reporting (called by serve command)
export function setAgentId(id: string | undefined) {
  agentId = id;
}

// Register TUI cleanup function for graceful shutdown
export function setTUIUnmount(unmount: () => void) {
  tuiUnmount = unmount;
}

// Register callback to trigger UI updates when exit message state changes
export function setExitMessageCallback(callback: () => void) {
  exitMessageCallback = callback;
}

// Sets up SIGINT handler that requires double Ctrl+C within 1 second to exit
export function enableSigintHandler() {
  // Remove all existing SIGINT listeners first
  process.removeAllListeners("SIGINT");

  process.on("SIGINT", async () => {
    const now = Date.now();
    const timeSinceLastCtrlC = now - lastCtrlCTime;

    if (timeSinceLastCtrlC <= 1000 && lastCtrlCTime !== 0) {
      // Second Ctrl+C within 1 second - exit
      showExitMessage = false;
      if (tuiUnmount) {
        tuiUnmount();
      }
      await gracefulExit(0);
    } else {
      // First Ctrl+C or too much time elapsed - show exit message
      lastCtrlCTime = now;
      showExitMessage = true;
      if (exitMessageCallback) {
        exitMessageCallback();
      }

      // Hide message after 1 second
      setTimeout(() => {
        showExitMessage = false;
        if (exitMessageCallback) {
          exitMessageCallback();
        }
      }, 1000);
    }
  });
}

// Check if "ctrl+c to exit" message should be displayed
export function shouldShowExitMessage(): boolean {
  return showExitMessage;
}

// Helper to report unhandled errors to the API when running in serve mode
async function reportUnhandledErrorToApi(error: Error): Promise<void> {
  if (!agentId) {
    // Not running in serve mode with an agent ID, skip API reporting
    return;
  }

  try {
    await post(`agents/${agentId}/status`, {
      status: "FAILED",
      errorMessage: `Unhandled error: ${error.message}`,
    });
    logger.debug(`Reported unhandled error to API for agent ${agentId}`);
  } catch (apiError) {
    // If API reporting fails, just log it - don't crash
    logger.debug(
      `Failed to report error to API: ${apiError instanceof Error ? apiError.message : String(apiError)}`,
    );
  }
}

// Add global error handlers to prevent uncaught errors from crashing the process
process.on("unhandledRejection", (reason, promise) => {
  // Mark that an unhandled error occurred - this will cause non-zero exit
  markUnhandledError();

  // Extract useful information from the reason
  const errorDetails = {
    promiseString: String(promise),
    reasonType: typeof reason,
    reasonConstructor: reason?.constructor?.name,
  };

  // If reason is an Error, use it directly for better stack traces
  if (reason instanceof Error) {
    logger.error("Unhandled Promise Rejection", reason, errorDetails);
    // Report to API if running in serve mode
    reportUnhandledErrorToApi(reason).catch(() => {
      // Silently fail if API reporting errors - already logged in helper
    });
  } else {
    // Convert non-Error reasons to Error for consistent handling
    const error = new Error(`Unhandled rejection: ${String(reason)}`);
    logger.error("Unhandled Promise Rejection", error, {
      ...errorDetails,
      originalReason: String(reason),
    });
    // Report to API if running in serve mode
    reportUnhandledErrorToApi(error).catch(() => {
      // Silently fail if API reporting errors - already logged in helper
    });
  }

  // Don't exit the process immediately, but hasUnhandledError will cause non-zero exit later
});

process.on("uncaughtException", (error) => {
  // Mark that an unhandled error occurred - this will cause non-zero exit
  markUnhandledError();

  logger.error("Uncaught Exception:", error);
  // Report to API if running in serve mode
  reportUnhandledErrorToApi(error).catch(() => {
    // Silently fail if API reporting errors - already logged in helper
  });
  // Don't exit the process immediately, but hasUnhandledError will cause non-zero exit later
});

// keyboard interruption handler for non-TUI flows
process.on("SIGINT", async () => {
  await gracefulExit(130);
});

const program = new Command();

program
  .name("qivryn")
  .description(
    "Qivryn CLI - AI-powered development assistant. Starts an interactive session by default, use -p/--print for non-interactive output.",
  )
  .version(getVersion(), "-v, --version", "Display version number");

// Root command - chat functionality (default)
// Add common options to the root command
addCommonOptions(program)
  .argument("[prompt]", "Optional prompt to send to the assistant")
  .option("-p, --print", "Print response and exit (useful for pipes)")
  .option(
    "--format <format>",
    "Output format for headless mode (json). Only works with -p/--print flag.",
  )
  .option(
    "--silent",
    "Strip <think></think> tags and excess whitespace from output. Only works with -p/--print flag.",
  )
  .option("--resume", "Resume from last session")
  .option("--fork <sessionId>", "Fork from an existing session ID")
  .option(
    "--beta-subagent-tool",
    "Deprecated: subagents are enabled by default",
  )
  .action(async (prompt, options) => {
    // Handle piped input - detect it early and decide on mode
    let stdinInput = null;

    if (!options.print) {
      // Check if there's piped input available
      stdinInput = readStdinSync();
      if (stdinInput) {
        // Use piped input as the initial prompt
        if (prompt) {
          // Combine stdin and prompt argument
          prompt = `${stdinInput}\n\n${prompt}`;
        } else {
          // Only stdin input, use as initial prompt
          prompt = stdinInput;
        }

        // We have piped input but want to use TUI mode
        // Store a flag to pass custom stdin to TUI
        (options as any).hasPipedInput = true;
      }
    }

    // Configure console overrides FIRST, before any other logging
    const isHeadless = options.print;
    configureConsoleForHeadless(isHeadless);
    logger.configureHeadlessMode(isHeadless);

    // Validate all command line flags
    const validation = validateFlags({
      print: options.print,
      format: options.format,
      silent: options.silent,
      readonly: options.readonly,
      autonomous: options.autonomous,
      auto: options.auto,
      config: options.config,
      resume: options.resume,
      fork: options.fork,
      allow: options.allow,
      ask: options.ask,
      exclude: options.exclude,
      isRootCommand: true,
      commandName: "qivryn",
    });

    if (!validation.isValid) {
      handleValidationErrors(validation.errors);
    }

    if (options.verbose) {
      logger.setLevel("debug");
      const logPath = logger.getLogPath();
      const sessionId = logger.getSessionId();
      // In headless mode, suppress these verbose logs
      if (!isHeadless) {
        console.log(`Verbose logging enabled (session: ${sessionId})`);
        console.log(`Logs: ${logPath}`);
        console.log(
          `Filter this session: grep '\\[${sessionId}\\]' ${logPath}`,
        );
      }
      logger.debug("Verbose logging enabled");
    }

    // Handle piped input for headless mode (only if we haven't already read it)
    if (options.print && !stdinInput) {
      const headlessStdinInput = readStdinSync();
      if (headlessStdinInput) {
        if (prompt) {
          // Combine stdin and prompt argument - stdin comes first in XML block
          prompt = `<stdin>\n${headlessStdinInput}\n</stdin>\n\n${prompt}`;
        } else {
          // Only stdin input, use as-is
          prompt = headlessStdinInput;
        }
      }
    }

    // In headless mode, ensure we have a prompt unless using --agent flag or --resume flag
    // Agent files can provide their own prompts, and resume can work without new input
    if (options.print && !prompt && !options.agent && !options.resume) {
      safeStderr(
        "Error: A prompt is required when using the -p/--print flag, unless --prompt, --agent, or --resume is provided.\n\n",
      );
      safeStderr("Usage examples:\n");
      safeStderr('  qivryn -p "please review my current git diff"\n');
      safeStderr('  echo "hello" | qivryn -p\n');
      safeStderr('  qivryn -p "analyze the code in src/"\n');
      safeStderr("  qivryn -p --agent my-org/my-agent\n");
      safeStderr("  qivryn -p --prompt my-org/my-prompt\n");
      safeStderr("  qivryn -p --resume\n");
      await gracefulExit(1);
    }

    // Map --print to headless mode
    options.headless = options.print;
    options.print = undefined;
    await chat(prompt, options);
  });

// List sessions subcommand
program
  .command("ls")
  .description("List recent chat sessions and select one to resume")
  .option("--json", "Output in JSON format")
  .action(async (options) => {
    await listSessionsCommand({
      format: options.json ? "json" : undefined,
    });
  });

program
  .command("agents [action] [run-id]")
  .description("List and inspect local agent runs")
  .option("--json", "Output in JSON format")
  .option("--all", "Include archived runs")
  .option("--events", "Include the event stream when showing a run")
  .option("--title <title>", "New title for the rename action")
  .option("--prompt <prompt>", "Follow-up prompt for the queue action")
  .option("--item <item-id>", "Queue item for the queue-remove action")
  .option("--behavior <behavior>", "Queue behavior: run-next or steer")
  .option("--items <items...>", "Queue item IDs or quoted multitask prompts")
  .option("--label <label>", "Checkpoint label")
  .option("--repo <path>", "Repository for a new local agent")
  .option("--model <model>", "Model for a new local agent")
  .option("--name <name>", "Automation name")
  .option("--skill <name>", "Use a discovered skill for the task")
  .option(
    "--interval-minutes <minutes>",
    "Run an automation at a local interval",
  )
  .option("--runtime <runtime>", "Agent runtime: local, docker, or ssh")
  .option("--image <image>", "Container image for the Docker runtime")
  .option("--network <network>", "Docker network for writable modes")
  .option(
    "--privileged",
    "Allow a privileged Docker container (fullAccess only)",
  )
  .option("--ssh-host <host>", "SSH host or user@host")
  .option("--ssh-path <path>", "Absolute project path on the SSH host")
  .option("--ssh-port <port>", "SSH port")
  .option("--identity-file <path>", "SSH identity file")
  .option(
    "--file <path>",
    "File for agent export, import, ingest, or diagnostics output",
  )
  .option("--branch <name>", "New branch name for worktree-rename")
  .option(
    "--permission-mode <mode>",
    "Permission mode: ask, autonomous, fullAccess, or readOnly",
  )
  .option(
    "--detach",
    "Start the agent in the background and return immediately",
  )
  .option("--parent-run <run-id>", "Create the agent as a child of another run")
  .option("--steps <steps...>", "Plan steps")
  .option(
    "--plan-status <status>",
    "Plan status: draft, approved, rejected, or completed",
  )
  .action(async (action, runId, options, command) => {
    const commandOptions =
      typeof command?.opts === "function"
        ? command.opts()
        : typeof options?.opts === "function"
          ? options.opts()
          : options;
    const mergedOptions = mergeParentOptions(program, commandOptions);
    if (Array.isArray(mergedOptions.prompt)) {
      mergedOptions.prompt = mergedOptions.prompt.at(-1);
    }
    if (Array.isArray(mergedOptions.model)) {
      mergedOptions.model = mergedOptions.model.at(-1);
    }
    await agentsCommand(action, runId, mergedOptions);
  });

program
  .command("skills [action] [name]")
  .description("List, inspect, create, or edit local Markdown skills")
  .option("--name <name>", "Skill name")
  .option("--description <description>", "When the skill should be used")
  .option("--instructions <markdown>", "Skill instruction Markdown")
  .option("--file <path>", "Read skill instructions from a file")
  .option("--workspace", "Create in this workspace instead of globally")
  .option("--json", "Output structured results")
  .action(async (action, name, options) =>
    skillsCommand(action, name, options),
  );

program
  .command("shadow-check <command> [args...]")
  .description("Run validation in an isolated dirty-tree snapshot")
  .option("--repo <path>", "Repository to validate")
  .option("--json", "Output structured results")
  .action(async (command, args, options) =>
    shadowCheck(command, args, options),
  );

program
  .command("commit-message")
  .description("Generate an editable commit-message draft from Git changes")
  .option("--unstaged", "Include staged and unstaged changes")
  .option("--json", "Output JSON")
  .option("--cwd <path>", "Working directory for a background job")
  .action(async (options) => {
    await commitMessageCommand(options);
  });

program
  .command("terminal [action] [command]")
  .description("Inspect terminal command policy and execution context")
  .option(
    "--policy <policy>",
    "allowedWithoutPermission, allowedWithPermission, or disabled",
  )
  .option("--sandbox", "Preview sandboxed execution")
  .option("--json", "Output JSON")
  .action(async (action, command, options) => {
    await terminalCommand(action, command, options);
  });

program
  .command("browser [action] [session-id]")
  .description("Control persistent local browser sessions")
  .option("--url <url>", "URL for create or navigate")
  .option("--visible", "Open a visible browser window")
  .option("--output <path>", "Write a screenshot to a file")
  .option("--width <pixels>", "Viewport width")
  .option("--height <pixels>", "Viewport height")
  .option("--recording <mode>", "Recording mode: off, events, or full")
  .option(
    "--permission <action>",
    "Scoped permission action or grant ID for revoke",
  )
  .option("--origin <origin>", "Origin scope for a browser grant")
  .option("--expires-at <iso-time>", "Optional browser grant expiry")
  .option("--json", "Output JSON")
  .action(async (action, sessionId, options) => {
    await browserCommand(action, sessionId, options);
  });

program
  .command("slack [action]")
  .description("Use the optional explicitly-authorized Slack connector")
  .option("--channels <ids>", "Comma-separated channel allowlist")
  .option("--write", "Explicitly authorize posting messages")
  .option(
    "--token-env <name>",
    "Environment variable containing the bot token",
    "SLACK_BOT_TOKEN",
  )
  .option("--channel <id>", "Allowlisted channel ID")
  .option("--text <text>", "Message text for post")
  .option("--thread <timestamp>", "Thread timestamp for post")
  .option("--limit <count>", "Message count", "50")
  .option("--json", "Output JSON")
  .action(async (action, options) => {
    await slackCommand(action, options);
  });

// Serve subcommand
program
  .command("serve [prompt]", { hidden: true })
  .description("Start an HTTP server with /state and /message endpoints")
  .option(
    "--timeout <seconds>",
    "Inactivity timeout in seconds (default: 300)",
    "300",
  )
  .option("--port <port>", "Port to run the server on (default: 8000)", "8000")
  .option(
    "--id <storageId>",
    "Upload session snapshots to Qivryn-managed storage using the provided identifier",
  )
  .option(
    "--beta-upload-artifact-tool",
    "Enable beta UploadArtifact tool for uploading screenshots, videos, and logs",
  )
  .action(async (prompt, options) => {
    // Merge parent options with subcommand options
    const mergedOptions = mergeParentOptions(program, options);

    if (mergedOptions.verbose) {
      logger.setLevel("debug");
      logger.debug("Verbose logging enabled");
    }

    await serve(prompt, mergedOptions);
  });

// Checks subcommand
program
  .command("checks [action] [pr-url]")
  .description("Show CI check statuses for a PR")
  .action(async (action: string | undefined, prUrl: string | undefined) => {
    await checks(action, prUrl);
  });

// Review subcommand
program
  .command("review")
  .description("Run AI-powered reviews on your changes")
  .option("--base <ref>", "Base git ref to diff against (default: auto-detect)")
  .option("--format <format>", "Output format")
  .option("--fix", "Automatically apply suggested fixes")
  .option("--patch", "Show patches")
  .option("--fail-fast", "Stop on first failure")
  .option("--review-agents <agents...>", "Specific review agents to run")
  .option("--local", "Use the shared local review engine used by the IDE")
  .option(
    "--target <target>",
    "Local target: working-tree, staged, commit:<sha>, branch:<base>...<head>, files:<paths>, or pr:<url>",
  )
  .option("--mode <mode>", "Local review depth: fast, standard, or deep")
  .option("--verbose", "Enable verbose logging")
  .action(async (options) => {
    const commandOptions =
      typeof options?.opts === "function" ? options.opts() : options;
    await review(mergeParentOptions(program, commandOptions));
  });

// Handle unknown commands
program.on("command:*", () => {
  console.error(`Error: Unknown command '${program.args.join(" ")}'\n`);
  program.outputHelp();
  void gracefulExit(1);
});

export async function runCli(): Promise<void> {
  // Handle internal worker subprocess for qivryn review
  if (process.argv.includes("--internal-review-worker")) {
    const { runReviewWorker } = await import(
      "./commands/review/reviewWorker.js"
    );
    await runReviewWorker();
    return;
  }

  // Parse arguments and handle errors
  try {
    program.parse();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }

  process.on("SIGTERM", async () => {
    await gracefulExit(0);
  });
}
