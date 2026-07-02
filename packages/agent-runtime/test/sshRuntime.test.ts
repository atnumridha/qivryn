import { describe, expect, it } from "vitest";
import type { AgentRun } from "../src/contracts.js";
import {
  addSshAttachmentTransfers,
  buildSshRunSpec,
} from "../src/sshRuntime.js";

function createRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "ssh-run",
    revision: 0,
    title: "SSH run",
    prompt: "fix code",
    status: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    permissionMode: "autonomous",
    workspace: {
      id: "ssh-workspace",
      location: "ssh",
      repositoryPath: "/srv/project",
    },
    ...overrides,
  };
}

describe("SSH agent runtime", () => {
  it("builds a non-interactive reconnect-aware SSH process", () => {
    const spec = buildSshRunSpec(createRun({ prompt: "fix 'quoted' code" }), {
      host: "dev@example.test",
      remotePath: "/srv/project",
      port: 2222,
      env: { QIVRYN_AGENT_EVENT_STREAM: "1" },
    });
    expect(spec.command).toBe("ssh");
    expect(spec.args).toEqual(
      expect.arrayContaining([
        "BatchMode=yes",
        "ServerAliveInterval=15",
        "dev@example.test",
      ]),
    );
    expect(spec.args?.at(-1)).toContain("/srv/project");
    expect(spec.args?.at(-1)).toContain("QIVRYN_AGENT_EVENT_STREAM='1'");
    expect(spec.args?.at(-1)).toContain("--autonomous");
    expect(spec.args?.at(-1)).not.toContain("--auto ");
  });

  it("quotes caller-provided image arguments for the remote shell", () => {
    const spec = buildSshRunSpec(createRun(), {
      host: "dev@example.test",
      remotePath: "/srv/project",
      args: ["inspect", "--image", "/tmp/qivryn images/image-1"],
    });
    expect(spec.args?.at(-1)).toContain(
      "'--image' '/tmp/qivryn images/image-1'",
    );
  });

  it("builds attachment upload setup and remote cleanup commands", () => {
    const base = buildSshRunSpec(createRun(), {
      host: "dev@example.test",
      remotePath: "/srv/project",
    });
    const spec = addSshAttachmentTransfers(
      base,
      {
        host: "dev@example.test",
        port: 2222,
        identityFile: "/tmp/id key",
      },
      "/tmp/qivryn-agent-run-attachments",
      [
        {
          localPath: "/tmp/screen shot.png",
          remotePath: "/tmp/qivryn-agent-run-attachments/image-1",
        },
      ],
    );
    expect(spec.setup).toHaveLength(2);
    expect(spec.setup?.[0]).toMatchObject({ command: "ssh" });
    expect(spec.setup?.[1]).toEqual({
      command: "scp",
      args: [
        "-o",
        "BatchMode=yes",
        "-P",
        "2222",
        "-i",
        "/tmp/id key",
        "--",
        "/tmp/screen shot.png",
        "dev@example.test:/tmp/qivryn-agent-run-attachments/image-1",
      ],
    });
    expect(spec.cleanup?.[0].args?.at(-1)).toContain(
      "rm -rf -- '/tmp/qivryn-agent-run-attachments'",
    );
  });

  it("only bypasses command security for full-access SSH runs", () => {
    const spec = buildSshRunSpec(createRun({ permissionMode: "fullAccess" }), {
      host: "dev@example.test",
      remotePath: "/srv/project",
    });
    expect(spec.args?.at(-1)).toContain("--auto");
    expect(spec.args?.at(-1)).not.toContain("--autonomous");
  });

  it("rejects shell-bearing hosts and relative paths", () => {
    const run = createRun();
    expect(() =>
      buildSshRunSpec(run, { host: "host;rm", remotePath: "/repo" }),
    ).toThrow();
    expect(() =>
      buildSshRunSpec(run, { host: "-oProxyCommand=bad", remotePath: "/repo" }),
    ).toThrow();
    expect(() =>
      buildSshRunSpec(run, { host: "host", remotePath: "repo" }),
    ).toThrow();
    expect(() =>
      buildSshRunSpec(run, {
        host: "host",
        remotePath: "/repo",
        env: { "UNSAFE-KEY": "1" },
      }),
    ).toThrow("Unsafe SSH environment key");
  });
});
