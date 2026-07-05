import {
  CheckCircleIcon,
  ClockIcon,
  PlayCircleIcon,
} from "@heroicons/react/24/outline";
import { ToolCallState } from "core";

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
  if (status === "completed") {
    return <CheckCircleIcon className="text-success mt-0.5 h-4 w-4" />;
  }
  if (status === "in_progress") {
    return <PlayCircleIcon className="text-warning mt-0.5 h-4 w-4" />;
  }
  return <ClockIcon className="text-description-muted mt-0.5 h-4 w-4" />;
}

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

  if (plan.length === 0) {
    return null;
  }

  return (
    <div className="border-border bg-background mt-2 rounded-lg border px-3 py-2.5">
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
        {plan.map((item, index) => (
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
    </div>
  );
}
