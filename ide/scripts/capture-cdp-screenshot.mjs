#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const options = parseArgs(process.argv.slice(2));
const endpoint = options.endpoint ?? "http://127.0.0.1:9333";
const output = options.output;
if (!output && !options.noScreenshot) {
  throw new Error("Usage: capture-cdp-screenshot.mjs --output <file.png>");
}

const targets = await fetch(`${endpoint}/json/list`).then((response) => {
  if (!response.ok) {
    throw new Error(`DevTools target query failed: ${response.status}`);
  }
  return response.json();
});
const target = targets.find((candidate) => {
  if (!candidate.webSocketDebuggerUrl) return false;
  if (options.targetTitleContains) {
    return String(candidate.title).includes(options.targetTitleContains);
  }
  if (options.targetUrlContains) {
    return String(candidate.url).includes(options.targetUrlContains);
  }
  return (
    candidate.type === "page" &&
    String(candidate.url).includes("workbench.html")
  );
});
if (!target) throw new Error("No Code OSS workbench DevTools target was found");

const connection = await connect(target.webSocketDebuggerUrl);
try {
  await connection.call("Runtime.enable");
  if (
    !options.noScreenshot ||
    options.clicks.length ||
    options.drags.length ||
    options.wheels.length ||
    options.text ||
    options.inspectFrames
  ) {
    await connection.call("Page.enable");
    await connection.call("Emulation.setDeviceMetricsOverride", {
      width: options.width,
      height: options.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }
  await connection.call("Runtime.evaluate", {
    expression: `new Promise(resolve => {
      const done = () => {
        const timeout = setTimeout(resolve, 120);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          clearTimeout(timeout);
          resolve();
        }));
      };
      if (document.readyState === 'complete') done();
      else addEventListener('load', done, { once: true });
    })`,
    awaitPromise: true,
    returnByValue: true,
  });
  for (const click of options.clicks) {
    await connection.call("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: click.x,
      y: click.y,
      button: "none",
    });
    await connection.call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: click.x,
      y: click.y,
      button: "left",
      clickCount: 1,
    });
    await connection.call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: click.x,
      y: click.y,
      button: "left",
      clickCount: 1,
    });
    await animationFrame(connection);
  }
  for (const drag of options.drags) {
    await connection.call("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: drag.fromX,
      y: drag.fromY,
      button: "none",
    });
    await connection.call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: drag.fromX,
      y: drag.fromY,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    for (let step = 1; step <= 10; step += 1) {
      await connection.call("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: drag.fromX + ((drag.toX - drag.fromX) * step) / 10,
        y: drag.fromY + ((drag.toY - drag.fromY) * step) / 10,
        button: "left",
        buttons: 1,
      });
    }
    await connection.call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: drag.toX,
      y: drag.toY,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await animationFrame(connection);
  }
  for (const wheel of options.wheels) {
    await connection.call("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: wheel.x,
      y: wheel.y,
      deltaX: 0,
      deltaY: wheel.deltaY,
    });
    await animationFrame(connection);
  }
  for (const shortcut of options.shortcuts) {
    await dispatchShortcut(connection, shortcut);
    await animationFrame(connection);
  }
  if (options.text) {
    await connection.call("Input.insertText", { text: options.text });
    await animationFrame(connection);
  }
  for (const key of options.keys) {
    await dispatchKey(connection, key);
    await animationFrame(connection);
  }
  let resolvedOutput;
  if (!options.noScreenshot) {
    const screenshot = await connection.call("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    resolvedOutput = path.resolve(output);
    await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
    await fs.writeFile(resolvedOutput, Buffer.from(screenshot.data, "base64"));
  }
  const inspection = options.inspectSelectors.length
    ? await connection.call("Runtime.evaluate", {
        expression: `(${inspectSelectors.toString()})(${JSON.stringify(options.inspectSelectors)})`,
        returnByValue: true,
      })
    : undefined;
  const frameInspection = options.inspectFrames
    ? await inspectFrames(connection, options.inspectSelectors)
    : undefined;
  const targetInspection = options.inspectFrames
    ? await inspectChildTargets(connection, options.inspectSelectors)
    : undefined;
  console.log(
    JSON.stringify(
      {
        output: resolvedOutput,
        viewport: { width: options.width, height: options.height },
        title: target.title,
        url: target.url,
        inspection: inspection?.result?.value,
        frameInspection,
        targetInspection,
      },
      null,
      2,
    ),
  );
} finally {
  connection.close();
}

