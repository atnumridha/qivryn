import { useContext } from "react";
import { IdeMessengerContext } from "../context/IdeMessenger";

export function RuntimeRecoveryActions({ onRetry }: { onRetry: () => void }) {
  const ideMessenger = useContext(IdeMessengerContext);
  const className =
    "cursor-pointer border-none bg-transparent p-0 text-xs underline";
  return (
    <div className="mt-2 flex flex-wrap gap-3">
      <button className={className} onClick={onRetry}>
        Retry
      </button>
      <button
        className={className}
        onClick={() => ideMessenger.post("reloadWindow", undefined)}
      >
        Reload window
      </button>
      <button
        className={className}
        onClick={() => ideMessenger.post("toggleDevTools", undefined)}
      >
        View logs
      </button>
    </div>
  );
}
