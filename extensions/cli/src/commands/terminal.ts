import {
  classifyTerminalCommand,
  type ToolPolicy,
  TerminalJobService,
} from "@continuedev/terminal-security";
import os from "node:os";
import path from "node:path";

export interface TerminalInspectOptions {
  policy?: string;
  sandbox?: boolean;
  json?: boolean;
  cwd?: string;
}

export function inspectTerminalCommand(
  command: string,
  options: TerminalInspectOptions = {},
) {
  const policy = options.policy ?? "allowedWithoutPermission";
  if (
    !["allowedWithoutPermission", "allowedWithPermission", "disabled"].includes(
      policy,
    )
  ) {
    throw new Error(`Unknown terminal policy: ${policy}`);
  }
  return classifyTerminalCommand(policy as ToolPolicy, command, {
    sandboxed: options.sandbox,
  });
}

export async function terminalCommand(
  action: string | undefined,
  command: string | undefined,
  options: TerminalInspectOptions,
): Promise<void> {
  const jobs = new TerminalJobService(
    path.join(
      process.env.CONTINUE_GLOBAL_DIR ?? path.join(os.homedir(), ".continue"),
      "terminal-jobs",
    ),
  );
  await jobs.initialize();
  if (action === "jobs") {
    console.log(JSON.stringify(await jobs.list(), null, 2));
    return;
  }
  if (action === "start" && command?.trim()) {
    const job = await jobs.start(command, options.cwd ?? process.cwd());
    console.log(
      options.json
        ? JSON.stringify(job, null, 2)
        : `${job.id}\t${job.status}\t${job.command}`,
    );
    return;
  }
  if ((action === "show" || action === "stop") && command?.trim()) {
    const result =
      action === "stop" ? await jobs.stop(command) : await jobs.get(command);
    if (!result) throw new Error(`Terminal job ${command} does not exist`);
    const output = await jobs.output(command);
    console.log(
      options.json
        ? JSON.stringify({ job: result, output }, null, 2)
        : `${result.status}\n${output}`,
    );
    return;
  }
  if (action !== "inspect" || !command?.trim()) {
    throw new Error(
      "Usage: cn terminal inspect|start|jobs|show|stop [command-or-job-id]",
    );
  }
  const result = inspectTerminalCommand(command, options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Policy: ${result.policy}`);
  console.log(`Execution: ${result.sandboxed ? "sandbox" : "host"}`);
  console.log(`Privilege: ${result.elevated ? "elevated" : "unelevated"}`);
  console.log(`Network: ${result.requiresNetwork ? "yes" : "no"}`);
  for (const reason of result.reasons) console.log(`- ${reason}`);
}
