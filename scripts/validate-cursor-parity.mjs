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
  if (!feature.cursorEvidence?.trim() || !feature.continueBaseline?.trim()) {
    errors.push(`${feature.id}: reference and Continue baseline are required`);
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
  const counts = Object.fromEntries(
    ledger.statuses.map((status) => [
      status,
      ledger.features.filter((feature) => feature.status === status).length,
    ]),
  );
  console.log(`Cursor parity ledger: ${ledger.features.length} features`);
  console.log(JSON.stringify(counts, null, 2));
}
