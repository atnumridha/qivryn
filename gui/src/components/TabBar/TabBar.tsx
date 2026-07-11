import { XMarkIcon } from "@heroicons/react/24/outline";
import React, { useCallback, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import styled from "styled-components";
import { defaultBorderRadius } from "..";
import { SessionRunningIndicator } from "../SessionRunningIndicator";
import { selectRunningSessionIdsValue } from "../../redux/selectors/selectRunningSessions";
import { newSession } from "../../redux/slices/sessionSlice";
import {
  addTab,
  handleSessionChange,
  removeTab,
  setActiveTab,
  setTabs,
} from "../../redux/slices/tabsSlice";
import { AppDispatch, RootState } from "../../redux/store";
import { loadSession, saveCurrentSession } from "../../redux/thunks/session";
import { varWithFallback } from "../../styles/theme";

// Haven't set up theme colors for tabs yet
// Will keep it simple and choose from existing ones. Comments show vars we could use
const tabBorderVar = varWithFallback("border"); // --vscode-tab-border
const tabBackgroundVar = varWithFallback("background"); // --vscode-tab-inactiveBackground
const tabForegroundVar = varWithFallback("foreground"); // --vscode-tab-inactiveForeground
const tabHoverBackgroundVar = varWithFallback("list-hover"); // --vscode-tab-hoverBackground
const tabHoverForegroundVar = varWithFallback("foreground"); // --vscode-tab-hoverForeground
const tabSelectedBackgroundVar = varWithFallback("background"); // --vscode-tab-activeBackground
const tabSelectedForegroundVar = varWithFallback("foreground"); // --vscode-tab-activeForeground
const tabAccentVar = varWithFallback("accent"); // --vscode-tab-activeBorderTop

const TabBarContainer = styled.div`
  display: flex;
  flex-shrink: 0;
  flex-grow: 0;
  align-items: flex-end;
  background-color: ${tabBackgroundVar};
  border-bottom: 1px solid ${tabBorderVar};
  position: relative;
  min-height: 33px;
  margin-top: 0;
  padding: 3px 6px 0;
  overflow-x: auto;
  overflow-y: hidden;
  gap: 3px;
  scrollbar-width: thin;

  &::-webkit-scrollbar {
    height: 6px;
  }

  &::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, ${tabForegroundVar} 24%, transparent);
    border-radius: 999px;
  }
`;

const Tab = styled.div<{ isActive: boolean }>`
  display: flex;
  align-items: center;
  box-sizing: border-box;
  flex: 0 0 auto;
  width: clamp(112px, 34vw, 176px);
  min-width: 0;
  height: 29px;
  padding: 0 5px 0 10px;
  background: ${(props) =>
    props.isActive
      ? tabSelectedBackgroundVar
      : `color-mix(in srgb, ${tabBackgroundVar} 92%, ${tabForegroundVar})`};
  color: ${(props) =>
    props.isActive ? tabSelectedForegroundVar : tabForegroundVar};
  cursor: pointer;
  border: 1px solid ${(props) => (props.isActive ? tabAccentVar : tabBorderVar)};
  border-bottom-color: ${(props) =>
    props.isActive ? tabSelectedBackgroundVar : tabBorderVar};
  border-radius: 6px 6px 0 0;
  user-select: none;
  position: relative;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;

  &:hover {
    background-color: ${(props) =>
      props.isActive ? tabSelectedBackgroundVar : tabHoverBackgroundVar};
    color: ${(props) =>
      props.isActive ? tabSelectedForegroundVar : tabHoverForegroundVar};
  }

  &:focus-visible {
    outline: 2px solid ${tabAccentVar};
    outline-offset: -2px;
  }
`;

const TabTitle = styled.span`
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  line-height: 1;
  text-align: left;
`;

const RunningIndicator = styled(SessionRunningIndicator)`
  flex: 0 0 auto;
  width: 13px;
  height: 13px;
  margin-right: 6px;
  color: ${tabAccentVar};
`;

const CloseButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: 4px;
  border: none;
  background: transparent;
  color: inherit;
  opacity: 0.7;
  cursor: pointer;
  border-radius: ${defaultBorderRadius};
  padding: 2px;
  visibility: hidden;

  &:hover {
    opacity: 1;
    background-color: ${tabHoverBackgroundVar};
  }

  &:focus-visible {
    visibility: visible;
    outline: 2px solid ${tabAccentVar};
    outline-offset: -2px;
  }

  ${Tab}:hover & {
    visibility: visible;
  }

  &[disabled] {
    display: none !important;
  }
`;

const TabBarSpace = styled.div`
  flex: 0 0 6px;
  display: flex;
  align-self: stretch;
`;

export const TabBar = React.forwardRef<HTMLDivElement>((_, ref) => {
  const dispatch = useDispatch<AppDispatch>();
  const currentSessionId = useSelector((state: RootState) => state.session.id);
  const currentSessionTitle = useSelector(
    (state: RootState) => state.session.title,
  );
  const hasHistory = useSelector(
    (state: RootState) => state.session.history.length > 0,
  );
  const tabs = useSelector((state: RootState) => state.tabs.tabs);
  const runningSessionIdsValue = useSelector(selectRunningSessionIdsValue);
  const runningSessionIds = new Set(
    runningSessionIdsValue ? runningSessionIdsValue.split("\u0000") : [],
  );

  // Simple UUID generator for our needs
  const generateId = useCallback(() => {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }, []);

  useEffect(() => {
    if (!currentSessionId) return;

    dispatch(
      handleSessionChange({
        currentSessionId,
        currentSessionTitle,
        newTabId: generateId(), // Pass the ID generator result
      }),
    );
  }, [currentSessionId, currentSessionTitle]);

  const handleNewTab = async () => {
    // Save current session before creating new one
    if (hasHistory) {
      await dispatch(
        saveCurrentSession({ openNewSession: false, generateTitle: true }),
      );
    }

    dispatch(newSession());

    dispatch(
      addTab({
        id: generateId(),
        title: `Chat ${tabs.length + 1}`,
        isActive: true,
        sessionId: undefined,
      }),
    );
  };

  useEffect(() => {
    if (!tabs.length) {
      handleNewTab();
    }
  }, [tabs.map((t) => t.id).join(",")]);

  const handleTabClick = async (id: string) => {
    const targetTab = tabs.find((tab) => tab.id === id);
    if (!targetTab) return;
    if (targetTab.isActive) return;

    if (targetTab.sessionId) {
      // Switch to existing session
      await dispatch(
        loadSession({
          sessionId: targetTab.sessionId,
          saveCurrentSession: hasHistory,
        }),
      );
    }

    dispatch(setActiveTab(id));
  };

  const handleTabClose = async (id: string) => {
    //if (tabs.length <= 1) return;

    const isClosingActive = tabs.find((t) => t.id === id)?.isActive;
    const filtered = tabs.filter((t) => t.id !== id);

    if (isClosingActive) {
      const lastTab = filtered[filtered.length - 1];
      if (filtered.length) {
        await handleTabClick(lastTab.id);
        dispatch(
          setTabs(
            filtered.map((tab, i) => ({
              ...tab,
              isActive: i === filtered.length - 1,
            })),
          ),
        );
      } else {
        dispatch(setTabs([]));
        dispatch(newSession());
      }
    } else {
      dispatch(removeTab(id));
    }
  };

  return (
    <TabBarContainer
      ref={ref}
      className="qivryn-session-tabs"
      role="tablist"
      aria-label="Open Qivryn sessions"
      style={{
        display: tabs.length === 1 ? "none" : "flex",
      }}
    >
      {tabs.map((tab) => {
        const isRunning = Boolean(
          tab.sessionId && runningSessionIds.has(tab.sessionId),
        );

        return (
          <Tab
            key={tab.id}
            role="tab"
            isActive={tab.isActive}
            aria-selected={tab.isActive}
            aria-label={`${tab.title}${isRunning ? ", running" : ""}`}
            tabIndex={0}
            onClick={() => handleTabClick(tab.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleTabClick(tab.id);
              }
            }}
            onAuxClick={(e) => {
              // Middle mouse button
              if (e.button === 1) {
                e.preventDefault();
                handleTabClose(tab.id);
              }
            }}
          >
            {isRunning && <RunningIndicator aria-hidden="true" />}
            <TabTitle>{tab.title}</TabTitle>
            <CloseButton
              type="button"
              aria-label={`Close ${tab.title}`}
              /* disabled={tabs.length === 1} */
              onClick={(e) => {
                e.stopPropagation();
                handleTabClose(tab.id);
              }}
            >
              <XMarkIcon width={12} height={12} />
            </CloseButton>
          </Tab>
        );
      })}
      <TabBarSpace>
        {/* <NewTabButton onClick={handleNewTab}>
          <PlusIcon width={16} height={16} />
        </NewTabButton> */}
      </TabBarSpace>
    </TabBarContainer>
  );
});
