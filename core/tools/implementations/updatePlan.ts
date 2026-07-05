import { ContextItem } from "../..";
import { ToolImpl } from ".";

const PLAN_STATUSES = ["pending", "in_progress", "completed"] as const;

type PlanStatus = (typeof PLAN_STATUSES)[number];
type RawPlanItem = {
  step?: unknown;
  status?: unknown;
};

function isPlanStatus(value: unknown): value is PlanStatus {
  return (
    typeof value === "string" && PLAN_STATUSES.includes(value as PlanStatus)
  );
}

export const updatePlanImpl: ToolImpl = async (args) => {
  const rawPlan: unknown[] = Array.isArray(args.plan) ? args.plan : [];
  const plan = rawPlan
    .map((item: unknown) => {
      const rawItem = item as RawPlanItem;
      return {
        step: typeof rawItem.step === "string" ? rawItem.step.trim() : "",
        status: isPlanStatus(rawItem.status) ? rawItem.status : "pending",
      };
    })
    .filter((item: { step: string; status: PlanStatus }) => item.step);

  if (plan.length === 0) {
    throw new Error("Plan needs at least one step");
  }

  const inProgressCount = plan.filter(
    (item: { step: string; status: PlanStatus }) =>
      item.status === "in_progress",
  ).length;
  if (inProgressCount > 1) {
    throw new Error("Plan can have at most one in_progress step");
  }

  const completed = plan.filter(
    (item: { step: string; status: PlanStatus }) => item.status === "completed",
  ).length;
  const explanation =
    typeof args.explanation === "string" ? args.explanation.trim() : "";

  return [
    {
      name: "Plan",
      description: explanation || `${completed}/${plan.length} completed`,
      content: `Plan updated. ${completed}/${plan.length} steps completed.`,
      hidden: true,
    } satisfies ContextItem,
  ];
};
