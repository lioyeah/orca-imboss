#!/usr/bin/env node
//
// Talk to the isolated UI test instance over CDP (scripts/private/run-test-env.sh).
//
//   node scripts/private/cdp-eval.mjs --list                     # page targets
//   node scripts/private/cdp-eval.mjs --shot out.png              # screenshot the page
//   node scripts/private/cdp-eval.mjs --eval 'document.title'
//   node scripts/private/cdp-eval.mjs --eval 'document.title' --shot out.png
//   node scripts/private/cdp-eval.mjs --dpr 2 --eval '<measure the graph stage>'
//
// Prints the evaluated expression's value (returnByValue) and/or writes the
// screenshot. Use it when a finding needs numbers — an element's bounding box, a
// resolved CSS value, whether a private token is live — not only a picture.
//
// Environment:
//   CDP_PORT   debugging port (default: 9224, the test env's port)
//
import fs from "node:fs";

const PORT = process.env.CDP_PORT || "9224";
const BASE = `http://127.0.0.1:${PORT}`;
const args = process.argv.slice(2);

const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] ?? "";
};

const list = await (await fetch(`${BASE}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) {
  console.error(`cdp-eval: no page target on ${BASE} — is the test instance running?`);
  process.exit(1);
}

if (args.includes("--list")) {
  for (const t of list) console.log(`${t.type}\t${t.title}\t${t.url}`);
  process.exit(0);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error(`cannot connect to ${page.webSocketDebuggerUrl}`));
});

let nextId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send("Page.enable");

// Force a device scale factor, to reproduce HiDPI-only layout bugs (a canvas that
// sizes itself in the wrong units only misbehaves when dpr != 1). Restores dpr 1
// when called as --dpr 1.
const dpr = flag("--dpr");
if (dpr) {
  const res = await send("Runtime.evaluate", {
    expression: "JSON.stringify({w: innerWidth, h: innerHeight})",
    returnByValue: true,
  });
  const { w, h } = JSON.parse(res.result.result.value);
  await send("Emulation.setDeviceMetricsOverride", {
    width: w,
    height: h,
    deviceScaleFactor: Number(dpr),
    mobile: false,
  });
  console.error(`cdp-eval: deviceScaleFactor = ${dpr} (viewport ${w}x${h})`);
}

const expression = flag("--eval");
if (expression) {
  const res = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.result?.exceptionDetails) {
    console.error("cdp-eval: evaluation threw:", JSON.stringify(res.result.exceptionDetails));
    process.exitCode = 1;
  } else {
    console.log(res.result?.result?.value ?? JSON.stringify(res.result?.result));
  }
}

const shot = flag("--shot");
if (shot) {
  const res = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(shot, Buffer.from(res.result.data, "base64"));
  console.error(`cdp-eval: wrote ${shot}`);
}

ws.close();
