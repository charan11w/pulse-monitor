import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { once } from "node:events";
const require = createRequire(import.meta.url);
const { createTelemetrySDK } = require("../../backend/dist/sdk/index.js");
const { createDemoApp } = require("../../backend/dist/demo/app.js");
const env = Object.fromEntries(
  readFileSync(new URL("../../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
test("login, project/key, SDK -> queue -> charts, reconnect, revoke and responsive keyboard UI", async ({
  page,
  context,
  baseURL,
}) => {
  await page.goto("/");
  await page.getByLabel("Password", { exact: true }).fill(env.SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in →" }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Projects & keys" }).click();
  const name = "Orders API";
  await page.getByLabel("Project name").fill(name);
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(page.getByRole("combobox", { name: "Project", exact: true })).toContainText(name);
  await page.getByLabel("Key name").fill("Browser SDK");
  await page.getByRole("button", { name: "Create key", exact: true }).click();
  const key = await page.locator(".key-reveal code").innerText();
  await page.getByRole("button", { name: "Hide key" }).click();
  await page.getByRole("button", { name: /Overview$/ }).click();
  await expect(page.getByText("Waiting for your first pulse")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Live");
  const sdk = createTelemetrySDK({
    endpoint: baseURL + "/api/v1/telemetry/batch",
    apiKey: key,
    service: "browser-demo",
    timeoutMs: 5000,
    flushIntervalMs: 10000,
  });
  const server = createDemoApp(sdk).listen(0, "127.0.0.1");
  await once(server, "listening");
  const send = async () => {
    for (const route of ["/items/42", "/slow", "/fail"])
      await fetch(`http://127.0.0.1:${server.address().port}${route}`);
    await sdk.flush();
  };
  const count = page.locator(".metric-card").first().locator("strong");
  try {
    await send();
    await expect(count).toHaveText("3");
    await expect(page.getByText("/items/:id", { exact: true })).toBeVisible();
    await context.setOffline(true);
    await send();
    await context.setOffline(false);
    await expect(page.getByRole("status")).toHaveText("Live", {
      timeout: 20000,
    });
    await expect(count).toHaveText("6");
    mkdirSync("../artifacts", { recursive: true });
    await page.screenshot({
      path: "../artifacts/dashboard-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
      "BODY",
    );
    await page.screenshot({
      path: "../artifacts/dashboard-mobile.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Projects & keys" }).click();
    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(page.getByText(/Revoked/)).toBeVisible();
    const denied = await context.request.post("/api/v1/telemetry/batch", {
      headers: { "X-API-Key": key },
      data: { events: [] },
    });
    expect(denied.status()).toBe(401);
    await page
      .locator("header")
      .getByRole("button", { name: "Sign out" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
  } finally {
    await sdk.shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
