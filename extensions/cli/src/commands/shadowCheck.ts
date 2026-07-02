import { ShadowWorkspaceValidator } from "@qivryn/agent-runtime";

export async function shadowCheck(
  command: string,
  args: string[],
  options: { repo?: string; json?: boolean },
): Promise<void> {
  const result = await new ShadowWorkspaceValidator().validate(
    options.repo ?? process.cwd(),
    command,
    args,
  );
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
