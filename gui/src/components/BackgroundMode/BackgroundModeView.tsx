import { AgentsList } from "./AgentsList";

interface BackgroundModeViewProps {
  isCreatingAgent?: boolean;
}

export function BackgroundModeView({
  isCreatingAgent = false,
}: BackgroundModeViewProps) {
  return (
    <div className="flex flex-col gap-2 py-2">
      <div className="text-description-muted px-3 text-[10px] font-medium uppercase">
        Background agents
      </div>
      <AgentsList isCreatingAgent={isCreatingAgent} />
    </div>
  );
}
