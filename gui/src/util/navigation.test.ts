import { describe, expect, it, vi } from "vitest";
import { persistWebviewRoute } from "./navigation";

describe("persistWebviewRoute", () => {
  it("updates the serialized VS Code route without discarding other state", () => {
    const setState = vi.fn();

    persistWebviewRoute("/", {
      getState: () => ({ retained: "value", page: "/agents" }),
      setState,
    });

    expect(setState).toHaveBeenCalledWith({ retained: "value", page: "/" });
    expect((window as any).initialRoute).toBe("/");
  });
});
