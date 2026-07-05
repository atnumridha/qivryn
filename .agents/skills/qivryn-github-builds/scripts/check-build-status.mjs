#!/usr/bin/env node

const args = parseArgs(process.argv.slice(2));
const repository = args.repo ?? "atnumridha/qivryn";
const tag = args.tag;
const branch = args.branch;
const runId = args.run;

const base = `https://api.github.com/repos/${repository}`;

if (!tag && !branch && !runId) {
  fail("Provide --tag <tag>, --branch <branch>, or --run <run-id>.");
}

const run = runId
  ? await fetchJson(`${base}/actions/runs/${runId}`)
  : await latestRun();

const jobs = await fetchJson(run.jobs_url);
const artifacts = await fetchJson(run.artifacts_url);

console.log(
  JSON.stringify(
    {
      repository,
      run: {
        id: run.id,
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
        html_url: run.html_url,
        head_branch: run.head_branch,
        head_sha: run.head_sha,
      },
      jobs: (jobs.jobs ?? []).map((job) => ({
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        html_url: job.html_url,
      })),
      artifacts: (artifacts.artifacts ?? []).map((artifact) => ({
        name: artifact.name,
        size_in_bytes: artifact.size_in_bytes,
        expired: artifact.expired,
        archive_download_url: artifact.archive_download_url,
      })),
    },
    null,
    2,
  ),
);

async function latestRun() {
  const runs = await fetchJson(
    `${base}/actions/workflows/qivryn-ide-installers.yml/runs?per_page=20`,
  );
  const match = (runs.workflow_runs ?? []).find((candidate) => {
    if (tag) {
      return candidate.head_branch === tag;
    }
    return candidate.head_branch === branch;
  });

  if (!match) {
    fail(`No qivryn-ide-installers run found for ${tag ?? branch}.`);
  }

  return match;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "qivryn-github-builds-skill",
    },
  });

  if (!response.ok) {
    fail(`${response.status} ${response.statusText}: ${url}`);
  }

  return response.json();
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }
    parsed[arg.slice(2)] = argv[i + 1];
    i += 1;
  }
  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
