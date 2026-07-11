import { MessageModes } from "core";
import type { SVGProps } from "react";

interface ModeIconProps {
  mode: MessageModes;
  className?: string;
}

function QivrynPulseModeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 20 20" fill="none">
      <path
        d="M2.5 10.8h3.4L7.4 5l3.3 10 1.8-5.5h5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CodeChatModeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M4.2 4.3h11.6v8.5H8.1l-3.9 2.8V4.3Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m7.2 8.1-1.4 1.4 1.4 1.4M12.8 8.1l1.4 1.4-1.4 1.4M9 11.1l2-3.2"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlanModeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M4.2 4h11.6v12H4.2zM7 7h6M7 10h4.5M7 13h3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.2 7h11.6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DebugModeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M6.2 8.1h7.6v5.1a3.8 3.8 0 0 1-7.6 0V8.1Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.4 5.1 9 6.8m3.6-1.7L11 6.8M4.2 10.1h2M13.8 10.1h2M4.2 13.2h2M13.8 13.2h2M8.2 11.2h3.6"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BackgroundModeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 3.4v3.4M10 13.2v3.4M3.4 10h3.4M13.2 10h3.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M7.2 7.2h5.6v5.6H7.2z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ModeIcon({ mode, className = "h-4 w-4" }: ModeIconProps) {
  switch (mode) {
    case "agent":
      return <QivrynPulseModeIcon className={className} />;
    case "plan":
      return <PlanModeIcon className={className} />;
    case "debug":
      return <DebugModeIcon className={className} />;
    case "chat":
      return <CodeChatModeIcon className={className} />;
    case "background":
      return <BackgroundModeIcon className={className} />;
  }
}
