#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_REPO = "atnumridha/qivryn";
const OSX_HELPERS = [
  "/Library/Developer/CommandLineTools/usr/libexec/git-core/git-credential-osxkeychain",
  "/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core/git-credential-osxkeychain",
];

function usage() {
  console.error(`Usage:
  github_release_asset.mjs --tag v1.3.42-vscode [--repo atnumridha/qivryn] [--asset path/to.vsix]
    --list                       List release assets
    --upload                     Upload --asset
    --replace                    Delete an existing asset with the same name before upload
    --create                     Create the release when --tag is missing
    --target main                Target commitish when creating a release
    --title "VSCode Release"     Release title when creating a release
    --notes "..."                Release notes when creating a release
    --prerelease                 Mark created release as prerelease
    --draft                      Mark created release as draft
`);
}

function getArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function commandExists(commandPath) {
  try {
    return fs.existsSync(commandPath);
  } catch {
    return false;
  }
}

function keychainHelper() {
  return OSX_HELPERS.find(commandExists);
}

function readGitCredential() {
  const input = "protocol=https\nhost=github.com\n\n";
  const helper = keychainHelper();
  const args = helper
    ? ["-c", `credential.helper=${helper}`, "credential", "fill"]
    : ["credential", "fill"];
  const result = spawnSync("git", args, { input, encoding: "utf8" });
  if (result.status !== 0) {
    return undefined;
  }
  return Object.fromEntries(
    result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function authHeaders() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) {
    return { authorization: `Bearer ${token}` };
  }

  const credential = readGitCredential();
  if (!credential?.password) {
    throw new Error(
      "No GitHub token found. Set GH_TOKEN/GITHUB_TOKEN or configure a GitHub credential in macOS Keychain.",
    );
  }

  const username = credential.username || "x-access-token";
  return {
    authorization: `Basic ${Buffer.from(
      `${username}:${credential.password}`,
    ).toString("base64")}`,
  };
}

async function githubFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "user-agent": "qivryn-release-build-skill",
      accept: "application/vnd.github+json",
      ...authHeaders(),
      ...(options.headers ?? {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function getRelease(repo, tag) {
  const { response, body } = await githubFetch(
    `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(
      tag,
    )}`,
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `Release lookup failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function createRelease(repo, tag) {
  const title = getArg("--title", `VSCode Release ${tag}`);
  const target = getArg("--target", "main");
  const notes = getArg(
    "--notes",
    `Release ${tag} built and uploaded from ${target}.`,
  );
  const { response, body } = await githubFetch(
    `https://api.github.com/repos/${repo}/releases`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: target,
        name: title,
        body: notes,
        draft: hasFlag("--draft"),
        prerelease: hasFlag("--prerelease"),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Release creation failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }
  return body;
}

function summarizeAssets(release) {
  return (release.assets ?? []).map((asset) => ({
    name: asset.name,
    size: asset.size,
    updated_at: asset.updated_at,
    url: asset.browser_download_url,
  }));
}

async function deleteAsset(asset) {
  const { response, body } = await githubFetch(asset.url, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(
      `Asset deletion failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }
}

async function uploadAsset(release, assetPath, replace) {
  if (!assetPath) {
    throw new Error("--asset is required with --upload");
  }
  if (!fs.existsSync(assetPath)) {
    throw new Error(`Asset does not exist: ${assetPath}`);
  }

  const name = path.basename(assetPath);
  const existing = (release.assets ?? []).find((asset) => asset.name === name);
  if (existing) {
    if (!replace) {
      throw new Error(
        `Release already has ${name}. Re-run with --replace to overwrite it.`,
      );
    }
    await deleteAsset(existing);
  }

  const uploadUrl =
    release.upload_url.replace("{?name,label}", "") +
    `?name=${encodeURIComponent(name)}`;
  const data = fs.readFileSync(assetPath);
  const { response, body } = await githubFetch(uploadUrl, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(data.length),
    },
    body: data,
  });

  if (!response.ok) {
    throw new Error(
      `Asset upload failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }

  return {
    name: body.name,
    size: body.size,
    url: body.browser_download_url,
    updated_at: body.updated_at,
  };
}

async function main() {
  const repo = getArg("--repo", DEFAULT_REPO);
  const tag = getArg("--tag");
  const assetPath = getArg("--asset");

  if (!tag || (!hasFlag("--list") && !hasFlag("--upload"))) {
    usage();
    process.exit(2);
  }

  let release = await getRelease(repo, tag);
  if (!release && hasFlag("--create")) {
    release = await createRelease(repo, tag);
  }
  if (!release) {
    throw new Error(`Release not found for tag ${tag}. Re-run with --create.`);
  }

  let uploaded;
  if (hasFlag("--upload")) {
    uploaded = await uploadAsset(release, assetPath, hasFlag("--replace"));
    release = await getRelease(repo, tag);
  }

  console.log(
    JSON.stringify(
      {
        repo,
        tag,
        release_url: release.html_url,
        uploaded,
        assets: summarizeAssets(release),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
