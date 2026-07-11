import { ArrowPathIcon } from "@heroicons/react/24/outline";

export function SessionRunningIndicator({
  className = "",
}: {
  className?: string;
}) {
  return (
    <span
      className={`qivryn-session-running-indicator ${className}`.trim()}
      aria-hidden="true"
    >
      <ArrowPathIcon />
    </span>
  );
}
