"use client";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

export default function Dashboard() {
  const [data, setData] = useState<{
    automations?: unknown[];
    executions?: unknown[];
    plan?: string;
    usage?: Array<{ metric: string; quantity: string }>;
  }>({});
  useEffect(() => {
    Promise.all([api("/automations"), api("/executions"), api("/billing")])
      .then(([a, e, b]) =>
        setData({ automations: a.automations, executions: e.executions, plan: b.plan, usage: b.usage })
      )
      .catch(() => undefined);
  }, []);
  return (
    <div>
      <h1>Dashboard</h1>
      <p className="muted">Workspace overview · plan {data.plan ?? "—"}</p>
      <div className="grid" style={{ marginTop: 20 }}>
        <div className="card"><h3>{data.automations?.length ?? 0}</h3><div className="muted">Automations</div></div>
        <div className="card"><h3>{data.executions?.length ?? 0}</h3><div className="muted">Recent runs</div></div>
        {(data.usage ?? []).map((u) => (
          <div className="card" key={u.metric}>
            <h3>{u.quantity}</h3>
            <div className="muted">{u.metric} today</div>
          </div>
        ))}
      </div>
    </div>
  );
}
