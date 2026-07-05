import {
  ArrowDownIcon,
  ArrowUpIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ToolTip } from "../gui/Tooltip";
import {
  Rectangle,
  SearchMatch,
  searchWithinContainer,
} from "./findWidgetSearch";
import { useDebounceValue } from "./useDebounce";
import { useElementSize } from "./useElementSize";

interface HighlightOverlayProps {
  rectangle: Rectangle;
  isCurrent: boolean;
}

const HighlightOverlay = (props: HighlightOverlayProps) => {
  const { top, left, width, height } = props.rectangle;
  return (
    <div
      className={props.isCurrent ? "bg-findMatch-selected" : "bg-findMatch"}
      key={`highlight-${top}-${left}`}
      style={{
        position: "absolute",
        top,
        left,
        width,
        height,
        pointerEvents: "none", // To click through the overlay
        zIndex: 10,
      }}
    />
  );
};

type ScrollToMatchOption = "closest" | "first" | "none";

/*
    useFindWidget takes a container ref and returns
    1. A widget that can be placed anywhere to search the contents of that container
    2. Search results and state
    3. Highlight components to be overlayed over the container

    Container must have relative positioning
*/
export const useFindWidget = (
  searchRef: RefObject<HTMLDivElement>,
  headerRef: RefObject<HTMLDivElement>,
  disabled: boolean,
) => {
  // Search input, debounced
  const inputRef = useRef<HTMLInputElement>(null);
  const [currentValue, setCurrentValue] = useState<string>("");
  const searchTerm = useDebounceValue(currentValue, 300);

  // Widget open/closed state
  const [open, setOpen] = useState<boolean>(false);
  const openWidget = useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [inputRef]);

  // Search settings and results
  const [caseSensitive, setCaseSensitive] = useState<boolean>(false);
  const [useRegex, setUseRegex] = useState<boolean>(false);

  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [currentMatch, setCurrentMatch] = useState<SearchMatch | undefined>(
    undefined,
  );

  // Navigating between search results
  // The "current" search result is highlighted a different color
  const scrollToMatch = useCallback(
    (match: SearchMatch) => {
      setCurrentMatch(match);
      searchRef?.current?.scrollTo({
        top: match.overlayRectangle.top - searchRef.current.clientHeight / 2,
        left: match.overlayRectangle.left - searchRef.current.clientWidth / 2,
        behavior: "smooth",
      });
    },
    [searchRef],
  );

  const nextMatch = useCallback(() => {
    if (!currentMatch || matches.length === 0) return;
    const newIndex = (currentMatch.index + 1) % matches.length;
    const newMatch = matches[newIndex];
    scrollToMatch(newMatch);
  }, [scrollToMatch, currentMatch, matches]);

  const previousMatch = useCallback(() => {
    if (!currentMatch || matches.length === 0) return;
    const newIndex =
      currentMatch.index === 0 ? matches.length - 1 : currentMatch.index - 1;
    const newMatch = matches[newIndex];
    scrollToMatch(newMatch);
  }, [scrollToMatch, currentMatch, matches]);

  // Handle keyboard shortcuts for navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === "f" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        openWidget();
      } else if (document.activeElement === inputRef.current) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        } else if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          if (event.shiftKey) previousMatch();
          else nextMatch();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [inputRef, matches, nextMatch]);

  // Handle container resize changes - highlight positions must adjust
  const { clientHeight: headerHeight, isResizing: headerResizing } =
    useElementSize(headerRef);
  const { isResizing: containerResizing } = useElementSize(searchRef);
  const isResizing = useMemo(() => {
    return containerResizing || headerResizing;
  }, [containerResizing, headerResizing]);

  // Main function for finding matches and generating highlight overlays
  const refreshSearch = useCallback(
    (scrollTo: ScrollToMatchOption = "none") => {
      const { results, closestToMiddle } = searchWithinContainer(
        searchRef,
        searchTerm,
        {
          caseSensitive,
          useRegex,
          offsetHeight: headerHeight,
        },
      );
      setMatches(results);
      // Find match closest to the middle of the view
      if (searchTerm.length > 1 && results.length) {
        if (scrollTo === "first") {
          scrollToMatch(results[0]);
        }
        if (scrollTo === "closest") {
          if (closestToMiddle) {
            scrollToMatch(closestToMiddle);
          }
        }
        if (scrollTo === "none") {
          if (closestToMiddle) {
            setCurrentMatch(closestToMiddle);
          } else {
            setCurrentMatch(results[0]);
          }
        }
      }
    },
    [
      searchTerm,
      caseSensitive,
      useRegex,
      searchRef,
      headerHeight,
      scrollToMatch,
    ],
  );

  // Triggers that should cause immediate refresh of results to closest search value:
  useEffect(() => {
    if (disabled || isResizing || !open) {
      setMatches([]);
    } else {
      refreshSearch("closest");
    }
  }, [refreshSearch, open, disabled, isResizing]);

  // Clicks in search div can cause content changes that for some reason don't trigger resize
  // Refresh clicking within container
  useEffect(() => {
    const searchContainer = searchRef.current;
    if (!open || !searchContainer) return;
    const handleSearchRefClick = () => {
      setTimeout(() => {
        refreshSearch("none");
      }, 150);
    };
    searchContainer.addEventListener("click", handleSearchRefClick);
    return () => {
      searchContainer.removeEventListener("click", handleSearchRefClick);
    };
  }, [searchRef, refreshSearch, open]);

  const resultText =
    matches.length === 0
      ? "No results"
      : `${(currentMatch?.index ?? 0) + 1} of ${matches.length}`;

  const iconButtonClass =
    "hover:bg-list-hover focus-visible:ring-border-focus inline-flex h-8 w-8 flex-shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent bg-transparent text-description transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-description";

  // Find widget component
  const widget = open ? (
    <div
      role="search"
      aria-label="Find in chat"
      data-testid="qivryn-find-widget"
      className="find-widget-skip bg-vsc-input-background border-command-border text-foreground fixed right-3 top-3 z-[70] flex max-w-[calc(100vw-24px)] translate-y-0 items-center gap-1 rounded-xl border px-2 py-1.5 opacity-100 shadow-2xl backdrop-blur-sm transition-all duration-150 ease-out"
    >
      <label htmlFor="qivryn-find-input" className="sr-only">
        Find in chat
      </label>
      <input
        id="qivryn-find-input"
        disabled={disabled}
        type="text"
        ref={inputRef}
        value={currentValue}
        onChange={(e) => {
          setCurrentValue(e.target.value);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
        }}
        placeholder="Search..."
        className="bg-vsc-background border-command-border focus:bg-input focus:ring-border-focus text-foreground placeholder:text-description-muted h-8 w-[min(46vw,260px)] min-w-[168px] rounded-lg border px-2.5 text-sm outline-none transition-colors focus:ring-1 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <p
        role="status"
        aria-live="polite"
        className="text-description hidden min-w-[64px] whitespace-nowrap px-1 text-center text-xs sm:block"
      >
        {resultText}
      </p>
      <div className="hidden flex-row gap-0.5 sm:flex">
        <ToolTip place="bottom-end" content="Previous match">
          <button
            type="button"
            aria-label="Previous match"
            onClick={(e) => {
              e.stopPropagation();
              previousMatch();
            }}
            className={iconButtonClass}
            disabled={matches.length < 2 || disabled}
          >
            <ArrowUpIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </ToolTip>
        <ToolTip place="bottom-end" content="Next match">
          <button
            type="button"
            aria-label="Next match"
            onClick={(e) => {
              e.stopPropagation();
              nextMatch();
            }}
            className={iconButtonClass}
            disabled={matches.length < 2 || disabled}
          >
            <ArrowDownIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </ToolTip>
      </div>
      <ToolTip
        place="bottom-end"
        content={
          caseSensitive
            ? "Turn off case sensitivity"
            : "Turn on case sensitivity"
        }
      >
        <button
          type="button"
          disabled={disabled}
          aria-label={
            caseSensitive
              ? "Turn off case sensitivity"
              : "Turn on case sensitivity"
          }
          aria-pressed={caseSensitive}
          onClick={(e) => {
            e.stopPropagation();
            setCaseSensitive((curr) => !curr);
          }}
          className={`${iconButtonClass} w-9 text-[11px] font-medium ${
            caseSensitive
              ? "border-description bg-list-active text-list-active-foreground hover:bg-list-active hover:text-list-active-foreground"
              : ""
          }`}
        >
          Aa
        </button>
      </ToolTip>
      {/* TODO - add useRegex functionality */}
      <ToolTip place="bottom-end" content="Close search">
        <button
          type="button"
          aria-label="Close search"
          onClick={() => setOpen(false)}
          className={iconButtonClass}
        >
          <XMarkIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </ToolTip>
    </div>
  ) : null;

  // Generate the highlight overlay elements
  const highlights = useMemo(() => {
    return matches.map((match) => (
      <HighlightOverlay
        rectangle={match.overlayRectangle}
        isCurrent={currentMatch?.index === match.index}
      />
    ));
  }, [matches, currentMatch]);

  return {
    highlights,
    widget,
  };
};
