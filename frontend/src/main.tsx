import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  api,
  ApiError,
  type Project,
  type Metric,
  type Point,
  type Endpoint,
  type Key,
} from "./api";
import "./style.css";
import { useLive } from "./useLive";

const format = (value: number | null, digits = 1) =>
  value === null
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: digits });
type User = { name: string; email: string };
export function App() {
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true),
    [error, setError] = useState("");
  const [projects, setProjects] = useState<Project[]>([]),
    [project, setProject] = useState(""),
    [hours, setHours] = useState("1"),
    [refresh, setRefresh] = useState(0);
  const [metrics, setMetrics] = useState<{
    overview: Metric;
    points: Point[];
    endpoints: Endpoint[];
    hasMore: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(1),
    [keys, setKeys] = useState<Key[]>([]),
    [rawKey, setRawKey] = useState("");
  const [tab, setTab] = useState("overview"),
    [updated, setUpdated] = useState("");
  const generation = useRef(0);
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      setUser(null);
      setProjects([]);
      setMetrics(null);
      setRawKey("");
      setError("Your session ended. Please sign in again.");
    } else setError(e instanceof Error ? e.message : "Something went wrong.");
  };
  const liveRefresh = useCallback(() => setRefresh((v) => v + 1), []);
  const checkSession = useCallback(() => {
    void api("/auth/me").catch((e) => {
      if (e instanceof ApiError && e.status === 401) fail(e);
    });
  }, []);
  const live = useLive(project, !!user, liveRefresh, checkSession);
  async function loadProjects() {
    const data = await api<{ projects: Project[] }>("/projects?pageSize=50");
    setProjects(data.projects);
    setProject((current) =>
      data.projects.some((p) => p.id === current)
        ? current
        : (data.projects[0]?.id ?? ""),
    );
  }
  useEffect(() => {
    api<{ user: User }>("/auth/me")
      .then((data) => setUser(data.user))
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) fail(e);
      })
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (user) void loadProjects().catch(fail);
  }, [user]);
  useEffect(() => {
    if (!user || !project) return;
    const controller = new AbortController(),
      version = ++generation.current;
    setLoading(true);
    setError("");
    setMetrics(null);
    const to = new Date(),
      from = new Date(to.getTime() - Number(hours) * 3600000);
    const query = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      page: String(page),
      pageSize: "10",
    });
    const path = `/projects/${project}/metrics/`;
    Promise.all([
      api<Metric>(path + "overview?" + query, { signal: controller.signal }),
      api<{ points: Point[] }>(path + "series?" + query, {
        signal: controller.signal,
      }),
      api<{ endpoints: Endpoint[]; hasMore: boolean }>(
        path + "endpoints?" + query,
        { signal: controller.signal },
      ),
    ])
      .then(([overview, series, endpoints]) => {
        if (version === generation.current && !controller.signal.aborted) {
          setMetrics({ overview, points: series.points, ...endpoints });
          setUpdated(new Date().toLocaleTimeString());
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) fail(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [user, project, hours, refresh, page]);
  useEffect(() => {
    setRawKey("");
    setKeys([]);
    if (!project || !user) return;
    const controller = new AbortController();
    api<{ apiKeys: Key[] }>(`/projects/${project}/keys?pageSize=50`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setKeys(data.apiKeys);
      })
      .catch((e) => {
        if (!controller.signal.aborted) fail(e);
      });
    return () => controller.abort();
  }, [project, user]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  if (checking)
    return (
      <main className="login">
        <p role="status">Opening your workspace…</p>
      </main>
    );
  if (!user)
    return (
      <main className="login">
        <div className="login-story">
          <div className="brand">
            <span className="logo">∿</span> PulseMonitor
          </div>
          <p className="eyebrow">LOCAL API OBSERVABILITY</p>
          <h1>
            Every request.
            <br />A clearer picture.
          </h1>
          <p>
            Follow your API traffic from request to insight. Your services, your
            data, on your machine.
          </p>
          <div className="flow">
            Capture <span>→</span> Queue <span>→</span> Understand
          </div>
        </div>
        <form
          className="login-form"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void action(async () => {
              const result = await api<{ user: User }>("/auth/login", {
                method: "POST",
                body: JSON.stringify({
                  email: data.get("email"),
                  password: data.get("password"),
                }),
              });
              setError("");
              setUser(result.user);
            });
          }}
        >
          <p className="eyebrow">YOUR WORKSPACE</p>
          <h2>Welcome back</h2>
          <p className="muted">Sign in to explore your telemetry.</p>
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              defaultValue="demo@pulsemonitor.local"
              required
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in →"}
          </button>
          <p className="hint">
            Local demo credentials are in your root .env file. Use the
            SEED_PASSWORD value.
          </p>
        </form>
      </main>
    );
  const active = projects.find((p) => p.id === project);
  return (
    <div className="shell">
      <aside>
        <a href="#main" className="skip">
          Skip to content
        </a>
        <div className="brand">
          <span className="logo">∿</span> PulseMonitor
        </div>
        <p className="eyebrow">WORKSPACE</p>
        <nav aria-label="Main navigation">
          <button
            className={tab === "overview" ? "selected" : ""}
            onClick={() => setTab("overview")}
          >
            ◫ <span>Overview</span>
          </button>
          <button
            className={tab === "settings" ? "selected" : ""}
            onClick={() => setTab("settings")}
          >
            ⚙ <span>Projects & keys</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <span className="status-dot" /> Local workspace
          <p>Telemetry, without the cloud.</p>
          <small>{user.email}</small>
          <button
            onClick={() =>
              void action(async () => {
                await api("/auth/logout", { method: "POST" });
                setUser(null);
                setProject("");
                setMetrics(null);
                setRawKey("");
              })
            }
            disabled={busy}
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header>
          <span>
            Workspace{" "}
            <span className="muted">/ {active?.name ?? "Get started"}</span>
          </span>
          <div className="header-actions">
            <span className="badge" role="status">
              {live}
            </span>
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await api("/auth/logout", { method: "POST" });
                  setUser(null);
                  setProject("");
                  setMetrics(null);
                  setRawKey("");
                })
              }
            >
              Sign out
            </button>
          </div>
        </header>
        <main id="main">
          <div className="title-row">
            <div>
              <p className="eyebrow">YOUR API, AT A GLANCE</p>
              <h1>{tab === "overview" ? "Overview" : "Projects & keys"}</h1>
              <p className="muted">
                {tab === "overview"
                  ? "Understand traffic, spot errors, and follow response times."
                  : "Connect your services and keep access under control."}
              </p>
            </div>
            <button
              onClick={() => setRefresh((v) => v + 1)}
              disabled={loading || !project}
            >
              ↻ Refresh
            </button>
          </div>
          {error && (
            <div role="alert" className="error">
              {error}{" "}
              <button onClick={() => setRefresh((v) => v + 1)}>
                Try again
              </button>
            </div>
          )}
          <div className="toolbar">
            <label>
              Project
              <select
                disabled={busy}
                value={project}
                onChange={(e) => {
                  setProject(e.target.value);
                  setPage(1);
                }}
              >
                {projects.length === 0 && (
                  <option value="">No projects yet</option>
                )}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="badge">
              {active?.environment ?? "development"}
            </span>
            <label className="time-filter">
              Time range
              <select
                value={hours}
                onChange={(e) => {
                  setHours(e.target.value);
                  setPage(1);
                }}
              >
                <option value="0.25">Last 15 minutes</option>
                <option value="1">Last hour</option>
                <option value="6">Last 6 hours</option>
                <option value="24">Last 24 hours</option>
              </select>
            </label>
          </div>
          {tab === "settings" ? (
            <div className="settings-grid">
              <section className="panel">
                <h2>Create a project</h2>
                <p className="muted">
                  A project groups telemetry and API keys for one service.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget,
                      data = new FormData(form);
                    void action(async () => {
                      const result = await api<{ project: Project }>(
                        "/projects",
                        {
                          method: "POST",
                          body: JSON.stringify({
                            name: data.get("name"),
                            environment: data.get("environment"),
                          }),
                        },
                      );
                      await loadProjects();
                      setProject(result.project.id);
                      form.reset();
                    });
                  }}
                >
                  <label>
                    Project name
                    <input name="name" maxLength={80} required />
                  </label>
                  <label>
                    Environment
                    <select name="environment">
                      <option>development</option>
                      <option>test</option>
                      <option>staging</option>
                      <option>production</option>
                    </select>
                  </label>
                  <button className="primary" disabled={busy}>
                    Create project
                  </button>
                </form>
              </section>
              <section className="panel">
                <h2>API keys</h2>
                <p className="muted">
                  Keys send telemetry to the selected project. Raw keys appear
                  once.
                </p>
                {project && (
                  <>
                    <form
                      className="inline-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget,
                          data = new FormData(form);
                        void action(async () => {
                          const result = await api<{
                            rawKey: string;
                            apiKey: Key;
                          }>(`/projects/${project}/keys`, {
                            method: "POST",
                            body: JSON.stringify({ name: data.get("name") }),
                          });
                          setRawKey(result.rawKey);
                          setKeys((old) => [result.apiKey, ...old]);
                          form.reset();
                        });
                      }}
                    >
                      <label>
                        Key name
                        <input name="name" maxLength={80} required />
                      </label>
                      <button disabled={busy}>Create key</button>
                    </form>
                    {rawKey && (
                      <div className="key-reveal" role="status">
                        <strong>Save this key now</strong>
                        <code>{rawKey}</code>
                        <button onClick={() => setRawKey("")}>Hide key</button>
                      </div>
                    )}
                    <ul className="key-list">
                      {keys.map((key) => (
                        <li key={key.id}>
                          <div>
                            <strong>{key.name}</strong>
                            <small>
                              {key.keyPrefix}… ·{" "}
                              {key.revokedAt ? "Revoked" : "Active"}
                            </small>
                          </div>
                          {!key.revokedAt && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void action(async () => {
                                  await api(
                                    `/projects/${project}/keys/${key.id}/revoke`,
                                    { method: "POST" },
                                  );
                                  setKeys((old) =>
                                    old.map((k) =>
                                      k.id === key.id
                                        ? {
                                            ...k,
                                            revokedAt: new Date().toISOString(),
                                          }
                                        : k,
                                    ),
                                  );
                                  setRawKey("");
                                })
                              }
                            >
                              Revoke
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                    {keys.length === 0 && (
                      <p className="hint">
                        No keys yet. Create one to connect your SDK.
                      </p>
                    )}
                  </>
                )}
              </section>
            </div>
          ) : (
            <>
              {loading && (
                <p role="status" className="loading">
                  Loading telemetry…
                </p>
              )}
              {!project && (
                <section className="empty panel">
                  <h2>Start with a project</h2>
                  <p>
                    Create a project and an API key to connect your service.
                  </p>
                  <button onClick={() => setTab("settings")}>
                    Create your first project
                  </button>
                </section>
              )}
              {metrics && (
                <>
                  <div className="cards">
                    {[
                      [
                        "Total requests",
                        format(metrics.overview.count, 0),
                        "Persisted in this window",
                      ],
                      [
                        "Request rate",
                        format(metrics.overview.requestsPerSecond, 3) + " /s",
                        "Across the full time window",
                      ],
                      [
                        "Server error rate",
                        format(metrics.overview.errorRate) + "% ",
                        format(metrics.overview.errors, 0) +
                          " responses with 5xx",
                      ],
                      [
                        "Average latency",
                        format(metrics.overview.averageLatency) + " ms",
                        "Weighted across all requests",
                      ],
                    ].map(([label, value, hint]) => (
                      <section className="metric-card" key={label}>
                        <p>{label}</p>
                        <strong>{value}</strong>
                        <small>{hint}</small>
                      </section>
                    ))}
                  </div>
                  {metrics.overview.count === 0 ? (
                    <section className="empty panel">
                      <div className="empty-icon">∿</div>
                      <h2>Waiting for your first pulse</h2>
                      <p>
                        No requests in this time range. Run demo traffic, then
                        refresh or choose a wider range.
                      </p>
                    </section>
                  ) : (
                    <>
                      <div className="charts">
                        <Chart
                          title="Request traffic"
                          subtitle="Requests per minute bucket"
                          points={metrics.points}
                          field="count"
                          color="#66d3b4"
                        />
                        <Chart
                          title="Server errors"
                          subtitle="5xx responses per minute bucket"
                          points={metrics.points}
                          field="errors"
                          color="#ed9d80"
                        />
                        <Chart
                          title="Response time"
                          subtitle="Average latency · milliseconds"
                          points={metrics.points}
                          field="averageLatency"
                          color="#a69bea"
                        />
                      </div>
                      <section className="panel endpoints">
                        <div className="section-title">
                          <div>
                            <h2>Endpoint performance</h2>
                            <p className="muted">
                              Normalized routes, ordered by request volume
                            </p>
                          </div>
                          <span className="badge">
                            {metrics.endpoints.length} ON THIS PAGE
                          </span>
                        </div>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>Endpoint</th>
                                <th>Requests</th>
                                <th>Error rate</th>
                                <th>Avg. latency</th>
                              </tr>
                            </thead>
                            <tbody>
                              {metrics.endpoints.map((item) => (
                                <tr key={item.method + item.route}>
                                  <td>
                                    <span className="method">
                                      {item.method}
                                    </span>
                                    <code>{item.route}</code>
                                  </td>
                                  <td>{format(item.count, 0)}</td>
                                  <td
                                    className={
                                      item.errors ? "error-number" : ""
                                    }
                                  >
                                    {format(item.errorRate)}%
                                  </td>
                                  <td>{format(item.averageLatency)} ms</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="pagination">
                          <button
                            disabled={page === 1}
                            onClick={() => setPage((v) => v - 1)}
                          >
                            Previous
                          </button>
                          <span>Page {page}</span>
                          <button
                            disabled={!metrics.hasMore}
                            onClick={() => setPage((v) => v + 1)}
                          >
                            Next
                          </button>
                        </div>
                      </section>
                    </>
                  )}
                  <footer>
                    Last refreshed {updated}{" "}
                    <span>Times shown locally · 5xx errors only</span>
                  </footer>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
function Chart({
  title,
  subtitle,
  points,
  field,
  color,
}: {
  title: string;
  subtitle: string;
  points: Point[];
  field: string;
  color: string;
}) {
  return (
    <section className="panel chart" aria-label={title}>
      <h2>{title}</h2>
      <p className="muted">{subtitle}</p>
      <div className="chart-canvas">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={points}
            margin={{ left: -18, right: 8, top: 16, bottom: 0 }}
          >
            <CartesianGrid stroke="#e9edf2" vertical={false} />
            <XAxis
              dataKey="bucket"
              tickFormatter={(v) =>
                new Date(v).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              }
              minTickGap={40}
              tick={{ fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip
              labelFormatter={(v) => new Date(String(v)).toLocaleString()}
              formatter={(v) => format(typeof v === "number" ? v : null)}
            />
            <Area
              type="monotone"
              dataKey={field}
              stroke={color}
              fill={color}
              fillOpacity={0.15}
              strokeWidth={2}
              dot={field === "averageLatency" ? { r: 3 } : false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
