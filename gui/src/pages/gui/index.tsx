import { History } from "../../components/History";
import { Chat } from "./Chat";
import "../agents/agents.css";

export default function GUI() {
  const isStandaloneWindow = Boolean((window as any).isFullScreen);

  return (
    <div className="qivryn-agents-cursor flex h-full min-h-0 w-full flex-row overflow-x-hidden">
      {!isStandaloneWindow && (
        <aside className="no-scrollbar hidden min-h-0 w-[256px] flex-shrink-0 overflow-y-auto border-0 border-r border-solid min-[900px]:flex">
          <History />
        </aside>
      )}
      <main className="cursor-agents-main no-scrollbar relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">
        <div className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col">
          <Chat />
        </div>
      </main>
    </div>
  );
}
