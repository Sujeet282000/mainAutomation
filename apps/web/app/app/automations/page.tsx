"use client";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";

export default function AutomationsPage() {
  const [items, setItems] = useState<Array<{ id: string; name: string; status: string; folder_id?: string }>>([]);
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([]);
  const [name, setName] = useState("New automation");
  const [folderName, setFolderName] = useState("Sales");
  async function load() {
    const [data, f] = await Promise.all([api("/automations"), api("/folders")]);
    setItems(data.automations ?? []);
    setFolders(f.folders ?? []);
  }
  useEffect(() => {
    load().catch(() => undefined);
  }, []);
  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Automations</h1>
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            const created = await api("/automations", { method: "POST", body: JSON.stringify({ name }) });
            window.location.href = `/app/automations/${created.automation.id}`;
          }}
        >
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn">Create</button>
        </form>
      </div>
      <form
        className="row"
        style={{ marginTop: 12 }}
        onSubmit={async (e) => {
          e.preventDefault();
          await api("/folders", { method: "POST", body: JSON.stringify({ name: folderName }) });
          await load();
        }}
      >
        <input className="input" value={folderName} onChange={(e) => setFolderName(e.target.value)} />
        <button className="btn" type="submit">
          Create folder
        </button>
      </form>
      <p className="muted" style={{ marginTop: 8 }}>
        Folders: {folders.map((f) => f.name).join(", ") || "none"}
      </p>
      <div className="grid" style={{ marginTop: 20 }}>
        {items.map((a) => (
          <a key={a.id} className="card" href={`/app/automations/${a.id}`}>
            <h3>{a.name}</h3>
            <div className="muted">{a.status}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
