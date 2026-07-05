import { describe, expect, it } from "vitest";
import { updatePlanImpl } from "./updatePlan";

describe("updatePlanImpl", () => {
  it("acknowledges a valid plan update", async () => {
    const output = await updatePlanImpl(
      {
        explanation: "Starting implementation.",
        plan: [
          { step: "Inspect current renderer", status: "completed" },
          { step: "Add plan card", status: "in_progress" },
          { step: "Run validation", status: "pending" },
        ],
      },
      {} as any,
    );

    expect(output[0]).toMatchObject({
      name: "Plan",
      description: "Starting implementation.",
      content: "Plan updated. 1/3 steps completed.",
      hidden: true,
    });
  });

  it("rejects plans with more than one in-progress step", async () => {
    await expect(
      updatePlanImpl(
        {
          plan: [
            { step: "First active step", status: "in_progress" },
            { step: "Second active step", status: "in_progress" },
          ],
        },
        {} as any,
      ),
    ).rejects.toThrow("at most one in_progress");
  });

  it("rejects empty plans", async () => {
    await expect(updatePlanImpl({ plan: [] }, {} as any)).rejects.toThrow(
      "at least one step",
    );
  });
});
