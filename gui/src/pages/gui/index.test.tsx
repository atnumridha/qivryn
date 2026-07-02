import { screen } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import { renderWithProviders } from "../../util/test/render";
import GUI from ".";

afterEach(() => {
  delete (window as any).isFullScreen;
});

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}</output>;
}

test("keeps a visible route back to Agents from an opened chat", async () => {
  const { user } = await renderWithProviders(
    <>
      <GUI />
      <LocationProbe />
    </>,
    { routerProps: { initialEntries: ["/"] } },
  );

  await user.click(screen.getByRole("button", { name: "Back to Agents" }));
  expect(screen.getByLabelText("Current route")).toHaveTextContent("/agents");
});

test("offers a clickable standalone reload that releases stuck edit state", async () => {
  (window as any).isFullScreen = true;
  const messenger = new MockIdeMessenger();
  const post = vi.spyOn(messenger, "post");
  const { user } = await renderWithProviders(<GUI />, {
    mockIdeMessenger: messenger,
  });

  await user.click(
    screen.getByRole("button", { name: "Reload Agents window" }),
  );
  expect(post).toHaveBeenCalledWith("reloadAgentWindow", undefined);
});

test("shows one access selector in the shared composer", async () => {
  await renderWithProviders(<GUI />);
  expect(
    await screen.findAllByRole("button", { name: "Agent access mode" }),
  ).toHaveLength(1);
});
