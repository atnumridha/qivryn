import { SlashCommandDescWithSource } from "core";

interface ConversationStarterCardProps {
  command: SlashCommandDescWithSource;
  onClick: (command: SlashCommandDescWithSource) => void;
}

function PromptFileIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M5.4 2.9h6.3l2.9 2.9v11.3H5.4z"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.7 2.9v2.9h2.9M7.7 8.4h4.6M7.7 11h3.4M7.7 13.6h4.1"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ConversationStarterCard({
  command,
  onClick,
}: ConversationStarterCardProps) {
  return (
    <button
      type="button"
      className="qivryn-saved-starter-row w-full text-left"
      onClick={() => onClick(command)}
    >
      <div className="flex min-w-0 items-start gap-2.5 px-3 py-2">
        <div className="qivryn-saved-starter-icon flex-shrink-0 self-start">
          <PromptFileIcon />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <div className="truncate text-xs font-medium">{command.name}</div>
          {command.description && (
            <div className="text-description-muted line-clamp-2 text-[11px] leading-snug">
              {command.description}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
