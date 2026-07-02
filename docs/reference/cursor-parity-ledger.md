# Cursor parity ledger

`cursor-parity-ledger.json` tracks the implementation status of the Qivryn Hybrid Agent IDE against the authorized CursorApp 3.9.16 reference build.

The detailed implementation limits and current priority order are recorded in [CodieApp parity audit](./codie-qivryn-gap-audit.md). Do not infer parity from the presence of a component or type alone.

Run the validator before changing a feature status:

```bash
npm run validate:cursor-parity
```

The validator checks unique IDs, allowed states, required acceptance criteria, delivery phases, and supported surfaces. Expected output includes the total feature count and a summary grouped by status.

## Statuses

- `existing`: Qivryn already provides the required behavior.
- `implemented`: The hybrid-specific implementation is complete.
- `partial`: Useful implementation exists, but the acceptance criterion is not yet satisfied.
- `planned`: No production implementation satisfies the acceptance criterion.
- `excluded`: The capability is intentionally outside the target and names a matching entry from `target.excludedCapabilities`; it does not count as a parity gap.

## Dispositions

- `retain`: Keep the existing Qivryn implementation because it meets or exceeds the reference.
- `implement`: Add a missing capability.
- `hybrid`: Combine Qivryn and Cursor behavior into one implementation.
- `local-equivalent`: Replace a hosted or proprietary dependency with a local or provider-neutral implementation.

Excluded entries must set `excludedCapability` to a value listed in `target.excludedCapabilities`. Feature entries must describe observable behavior. A feature cannot move to `implemented` until its acceptance criterion has an automated test or an explicitly recorded manual cross-platform check.
