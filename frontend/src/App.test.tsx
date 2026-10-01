import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { App } from "./main";
vi.mock("./useLive", () => ({ useLive: () => "Live" }));
vi.mock("recharts", () => ({
  ResponsiveContainer: () => null,
  Area: () => null,
  AreaChart: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));
const metric = {
  count: 0,
  errors: 0,
  averageLatency: null,
  requestsPerSecond: 0,
  errorRate: 0,
};
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetcher = vi.fn(async (url: string) => {
    if (url.endsWith("/auth/me"))
      return new Response(
        JSON.stringify({ user: { name: "Owner", email: "owner@test" } }),
      );
    if (url.includes("/keys"))
      return new Response(JSON.stringify({ apiKeys: [] }));
    if (url.includes("/metrics/overview"))
      return new Response(JSON.stringify(metric));
    if (url.includes("/metrics/series"))
      return new Response(JSON.stringify({ points: [] }));
    if (url.includes("/metrics/endpoints"))
      return new Response(JSON.stringify({ endpoints: [], hasMore: false }));
    return new Response(
      JSON.stringify({
        projects: [
          { id: "one", name: "First project", environment: "test" },
          { id: "two", name: "Second project", environment: "test" },
        ],
      }),
    );
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("loads authenticated workspace, explains no data and changes bounded time filter", async () => {
  render(<App />);
  expect(
    await screen.findByText("Waiting for your first pulse"),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Time range"), {
    target: { value: "24" },
  });
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter((c) => c[0].includes("/metrics/overview"))
        .length,
    ).toBe(2),
  );
  expect(screen.getByText("Live")).toBeInTheDocument();
});
test("expired session clears private data and returns to login", async () => {
  render(<App />);
  await screen.findByText("Waiting for your first pulse");
  fetcher.mockImplementation(
    async () =>
      new Response(JSON.stringify({ error: { message: "Expired" } }), {
        status: 401,
      }),
  );
  fireEvent.click(screen.getByText("↻ Refresh"));
  expect(
    await screen.findByRole("heading", { name: "Welcome back" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("Waiting for your first pulse"),
  ).not.toBeInTheDocument();
});
test("failed metrics request shows error rather than an empty success", async () => {
  fetcher.mockImplementation(async (url: string) => {
    if (url.endsWith("/auth/me"))
      return new Response(
        JSON.stringify({ user: { name: "Owner", email: "owner@test" } }),
      );
    if (url.includes("metrics"))
      return new Response(
        JSON.stringify({ error: { message: "Unavailable" } }),
        { status: 503 },
      );
    return new Response(
      JSON.stringify({
        projects: [{ id: "one", name: "First", environment: "test" }],
        apiKeys: [],
      }),
    );
  });
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
  expect(
    screen.queryByText("Waiting for your first pulse"),
  ).not.toBeInTheDocument();
});
test("switching project aborts old metrics and never renders its delayed response", async () => {
  const original = fetcher.getMockImplementation() as (
    url: string,
  ) => Promise<Response>;
  let oldSignal: AbortSignal | undefined;
  fetcher.mockImplementation(async (url: string, options: RequestInit) => {
    if (url.includes("/one/metrics/overview")) {
      oldSignal = options.signal as AbortSignal;
      return new Promise(() => {});
    }
    return original(url);
  });
  render(<App />);
  await screen.findByText("First project");
  await waitFor(() => expect(oldSignal).toBeDefined());
  expect(screen.getByText("Loading telemetry…")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Project"), {
    target: { value: "two" },
  });
  expect(
    await screen.findByText("Waiting for your first pulse"),
  ).toBeInTheDocument();
  expect(oldSignal?.aborted).toBe(true);
});
