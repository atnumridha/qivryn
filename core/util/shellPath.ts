import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const SHELL_PATH_TIMEOUT_MS = 2_000;
const shellPathCache = new Map<string, Promise<string | undefined>>();

export async function getEnvPathFromUserShell(
  remoteName?: string,
): Promise<string | undefined> {
  const isWindowsHostWithWslRemote =
    process.platform === "win32" && remoteName === "wsl";
  if (process.platform === "win32" && !isWindowsHostWithWslRemote) {
    return undefined;
  }

  if (!process.env.SHELL) {
    return undefined;
  }

  const cacheKey = `${process.platform}:${remoteName ?? ""}:${process.env.SHELL}`;
  const cached = shellPathCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pathPromise = loadEnvPathFromUserShell();
  shellPathCache.set(cacheKey, pathPromise);
  return pathPromise;
}

async function loadEnvPathFromUserShell(): Promise<string | undefined> {
  try {
    // Source common profile files
    const command = `${process.env.SHELL} -l -c 'for f in ~/.zprofile ~/.zshrc ~/.bash_profile ~/.bashrc; do [ -f "$f" ] && source "$f" 2>/dev/null; done; echo $PATH'`;

    const { stdout } = await execAsync(command, {
      encoding: "utf8",
      timeout: SHELL_PATH_TIMEOUT_MS,
    });

    return stdout.trim();
  } catch (error) {
    return process.env.PATH; // Fallback to current PATH
  }
}
