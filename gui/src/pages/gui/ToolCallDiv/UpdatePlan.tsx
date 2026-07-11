import { ToolCallState } from "core";
import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";
import { useMemo, useState } from "react";

type PlanStatus = "pending" | "in_progress" | "completed";

interface PlanItem {
  step: string;
  status: PlanStatus;
}

const STATUS_CLASS: Record<PlanStatus, string> = {
  pending: "text-description",
  in_progress: "text-foreground",
  completed: "text-description line-through decoration-description-muted",
};

function normalizePlan(rawPlan: unknown): PlanItem[] {
  if (!Array.isArray(rawPlan)) {
    return [];
  }

  return rawPlan
    .map((item) => {
      const step = typeof item?.step === "string" ? item.step.trim() : "";
      const status =
        item?.status === "completed" ||
        item?.status === "in_progress" ||
        item?.status === "pending"
          ? item.status
          : "pending";

      return { step, status };
    })
    .filter((item) => item.step);
}

function PlanIcon({ status }: { status: PlanStatus }) {
  return (
    <span
      className={`qivryn-plan-status qivryn-plan-status-${status}`}
      aria-hidden="true"
    />
  );
}

const COMPACT_PLAN_ITEMS = 3;

export function UpdatePlan({
  toolCallState,
}: {
  toolCallState: ToolCallState;
}) {
  const args = toolCallState.parsedArgs ?? {};
  const plan = normalizePlan(args.plan);
  const completed = plan.filter((item) => item.status === "completed").length;
  const explanation =
    typeof args.explanation === "string" ? args.explanation.trim() : "";
  const [expanded, setExpanded] = useState(false);

  const visiblePlan = useMemo(
    () => (expanded ? plan : plan.slice(0, COMPACT_PLAN_ITEMS)),
    [expanded, plan],
  );
  const hiddenCount = plan.length - visiblePlan.length;

  if (plan.length === 0) {
    return null;
  }

  return (
    <div className="qivryn-plan-card border-border bg-background mt-2 rounded-lg border px-3 py-2.5">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <div className="text-foreground truncate text-xs font-medium">Plan</div>
        <div className="text-description flex-shrink-0 text-[11px]">
          {completed}/{plan.length}
        </div>
      </div>

      {explanation && (
        <div className="text-description mb-2 text-xs leading-5">
          {explanation}
        </div>
      )}

      <ol className="m-0 space-y-1.5 p-0">
        {visiblePlan.map((item, index) => (
          <li className="flex min-w-0 items-start gap-2" key={index}>
            <PlanIcon status={item.status} />
            <span
              className={`min-w-0 flex-1 break-words text-xs leading-5 ${STATUS_CLASS[item.status]}`}
            >
              {item.step}
            </span>
          </li>
        ))}
      </ol>

      {hiddenCount > 0 && (
        <button
          type="button"
          className="qivryn-plan-expand mt-2"
          aria-label={`Show ${hiddenCount} more plan item${hiddenCount === 1 ? "" : "s"}`}
          aria-expanded={expanded}
          onClick={() => setExpanded(true)}
        >
          <ChevronDownIcon aria-hidden="true" className="h-3 w-3" />
          <span aria-hidden="true">+{hiddenCount}</span>
        </button>
      )}
      {expanded && plan.length > COMPACT_PLAN_ITEMS && (
        <button
          type="button"
          className="qivryn-plan-expand mt-2"
          aria-label="Collapse plan items"
          aria-expanded={expanded}
          onClick={() => setExpanded(false)}
        >
          <ChevronUpIcon aria-hidden="true" className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
