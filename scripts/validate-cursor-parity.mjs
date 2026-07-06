import fs from "node:fs";

const ledgerPath = new URL(
  "../docs/reference/cursor-parity-ledger.json",
  import.meta.url,
);
const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
const errors = [];
const ids = new Set();
const allowedSurfaces = new Set(["editor", "vscode", "jetbrains", "cli"]);
const excludedCapabilities = new Set(ledger.target?.excludedCapabilities ?? []);
const acceptanceStatuses = new Set(ledger.acceptanceStatuses ?? []);

for (const feature of ledger.features ?? []) {
  if (!feature.id || ids.has(feature.id)) {
    errors.push(
      `Duplicate or missing feature ID: ${feature.id ?? "<missing>"}`,
    );
  }
  ids.add(feature.id);
  if (!ledger.statuses.includes(feature.status)) {
    errors.push(`${feature.id}: unsupported status ${feature.status}`);
  }
  if (!acceptanceStatuses.has(feature.acceptanceStatus)) {
    errors.push(
      `${feature.id}: unsupported acceptanceStatus ${feature.acceptanceStatus}`,
    );
  }
  if (feature.acceptanceStatus === "passed") {
    if (!Array.isArray(feature.evidence) || feature.evidence.length === 0) {
      errors.push(`${feature.id}: passed acceptance requires evidence`);
    }
  }
  if (
    feature.acceptanceStatus === "blocked" &&
    !feature.acceptanceBlocker?.trim()
  ) {
    errors.push(`${feature.id}: blocked acceptance requires acceptanceBlocker`);
  }
  if (feature.status === "excluded") {
    if (!feature.excludedCapability?.trim()) {
      errors.push(
        `${feature.id}: excluded features must name an excludedCapability`,
      );
    } else if (!excludedCapabilities.has(feature.excludedCapability)) {
      errors.push(
        `${feature.id}: ${feature.excludedCapability} is not excluded by the target`,
      );
    }
  } else if (feature.excludedCapability) {
    errors.push(
      `${feature.id}: excludedCapability is only valid for excluded features`,
    );
  }
  if (!ledger.dispositions.includes(feature.disposition)) {
    errors.push(
      `${feature.id}: unsupported disposition ${feature.disposition}`,
    );
  }
  if (
    !Number.isInteger(feature.phase) ||
    feature.phase < 1 ||
    feature.phase > 8
  ) {
    errors.push(`${feature.id}: phase must be an integer from 1 through 8`);
  }
  if (!feature.cursorEvidence?.trim() || !feature.qivrynBaseline?.trim()) {
    errors.push(`${feature.id}: reference and Qivryn baseline are required`);
  }
  if (!feature.acceptance?.trim()) {
    errors.push(
      `${feature.id}: an observable acceptance criterion is required`,
    );
  }
  if (!Array.isArray(feature.surfaces) || feature.surfaces.length === 0) {
    errors.push(`${feature.id}: at least one surface is required`);
  } else {
    for (const surface of feature.surfaces) {
      if (!allowedSurfaces.has(surface)) {
        errors.push(`${feature.id}: unsupported surface ${surface}`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  const implementation = Object.fromEntries(
    ledger.statuses.map((status) => [
      status,
      ledger.features.filter((feature) => feature.status === status).length,
    ]),
  );
  const acceptance = Object.fromEntries(
    [...acceptanceStatuses].map((status) => [
      status,
      ledger.features.filter((feature) => feature.acceptanceStatus === status)
        .length,
    ]),
  );
  console.log(`Cursor parity ledger: ${ledger.features.length} features`);
  console.log(JSON.stringify({ implementation, acceptance }, null, 2));
}
