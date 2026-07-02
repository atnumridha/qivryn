import { expect } from "chai";
import {
  By,
  Key,
  VSBrowser,
  WebDriver,
  WebView,
} from "vscode-extension-tester";

import { GlobalActions } from "../actions/Global.actions";
import { GUIActions } from "../actions/GUI.actions";
import { DEFAULT_TIMEOUT } from "../constants";
import { GUISelectors } from "../selectors/GUI.selectors";
import { TestUtils } from "../TestUtils";

describe("Agents and chat UI release gate", () => {
  let view: WebView;
  let driver: WebDriver;

  before(async function () {
    this.timeout(DEFAULT_TIMEOUT.XL);
    await GUIActions.moveContinueToSidebar(VSBrowser.instance.driver);
    await GlobalActions.openTestWorkspace();
    await GlobalActions.clearAllNotifications();
    await GUIActions.toggleGui();
    ({ view, driver } = await GUIActions.switchToReactIframe());
    await GUIActions.selectModelFromDropdown(view, "TEST LLM");
  });

  after(async function () {
    this.timeout(DEFAULT_TIMEOUT.MD);
    try {
      await view.switchBack();
    } catch {
      // The test may already be in the workbench frame after a window switch.
    }
  });

  it("keeps chat and agent creation controls dynamic and navigable", async function () {
    this.timeout(DEFAULT_TIMEOUT.XL);

    const chatModel = await GUISelectors.getModelDropdownButton(view);
    expect(await chatModel.getText()).to.contain("TEST LLM");
    const chatReasoning = await view.findWebElement(
      By.css('[data-testid="reasoning-effort-select-button"]'),
    );
    expect(await chatReasoning.getText()).to.contain("med");

    const input = await GUISelectors.getMessageInputFieldAtIndex(view, 0);
    await input.sendKeys("TEST_USER_MESSAGE_0");
    await input.sendKeys(Key.ENTER);
    await TestUtils.waitForSuccess(() =>
      GUISelectors.getThreadMessageByText(view, "TEST_LLM_RESPONSE_0"),
    );

    await (
      await view.findWebElement(By.css('[data-testid="back-to-agents"]'))
    ).click();
    await TestUtils.waitForSuccess(() =>
      view.findWebElement(By.css('[data-testid="agents-workspace"]')),
    );

    await (
      await view.findWebElement(By.css('button[aria-label="New local agent"]'))
    ).click();
    const createForm = await TestUtils.waitForSuccess(() =>
      view.findWebElement(By.css('form[aria-label="Create agent"]')),
    );
    const agentModel = await createForm.findElement(
      By.css('[data-testid="model-select-button"]'),
    );
    expect(await agentModel.getText()).to.contain("TEST LLM");
    const agentReasoning = await createForm.findElement(
      By.css('[data-testid="reasoning-effort-select-button"]'),
    );
    expect(await agentReasoning.getText()).to.contain("med");

    const task = await createForm.findElement(
      By.css('textarea[aria-label="Agent task"]'),
    );
    await task.sendKeys("Inspect the E2E workspace without modifying files");
    const start = await createForm.findElement(
      By.xpath('.//button[normalize-space()="Start"]'),
    );
    expect(await start.isEnabled()).to.equal(true);
    await (
      await createForm.findElement(
        By.css('button[aria-label="Close create agent"]'),
      )
    ).click();

    await (
      await view.findWebElement(By.css('button[aria-label="Back to chat"]'))
    ).click();
    await TestUtils.waitForSuccess(() =>
      view.findWebElement(By.css('[data-testid="back-to-agents"]')),
    );
  });

  it("opens a saved chat without losing the route back to Agents", async function () {
    this.timeout(DEFAULT_TIMEOUT.XL);

    await (
      await view.findWebElement(By.css('[data-testid="back-to-agents"]'))
    ).click();
    await TestUtils.waitForSuccess(() =>
      view.findWebElement(By.css('[data-testid="agents-workspace"]')),
    );

    const chatRow = await TestUtils.waitForSuccess(() =>
      view.findWebElement(
        By.xpath(
          '//section[.//*[translate(normalize-space(), "chats", "CHATS")="CHATS"]]//button[1]',
        ),
      ),
    );
    await chatRow.click();
    const resume = await TestUtils.waitForSuccess(() =>
      view.findWebElement(
        By.xpath('//button[normalize-space()="Resume chat"]'),
      ),
    );
    const startedAt = Date.now();
    await resume.click();
    await TestUtils.waitForSuccess(() =>
      view.findWebElement(By.css('[data-testid="back-to-agents"]')),
    );
    expect(Date.now() - startedAt).to.be.lessThan(DEFAULT_TIMEOUT.MD);
  });

  it("opens and closes the standalone Agents window without losing the main UI", async function () {
    this.timeout(DEFAULT_TIMEOUT.XL);
    await view.switchBack();
    const originalHandle = await driver.getWindowHandle();
    const beforeHandles = await driver.getAllWindowHandles();

    const { Workbench } = await import("vscode-extension-tester");
    await new Workbench().executeCommand("Continue: Open Agents Window");
    const handles = await TestUtils.waitForSuccess(async () => {
      const current = await driver.getAllWindowHandles();
      if (current.length <= beforeHandles.length)
        throw new Error("No new window");
      return current;
    }, DEFAULT_TIMEOUT.MD);
    const standaloneHandle = handles.find(
      (handle) => !beforeHandles.includes(handle),
    );
    expect(standaloneHandle).not.to.equal(undefined);
    await driver.switchTo().window(standaloneHandle!);
    await driver.close();
    await driver.switchTo().window(originalHandle);

    await GUIActions.toggleGui();
    ({ view, driver } = await GUIActions.switchToReactIframe());
    await TestUtils.waitForSuccess(() =>
      view.findWebElement(By.css('[data-testid="back-to-agents"]')),
    );
  });
});
