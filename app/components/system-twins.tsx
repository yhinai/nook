"use client";

import { useState } from "react";
import { Check, Clock3, Plus, RefreshCw } from "lucide-react";
import type { DirectoryTwin } from "@/lib/workspace";

type Props = {
  twins: DirectoryTwin[]; available: boolean; loading: boolean; error: string;
  busy: string; actionError: string; refresh: () => Promise<void>;
  onAction: (twin: DirectoryTwin, decision?: "accept" | "decline") => Promise<void>;
};
const labels = { available: "On Nook", connected: "Twins connected", incoming: "Wants to connect", outgoing: "Request sent" };

export function SystemTwins({ twins, available, loading, error, busy, actionError, refresh, onAction }: Props) {
  const [query, setQuery] = useState("");
  const filtered = twins.filter(twin => twin.displayName.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="twin-directory system-twins" aria-label="Twins on Nook">
    <div className="twin-directory-heading"><h3>Twins on Nook</h3><p>Meet other people in the system. Connect your Twins to plan and message together.</p></div>
    {!available ? <p className="twin-card-empty">The Twin directory is unavailable. Connect Nook’s agent backend to discover registered people.</p> : <>
      <div className="system-twins-tools"><input aria-label="Search people on Nook" placeholder="Find a Twin by name" value={query} onChange={event => setQuery(event.target.value)} /><button type="button" className="icon-button" aria-label="Refresh Twin directory" disabled={loading} onClick={() => void refresh()}><RefreshCw size={17} /></button></div>
      {error && <p className="council-error" role="alert">{error}</p>}
      {actionError && <p className="council-error" role="alert">{actionError}</p>}
      {!filtered.length && !error && <p className="twin-card-empty" role="status">{loading ? "Finding Twins…" : query.trim() ? "No Twins match that name." : "No other Twins yet. People appear here when they set up Nook on this server."}</p>}
      <div className="twin-directory-grid">{filtered.map(twin => <article className="twin-card" key={twin.id} aria-label={`${twin.displayName}’s Twin, ${labels[twin.status]}`}>
        <div className="twin-card-heading"><span className="twin-card-avatar" aria-hidden="true">{twin.displayName.slice(0, 2).toUpperCase()}</span><div><h3>{twin.displayName}’s Twin</h3><span className="twin-card-subtitle">{labels[twin.status]}</span></div></div>
        {twin.status === "incoming" ? <><p className="twin-card-empty">They’d like to add you to their circle.</p><div className="system-twin-actions"><button type="button" className="twin-card-action" disabled={Boolean(busy)} onClick={() => void onAction(twin, "accept")} aria-label={`Accept ${twin.displayName}’s connection request`}>{busy === twin.id ? "Updating…" : "Accept"}<Check size={15} /></button><button type="button" className="twin-card-agent-action" disabled={Boolean(busy)} onClick={() => void onAction(twin, "decline")} aria-label={`Decline ${twin.displayName}’s connection request`}>Decline</button></div></> : <button type="button" className="twin-card-action" disabled={Boolean(busy) || twin.status !== "available"} onClick={() => void onAction(twin)} aria-label={`Connect with ${twin.displayName}’s Twin`}>{busy === twin.id ? "Sending…" : twin.status === "connected" ? <>Connected<Check size={15} /></> : twin.status === "outgoing" ? <>Request sent<Clock3 size={15} /></> : <>Add Twin<Plus size={15} /></>}</button>}
      </article>)}</div>
      <p className="twin-activity-footer">Connection requests expire after 24 hours. Messaging starts after they accept. Your private preferences and memories stay with you.</p>
    </>}
  </section>;
}
