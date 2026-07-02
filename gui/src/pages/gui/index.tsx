import {
  ArrowLeftIcon,
  ArrowPathIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";
import { useContext } from "react";
import { useNavigate } from "react-router-dom";
import { History } from "../../components/History";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppSelector } from "../../redux/hooks";
import { ROUTES } from "../../util/navigation";
import { Chat } from "./Chat";
import "../agents/agents.css";

export default function GUI() {
  const navigate = useNavigate();
  const ideMessenger = useContext(IdeMessengerContext);
  const title = useAppSelector((state) => state.session.title);
  const isStandaloneWindow = Boolean((window as any).isFullScreen);

  return (
    <div className="qivryn-agents-cursor flex min-h-0 w-screen flex-row overflow-x-hidden">
      <aside className="cursor-agents-sidebar 4xl:flex no-scrollbar hidden min-h-0 w-96 overflow-y-auto border-0 border-r border-solid">
        <History />
      </aside>
      <main className="cursor-agents-main no-scrollbar flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">
        <header className="cursor-agents-toolbar flex flex-shrink-0 items-center gap-2 border-b px-2">
          <button
            type="button"
            aria-label="Back to Agents"
            data-testid="back-to-agents"
            onClick={() => navigate(ROUTES.AGENTS)}
            className="hover:bg-list-hover flex h-7 items-center gap-1.5 rounded-md border-none bg-transparent px-2 text-xs"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            <Squares2X2Icon className="h-3.5 w-3.5" />
            <span>Agents</span>
          </button>
          <div className="text-description min-w-0 flex-1 truncate text-xs">
            {title}
          </div>
          {isStandaloneWindow && (
            <button
              type="button"
              aria-label="Reload Agents window"
              title="Reload Agents window and release any active edit"
              onClick={() => ideMessenger.post("reloadAgentWindow", undefined)}
              className="hover:bg-list-hover focus-visible:ring-border-focus relative z-20 flex h-7 cursor-pointer items-center gap-1.5 rounded-md border-none bg-transparent px-2 text-xs outline-none focus-visible:ring-1"
            >
              <ArrowPathIcon className="h-3.5 w-3.5" />
              <span className="hidden min-[420px]:inline">Reload</span>
            </button>
          )}
        </header>
        <Chat />
      </main>
    </div>
  );
}
