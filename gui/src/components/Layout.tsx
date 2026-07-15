import { OnboardingModes } from "core/protocol/core";
import {
  ClipboardDocumentCheckIcon,
  ClockIcon,
  Cog6ToothIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { useContext, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { CustomScrollbarDiv } from ".";
import { AuthProvider } from "../context/Auth";
import { IdeMessengerContext } from "../context/IdeMessenger";
import { LocalStorageProvider } from "../context/LocalStorage";
import { useWebviewListener } from "../hooks/useWebviewListener";
import { useAppDispatch, useAppSelector } from "../redux/hooks";
import { setCodeToEdit } from "../redux/slices/editState";
import { newSession } from "../redux/slices/sessionSlice";
import { setShowDialog } from "../redux/slices/uiSlice";
import { enterEdit, exitEdit } from "../redux/thunks/edit";
import { saveCurrentSession } from "../redux/thunks/session";
import { fontSize, isMetaEquivalentKeyPressed } from "../util";
import { isQivrynStandalone } from "../util/isQivrynStandalone";
import { ROUTES } from "../util/navigation";
import { FatalErrorIndicator } from "./config/FatalErrorNotice";
import TextDialog from "./dialogs";
import { useMainEditor } from "./mainInput/TipTapEditor";
import { useOnboardingCard } from "./OnboardingCard";
import OSRContextMenu from "./OSRContextMenu";

const LayoutTopDiv = styled(CustomScrollbarDiv)`
  height: 100%;
  position: relative;
  overflow-x: hidden;
`;

const GridDiv = styled.div`
  display: grid;
  grid-template-rows: 1fr auto;
  height: 100vh;
  width: 100%;
  min-width: 0;
  overflow-x: hidden;
`;

function StandaloneRouteMenu() {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);

  const openRoute = (path: string) =>
    ideMessenger.post("reloadAgentWindow", { path });

  return (
    <nav className="qivryn-standalone-menu" aria-label="Qivryn menu">
      <span className="qivryn-standalone-menu-title">Qivryn</span>
      <div className="qivryn-standalone-menu-actions">
        <button
          type="button"
          aria-label="New chat"
          title="New chat"
          onClick={() => {
            dispatch(newSession());
            openRoute(ROUTES.HOME);
          }}
        >
          <PlusIcon aria-hidden="true" />
          <span>New</span>
        </button>
        <button
          type="button"
          aria-label="View history"
          title="View history"
          onClick={() => openRoute("/history")}
        >
          <ClockIcon aria-hidden="true" />
          <span>History</span>
        </button>
        <button
          type="button"
          aria-label="Open review"
          title="Open review"
          onClick={() => openRoute(ROUTES.REVIEW)}
        >
          <ClipboardDocumentCheckIcon aria-hidden="true" />
          <span>Review</span>
        </button>
        <button
          type="button"
          aria-label="Open settings"
          title="Open settings"
          onClick={() => openRoute(ROUTES.CONFIG)}
        >
          <Cog6ToothIcon aria-hidden="true" />
          <span>Settings</span>
        </button>
      </div>
    </nav>
  );
}

const Layout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const onboardingCard = useOnboardingCard();
  const ideMessenger = useContext(IdeMessengerContext);

  const { mainEditor } = useMainEditor();
  const dialogMessage = useAppSelector((state) => state.ui.dialogMessage);

  const showDialog = useAppSelector((state) => state.ui.showDialog);
  const isInEdit = useAppSelector((store) => store.session.isInEdit);
  const isHome =
    location.pathname === ROUTES.HOME ||
    location.pathname === ROUTES.HOME_INDEX;
  const [isStandaloneSurface, setIsStandaloneSurface] =
    useState(isQivrynStandalone);

  useEffect(() => {
    const updateSurface = () => setIsStandaloneSurface(isQivrynStandalone());
    window.addEventListener("resize", updateSurface);
    return () => window.removeEventListener("resize", updateSurface);
  }, []);

  useWebviewListener(
    "newSession",
    async () => {
      navigate(ROUTES.HOME);
      if (isInEdit) {
        await dispatch(exitEdit({}));
      } else {
        await dispatch(
          saveCurrentSession({
            openNewSession: true,
            generateTitle: true,
          }),
        );
      }
    },
    [isInEdit],
  );

  useWebviewListener(
    "isQivrynInputFocused",
    async () => {
      return false;
    },
    [isHome],
    isHome,
  );

  useWebviewListener(
    "focusQivrynInputWithNewSession",
    async () => {
      navigate(ROUTES.HOME);
      if (isInEdit) {
        await dispatch(
          exitEdit({
            openNewSession: true,
          }),
        );
      } else {
        await dispatch(
          saveCurrentSession({
            openNewSession: true,
            generateTitle: true,
          }),
        );
      }
    },
    [isHome, isInEdit],
    isHome,
  );

  useWebviewListener(
    "addModel",
    async () => {
      navigate("/models");
    },
    [navigate],
  );

  useWebviewListener(
    "navigateTo",
    async (data) => {
      if (data.toggle && location.pathname === data.path) {
        navigate("/");
      } else {
        navigate(data.path);
      }
    },
    [location, navigate],
  );

  useWebviewListener(
    "setupLocalConfig",
    async () => {
      onboardingCard.open(OnboardingModes.LOCAL);
    },
    [],
  );

  useWebviewListener(
    "setupApiKey",
    async () => {
      onboardingCard.open(OnboardingModes.API_KEY);
    },
    [],
  );

  useWebviewListener(
    "focusEdit",
    async () => {
      await ideMessenger.request("edit/addCurrentSelection", undefined);
      await dispatch(enterEdit({ editorContent: mainEditor?.getJSON() }));
      mainEditor?.commands.focus();
    },
    [ideMessenger, mainEditor],
  );

  useWebviewListener(
    "setCodeToEdit",
    async (payload) => {
      dispatch(
        setCodeToEdit({
          codeToEdit: payload,
        }),
      );
    },
    [],
  );

  useWebviewListener(
    "exitEditMode",
    async () => {
      await dispatch(exitEdit({}));
    },
    [],
  );

  useEffect(() => {
    const handleKeyDown = (event: any) => {
      if (isMetaEquivalentKeyPressed(event) && event.code === "KeyC") {
        const selection = window.getSelection()?.toString();
        if (selection) {
          setTimeout(() => {
            void navigator.clipboard.writeText(selection);
          }, 100);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <LocalStorageProvider>
      <AuthProvider>
        <LayoutTopDiv
          className={
            isStandaloneSurface ? "qivryn-standalone-surface" : undefined
          }
        >
          <OSRContextMenu />
          {isStandaloneSurface && !isHome && <StandaloneRouteMenu />}
          <div
            className="qivryn-layout-content"
            style={{
              scrollbarGutter: "stable both-edges",
              minHeight: "100%",
              display: "grid",
              gridTemplateRows: "1fr auto",
            }}
          >
            <TextDialog
              showDialog={showDialog}
              onEnter={() => {
                dispatch(setShowDialog(false));
              }}
              onClose={() => {
                dispatch(setShowDialog(false));
              }}
              message={dialogMessage}
            />

            <GridDiv>
              <Outlet />
              {/* The fatal error for chat is shown below input */}
              {!isHome && <FatalErrorIndicator />}
            </GridDiv>
          </div>
          <div style={{ fontSize: fontSize(-4) }} id="tooltip-portal-div" />
        </LayoutTopDiv>
      </AuthProvider>
    </LocalStorageProvider>
  );
};

export default Layout;
