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
  if (!options.noScreenshot || options.clicks.length || options.text) {
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
      const done = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
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
  console.log(
    JSON.stringify(
      {
        output: resolvedOutput,
        viewport: { width: options.width, height: options.height },
        title: target.title,
        url: target.url,
        inspection: inspection?.result?.value,
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
    keys: [],
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
    else if (argument === "--press") parsed.keys.push(args[++index]);
    else if (argument === "--no-screenshot") parsed.noScreenshot = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  for (const click of parsed.clicks) {
    if (!Number.isFinite(click.x) || !Number.isFinite(click.y)) {
      throw new Error("--click requires numeric x y coordinates");
    }
  }
  return parsed;
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
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
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
    call(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
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
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
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

function keyMap(key) {
  if (key === "Enter") {
    return { key: "Enter", codeName: "Enter", code: 13, text: "\r" };
  }
  if (key === "Tab") return { key: "Tab", codeName: "Tab", code: 9, text: "\t" };
  if (key === "Escape")
    return { key: "Escape", codeName: "Escape", code: 27, text: "" };
  throw new Error(`Unsupported key: ${key}`);
}
