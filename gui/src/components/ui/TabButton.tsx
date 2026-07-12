import { ToolTip } from "../gui/Tooltip";

interface TabButtonProps {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
  tabId?: string;
}

export function TabButton({
  label,
  icon,
  isActive,
  onClick,
  tabId,
}: TabButtonProps) {
  return (
    <ToolTip content={label} place="right" className="text-xs md:!hidden">
      <button
        type="button"
        aria-current={isActive ? "page" : undefined}
        className={`hover:bg-list-hover box-border flex h-8 w-full cursor-pointer items-center justify-center gap-2 rounded-md border-none text-left outline-none md:justify-start ${
          isActive
            ? "bg-vsc-input-background px-2"
            : "text-description bg-transparent px-2"
        }`}
        onClick={onClick}
        data-testid={tabId ? `tab-${tabId}` : undefined}
      >
        {icon}
        <span className="text-description hidden min-w-0 truncate md:inline">
          {label}
        </span>
      </button>
    </ToolTip>
  );
}
