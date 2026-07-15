import {
  ClipboardDocumentCheckIcon,
  ClockIcon,
  Cog6ToothIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMainEditor } from "../../components/mainInput/TipTapEditor";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch } from "../../redux/hooks";
import { newSession } from "../../redux/slices/sessionSlice";
import { isQivrynStandalone } from "../../util/isQivrynStandalone";
import { ROUTES } from "../../util/navigation";
import { Chat } from "./Chat";
import "../agents/agents.css";

// VS Code exposes a maximized auxiliary Qivryn view as a WebviewView rather
// than a WebviewPanel, so its `isFullScreen` marker remains false even though
// it has the full editor-width canvas. Treat that wide surface like the
// dedicated standalone panel; ordinary narrow sidebars keep their compact
// layout.
function WorkspaceDropTarget() {
  const { attachFiles } = useMainEditor();
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragDepthRef = useRef(0);

  const resetDragState = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
  }, []);

  useEffect(() => {
    const handleDragEnter = (event: DragEvent) => {
      event.preventDefault();
      dragDepthRef.current += 1;
      setIsDraggingFiles(true);
    };
    const handleDragOver = (event: DragEvent) => {
      // Chromium only dispatches `drop` when `dragover` is canceled. VS Code
      // can protect or normalize Explorer transfer metadata until the final
      // drop, so admission cannot depend on recognizing a file this early.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setIsDraggingFiles(true);
    };
    const handleDragLeave = () => {
      if (dragDepthRef.current === 0) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsDraggingFiles(false);
    };
    const handleDrop = (event: DragEvent) => {
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer) return;

      resetDragState();
      event.preventDefault();
      event.stopPropagation();
      void attachFiles(dataTransfer);
    };
    window.addEventListener("dragenter", handleDragEnter, true);
    window.addEventListener("dragover", handleDragOver, true);
    window.addEventListener("dragleave", handleDragLeave, true);
    window.addEventListener("drop", handleDrop, true);
    window.addEventListener("blur", resetDragState);
    return () => {
      window.removeEventListener("dragenter", handleDragEnter, true);
      window.removeEventListener("dragover", handleDragOver, true);
      window.removeEventListener("dragleave", handleDragLeave, true);
      window.removeEventListener("drop", handleDrop, true);
      window.removeEventListener("blur", resetDragState);
    };
  }, [attachFiles, resetDragState]);

  if (!isDraggingFiles) return null;
  return createPortal(
    <div
      className="qivryn-workspace-drop-overlay"
      data-testid="qivryn-workspace-drop-overlay"
      role="status"
      aria-live="polite"
    >
      <div className="qivryn-workspace-drop-card">
        <span>Drop files anywhere to add them to Qivryn</span>
        <small>They will be attached to your next message.</small>
      </div>
    </div>,
    document.body,
  );
}

function StandaloneMenu() {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);

  const openStandaloneRoute = (path: string) => {
    // Reload through the host so a maximized WebviewView is rebuilt as the
    // requested standalone route instead of falling back to the sidebar.
    ideMessenger.post("reloadAgentWindow", { path });
  };

  return (
    <nav className="qivryn-standalone-menu" aria-label="Qivryn menu">
      <span className="qivryn-standalone-menu-title">Qivryn</span>
      <div className="qivryn-standalone-menu-actions">
        <button
          type="button"
          title="New chat"
          aria-label="New chat"
          onClick={() => dispatch(newSession())}
        >
          <PlusIcon aria-hidden="true" />
          <span>New</span>
        </button>
        <button
          type="button"
          title="View history"
          aria-label="View history"
          onClick={() => openStandaloneRoute("/history")}
        >
          <ClockIcon aria-hidden="true" />
          <span>History</span>
        </button>
        <button
          type="button"
          title="Open review"
          aria-label="Open review"
          onClick={() => openStandaloneRoute(ROUTES.REVIEW)}
        >
          <ClipboardDocumentCheckIcon aria-hidden="true" />
          <span>Review</span>
        </button>
        <button
          type="button"
          title="Open settings"
          aria-label="Open settings"
          onClick={() => openStandaloneRoute(ROUTES.CONFIG)}
        >
          <Cog6ToothIcon aria-hidden="true" />
          <span>Settings</span>
        </button>
      </div>
    </nav>
  );
}

export default function GUI() {
  const [isStandaloneWindow, setIsStandaloneWindow] =
    useState(isQivrynStandalone);

  useEffect(() => {
    const updateLayout = () => setIsStandaloneWindow(isQivrynStandalone());
    window.addEventListener("resize", updateLayout);
    return () => window.removeEventListener("resize", updateLayout);
  }, []);

  return (
    <div
      className={`qivryn-agents-cursor qivryn-chat-route flex h-full min-h-0 w-full flex-row overflow-x-hidden ${isStandaloneWindow ? "qivryn-standalone" : "qivryn-sidebar"}`}
    >
      <main className="cursor-agents-main no-scrollbar relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">
        {isStandaloneWindow && <StandaloneMenu />}
        <div className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col">
          <Chat />
        </div>
      </main>
      <WorkspaceDropTarget />
    </div>
  );
}
