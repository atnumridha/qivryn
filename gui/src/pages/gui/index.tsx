import {
  ArrowsPointingOutIcon,
  ArrowPathIcon,
  Cog6ToothIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { useContext } from "react";
import { useNavigate } from "react-router-dom";
import { History } from "../../components/History";
import { ToolTip } from "../../components/gui/Tooltip";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { newSession } from "../../redux/slices/sessionSlice";
import { exitEdit } from "../../redux/thunks/edit";
import { saveCurrentSession } from "../../redux/thunks/session";
import { CONFIG_ROUTES } from "../../util/navigation";
import { Chat } from "./Chat";
import "../agents/agents.css";

const headerIconButtonClass =
  "text-description hover:bg-list-hover hover:text-foreground focus-visible:ring-border-focus relative z-20 flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent p-0 outline-none transition-colors duration-150 focus-visible:ring-1";

export default function GUI() {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const navigate = useNavigate();
  const title = useAppSelector((state) => state.session.title);
  const hasHistory = useAppSelector(
    (state) => state.session.history.length > 0,
  );
  const isInEdit = useAppSelector((state) => state.session.isInEdit);
  const isStandaloneWindow = Boolean((window as any).isFullScreen);

  const startNewChat = async () => {
    if (isInEdit) {
      await dispatch(exitEdit({ openNewSession: true })).unwrap();
      return;
    }
    if (hasHistory) {
      await dispatch(
        saveCurrentSession({
          openNewSession: true,
          generateTitle: true,
        }),
      ).unwrap();
      return;
    }
    dispatch(newSession());
  };

  return (
    <div className="qivryn-agents-cursor flex h-full min-h-0 w-full flex-row overflow-x-hidden">
      {!isStandaloneWindow && (
        <aside className="no-scrollbar hidden min-h-0 w-[256px] flex-shrink-0 overflow-y-auto border-0 border-r border-solid min-[900px]:flex">
          <History />
        </aside>
      )}
      <main className="cursor-agents-main no-scrollbar relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">
        <header
          data-testid="qivryn-chat-header"
          className="cursor-agents-toolbar relative z-[120] flex flex-shrink-0 items-center gap-2 overflow-visible border-b px-2"
        >
          <div className="text-description min-w-0 flex-1 truncate px-1 text-xs">
            {title}
          </div>
          <ToolTip place="top" content="Settings">
            <button
              type="button"
              aria-label="Open settings"
              title="Settings"
              onClick={() => navigate(CONFIG_ROUTES.SETTINGS)}
              className={headerIconButtonClass}
            >
              <Cog6ToothIcon className="h-3.5 w-3.5" />
            </button>
          </ToolTip>
          <ToolTip place="top" content="New chat">
            <button
              type="button"
              aria-label="New chat"
              title="New chat"
              onClick={() => void startNewChat()}
              className={headerIconButtonClass}
            >
              <PlusIcon className="h-3.5 w-3.5" />
            </button>
          </ToolTip>
          {!isStandaloneWindow && (
            <ToolTip place="top" content="Open full screen">
              <button
                type="button"
                aria-label="Open full screen"
                title="Open full screen"
                onClick={() =>
                  void ideMessenger.request("toggleFullScreen", {
                    newWindow: true,
                    path: "/",
                  })
                }
                className={headerIconButtonClass}
              >
                <ArrowsPointingOutIcon className="h-3.5 w-3.5" />
              </button>
            </ToolTip>
          )}
          <ToolTip place="top" content="Reload">
            <button
              type="button"
              aria-label="Reload chat"
              title="Reload"
              onClick={() =>
                ideMessenger.post("reloadAgentWindow", { path: "/" } as any)
              }
              className={headerIconButtonClass}
            >
              <ArrowPathIcon className="h-3.5 w-3.5" />
            </button>
          </ToolTip>
        </header>
        <div className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col">
          <Chat />
        </div>
      </main>
    </div>
  );
}
