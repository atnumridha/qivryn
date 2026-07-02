import { LumpToolbar } from "./LumpToolbar/LumpToolbar";

/**
 * Simplified toolbar component that only shows the toolbar without expansion
 */
export function Lump() {
  return (
    <div className="bg-input rounded-t-default border-command-border mx-1.5 min-w-0 max-w-full overflow-hidden border-l border-r border-t">
      <div className="xs:px-2 min-w-0 max-w-full px-1 py-0.5">
        <LumpToolbar />
      </div>
    </div>
  );
}
