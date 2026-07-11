import { Chat } from "./Chat";
import "../agents/agents.css";

export default function GUI() {
  const isStandaloneWindow =
    Boolean((window as any).isFullScreen) ||
    document.body.dataset.qivrynFullscreen === "true";

  return (
    <div
      className={`qivryn-agents-cursor qivryn-chat-route flex h-full min-h-0 w-full flex-row overflow-x-hidden ${isStandaloneWindow ? "qivryn-standalone" : "qivryn-sidebar"}`}
    >
      <main className="cursor-agents-main no-scrollbar relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">
        <div className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col">
          <Chat />
        </div>
      </main>
    </div>
  );
}