function parseArgs(args) {
  const parsed = {
    width: 1440,
    height: 900,
    inspectSelectors: [],
    clicks: [],
    drags: [],
    wheels: [],
    keys: [],
    shortcuts: [],
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--endpoint") parsed.endpoint = args[++index];
    else if (argument === "--output") parsed.output = args[++index];
    else if (argument === "--width")
      parsed.width = positive(args[++index], argument);
    else if (argument === "--height")
      parsed.height = positive(args[++index], argument);
    else if (argument === "--inspect-selector")
      parsed.inspectSelectors.push(args[++index]);
    else if (argument === "--target-title-contains")
      parsed.targetTitleContains = args[++index];
    else if (argument === "--target-url-contains")
      parsed.targetUrlContains = args[++index];
    else if (argument === "--click") {
      parsed.clicks.push({
        x: Number(args[++index]),
        y: Number(args[++index]),
      });
    } else if (argument === "--type") parsed.text = args[++index];
    else if (argument === "--drag") {
      parsed.drags.push({
        fromX: Number(args[++index]),
        fromY: Number(args[++index]),
        toX: Number(args[++index]),
        toY: Number(args[++index]),
      });
    }
    else if (argument === "--wheel") {
      parsed.wheels.push({
        x: Number(args[++index]),
        y: Number(args[++index]),
        deltaY: Number(args[++index]),
      });
    } else if (argument === "--press") parsed.keys.push(args[++index]);
    else if (argument === "--shortcut")
      parsed.shortcuts.push(args[++index]);
    else if (argument === "--no-screenshot") parsed.noScreenshot = true;
    else if (argument === "--inspect-frames") parsed.inspectFrames = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  for (const click of parsed.clicks) {
    if (!Number.isFinite(click.x) || !Number.isFinite(click.y)) {
      throw new Error("--click requires numeric x y coordinates");
    }
  }
  for (const drag of parsed.drags) {
    if (
      !Number.isFinite(drag.fromX) ||
      !Number.isFinite(drag.fromY) ||
      !Number.isFinite(drag.toX) ||
      !Number.isFinite(drag.toY)
    ) {
      throw new Error("--drag requires numeric fromX fromY toX toY coordinates");
    }
  }
  for (const wheel of parsed.wheels) {
    if (
      !Number.isFinite(wheel.x) ||
      !Number.isFinite(wheel.y) ||
      !Number.isFinite(wheel.deltaY)
    ) {
      throw new Error("--wheel requires numeric x y deltaY coordinates");
    }
  }
  return parsed;
}

async function inspectFrames(connection, selectors) {
  const frameTree = await connection.call("Page.getFrameTree");
  const frames = flattenFrames(frameTree.frameTree);
  const results = [];

  for (const frame of frames) {
    try {
      const world = await connection.call("Page.createIsolatedWorld", {
        frameId: frame.id,
        worldName: "qivryn-cdp-inspection",
      });
      const evaluation = await connection.call("Runtime.evaluate", {
        contextId: world.executionContextId,
        expression: `(${inspectCurrentDocument.toString()})(${JSON.stringify(selectors)})`,
        returnByValue: true,
      });
      results.push({
        id: frame.id,
        parentId: frame.parentId,
        name: frame.name,
        url: frame.url,
        document: evaluation.result?.value,
      });
    } catch (error) {
      results.push({
        id: frame.id,
        parentId: frame.parentId,
        name: frame.name,
        url: frame.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

async function inspectChildTargets(connection, selectors) {
  const targets = await connection.call("Target.getTargets");
  const childTargets = targets.targetInfos.filter(
    (target) =>
      target.type === "iframe" ||
      String(target.url).includes("vscode-webview") ||
      String(target.url).includes("extensionDevelopmentPath"),
  );
  const results = [];

  for (const target of childTargets) {
    let sessionId;
    try {
      const attached = await connection.call("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
      });
      sessionId = attached.sessionId;
      await connection.call("Runtime.enable", {}, sessionId);
      await connection.call("Page.enable", {}, sessionId);
      const evaluation = await connection.call(
        "Runtime.evaluate",
        {
          expression: `(${inspectCurrentDocument.toString()})(${JSON.stringify(selectors)})`,
          returnByValue: true,
        },
        sessionId,
      );
      const childFrameTree = await connection.call(
        "Page.getFrameTree",
        {},
        sessionId,
      );
      const childFrames = [];
      for (const frame of flattenFrames(childFrameTree.frameTree)) {
        try {
          const world = await connection.call(
            "Page.createIsolatedWorld",
            {
              frameId: frame.id,
              worldName: "qivryn-cdp-child-inspection",
            },
            sessionId,
          );
          const frameEvaluation = await connection.call(
            "Runtime.evaluate",
            {
              contextId: world.executionContextId,
              expression: `(${inspectCurrentDocument.toString()})(${JSON.stringify(selectors)})`,
              returnByValue: true,
            },
            sessionId,
          );
          childFrames.push({
            id: frame.id,
            parentId: frame.parentId,
            name: frame.name,
            url: frame.url,
            document: frameEvaluation.result?.value,
          });
        } catch (error) {
          childFrames.push({
            id: frame.id,
            parentId: frame.parentId,
            name: frame.name,
            url: frame.url,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      results.push({
        id: target.targetId,
        type: target.type,
        title: target.title,
        url: target.url,
        document: evaluation.result?.value,
        childFrames,
      });
    } catch (error) {
      results.push({
        id: target.targetId,
        type: target.type,
        title: target.title,
        url: target.url,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (sessionId) {
        await connection
          .call("Target.detachFromTarget", { sessionId })
          .catch(() => undefined);
      }
    }
  }

  return results;
}

function flattenFrames(frameTree, parentId) {
  const frame = frameTree.frame;
  return [
    {
      id: frame.id,
      parentId,
      name: frame.name,
      url: frame.url,
    },
    ...(frameTree.childFrames ?? []).flatMap((child) =>
      flattenFrames(child, frame.id),
    ),
  ];
}

function inspectCurrentDocument(selectors) {
  const rect = (element) => {
    if (!element) return undefined;
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      classes: element.className,
      display: style.display,
      position: style.position,
      overflow: style.overflow,
      width: Math.round(bounds.width * 100) / 100,
      height: Math.round(bounds.height * 100) / 100,
      x: Math.round(bounds.x * 100) / 100,
      y: Math.round(bounds.y * 100) / 100,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  };
  const inspect = (selector) => {
    const elements = [...document.querySelectorAll(selector)].slice(0, 8);
    return {
      selector,
      count: document.querySelectorAll(selector).length,
      elements: elements.map((element) => {
        const bounds = rect(element);
        const style = getComputedStyle(element);
        return {
          ...bounds,
          text: element.textContent?.trim().slice(0, 120),
          title: element.getAttribute("title"),
          ariaLabel: element.getAttribute("aria-label"),
          role: element.getAttribute("role"),
          visibility: style.visibility,
          background: style.backgroundColor,
          color: style.color,
        };
      }),
    };
  };

  return {
    readyState: document.readyState,
    href: location.href,
    viewport: { width: innerWidth, height: innerHeight },
    documentElement: rect(document.documentElement),
    body: rect(document.body),
    root: rect(document.querySelector("#root")),
    rootChildren: [...(document.querySelector("#root")?.children ?? [])]
      .slice(0, 8)
      .map(rect),
    selectors: selectors.map(inspect),
  };
}

function inspectSelectors(selectors) {
  return selectors.map((selector) => {
    const elements = [...document.querySelectorAll(selector)].slice(0, 8);
    return {
      selector,
      count: document.querySelectorAll(selector).length,
      elements: elements.map((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          classes: element.className,
          text: element.textContent?.trim().slice(0, 120),
          display: style.display,
          visibility: style.visibility,
          background: style.backgroundColor,
          color: style.color,
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          x: Math.round(rect.x * 100) / 100,
          y: Math.round(rect.y * 100) / 100,
        };
      }),
    };
  });
}

function positive(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out connecting to ${url}`)),
      10_000,
    );
    const finish = (callback) => (value) => {
      clearTimeout(timeout);
      callback(value);
    };
    socket.addEventListener("open", finish(resolve), { once: true });
    socket.addEventListener("error", finish(reject), { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result ?? {});
  });
  return {
    call(method, params = {}, sessionId) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP ${method} timed out`));
        }, 10_000);
        pending.set(id, {
          resolve(value) {
            clearTimeout(timeout);
            resolve(value);
          },
          reject(error) {
            clearTimeout(timeout);
            reject(error);
          },
        });
        // Register before sending: fast local renderers can answer in the same
        // event-loop turn, otherwise the response is lost and verification hangs.
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    close() {
      socket.close();
    },
  };
}

async function animationFrame(connection) {
  await connection.call("Runtime.evaluate", {
    expression:
      "new Promise(resolve => { const timeout = setTimeout(resolve, 120); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timeout); resolve(); })); })",
    awaitPromise: true,
    returnByValue: true,
  });
}

async function dispatchKey(connection, key) {
  const mapped = keyMap(key);
  await connection.call("Input.dispatchKeyEvent", {
    type: "keyDown",
    windowsVirtualKeyCode: mapped.code,
    nativeVirtualKeyCode: mapped.code,
    key: mapped.key,
    code: mapped.codeName,
    text: mapped.text,
    unmodifiedText: mapped.text,
  });
  await connection.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    windowsVirtualKeyCode: mapped.code,
    nativeVirtualKeyCode: mapped.code,
    key: mapped.key,
    code: mapped.codeName,
  });
}

async function dispatchShortcut(connection, shortcut) {
  const parts = shortcut.split("+").map((part) => part.trim());
  const key = parts.pop();
  if (!key || key.length !== 1) {
    throw new Error(`Unsupported shortcut: ${shortcut}`);
  }
  const modifiers = parts.reduce((value, modifier) => {
    if (modifier === "Alt") return value | 1;
    if (modifier === "Control") return value | 2;
    if (modifier === "Meta") return value | 4;
    if (modifier === "Shift") return value | 8;
    throw new Error(`Unsupported shortcut modifier: ${modifier}`);
  }, 0);
  const upper = key.toUpperCase();
  const code = upper.charCodeAt(0);
  const payload = {
    modifiers,
    windowsVirtualKeyCode: code,
    nativeVirtualKeyCode: code,
    key: parts.includes("Shift") ? upper : key.toLowerCase(),
    code: `Key${upper}`,
    text: "",
    unmodifiedText: "",
  };
  await connection.call("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    ...payload,
  });
  await connection.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    ...payload,
  });
}

function keyMap(key) {
  if (key === "Enter") {
    return { key: "Enter", codeName: "Enter", code: 13, text: "\r" };
  }
  if (key === "Tab")
    return { key: "Tab", codeName: "Tab", code: 9, text: "\t" };
  if (key === "Escape")
    return { key: "Escape", codeName: "Escape", code: 27, text: "" };
  throw new Error(`Unsupported key: ${key}`);
}
