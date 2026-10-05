"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- Native navigation avoids Vinext RSC prefetch failures. */

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Network, RefreshCw, Search, Users, MessageCircle } from "lucide-react";
import { matchesUserName } from "@/lib/user-search";
import { SystemTwins } from "@/components/system-twins";
import { AgentInbox } from "@/components/agent-inbox";
import { useTwinConnections } from "@/lib/use-twin-connections";
import { workspaceSchema, type Profile } from "@/lib/workspace";
import "./twins.css";

const emptyProfile: Profile = { name: "", priority: "", values: [], weekend: true, about: "", social: { linkedin: "", instagram: "", website: "" } };
type MapNode = { id: string; name: string; phase: "active" | "invited" | "revoked" | "local"; connectionId?: string };
const labels = { active: "Connected", invited: "Invitation pending", revoked: "Disconnected", local: "Local contact" };

export default function TwinsPage() {
  const [profile, setProfile] = useState(emptyProfile);
  const [localFriends, setLocalFriends] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [availability, setAvailability] = useState<"checking" | "available" | "unavailable">("checking");
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const graphViewport = useRef<HTMLDivElement>(null);
  const [graphWidth, setGraphWidth] = useState(640);
  useEffect(() => {
    const viewport = graphViewport.current;
    if (!viewport) return;
    const observer = new ResizeObserver(entries => setGraphWidth(entries[0].contentRect.width));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [ready, profile.name]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const raw = localStorage.getItem("nook.v1");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && !parsed.plans && ["pending", "saved", "declined"].includes(parsed.planStatus)) parsed.plans = { Maya: parsed.planStatus };
          const workspace = workspaceSchema.parse(parsed);
          if (workspace.onboardingCompleted) { setProfile(workspace.profile); setLocalFriends(workspace.friends); }
        }
      } catch { setStorageError("Your saved space could not be read. Return to Nook to recover your profile."); }
      setReady(true);
    }, 0);
    const controller = new AbortController();
    fetch("/api/chat", { signal: controller.signal }).then(response => response.ok ? response.json() as Promise<{ agentsAvailable?: boolean }> : null).then(status => setAvailability(status?.agentsAvailable ? "available" : "unavailable")).catch(() => { if (!controller.signal.aborted) setAvailability("unavailable"); });
    return () => { clearTimeout(timer); controller.abort(); };
  }, []);
  const circle = useTwinConnections(profile, ready && Boolean(profile.name) && availability === "available");
  const connectedNodes: MapNode[] = circle.connections.flatMap(connection => connection.participants.filter(person => !person.isMe).map(person => ({ id: `${connection.id}:${person.id}`, name: person.displayName, phase: connection.phase, connectionId: connection.id })));
  const connectedNames = new Set(connectedNodes.map(node => node.name));
  const nodes: MapNode[] = [...connectedNodes, ...localFriends.filter(name => !connectedNames.has(name)).map(name => ({ id: `local:${name}`, name, phase: "local" as const }))];
  const visibleNodes = nodes.filter(node => matchesUserName(node.name, query) && (filter === "all" || node.phase === filter));
  const selected = nodes.find(node => node.id === selectedId);
  const selectedConnection = circle.connections.find(connection => connection.id === selected?.connectionId);
  const selectedMessages = circle.messages.filter(message => message.connectionId === selected?.connectionId);
  const rings = Math.max(1, Math.ceil(visibleNodes.length / 10));
  const baseSize = Math.max(visibleNodes.length > 6 ? 520 : 340, Math.min(640, graphWidth));
  const firstRadius = Math.min(210, (baseSize - 120) / 2);
  const size = baseSize + (rings - 1) * 200;
  const center = size / 2;
  const positioned = visibleNodes.map((node, index) => {
    const ring = Math.floor(index / 10);
    const count = Math.min(10, visibleNodes.length - ring * 10);
    const angle = (index % 10) / count * Math.PI * 2 - Math.PI / 2;
    const radius = firstRadius + ring * 100;
    return { ...node, x: center + Math.cos(angle) * radius, y: center + Math.sin(angle) * radius };
  });
  return <div className="twins-page">
    <header className="twins-toolbar"><a href="/" className="text-button"><ArrowLeft size={17} /> Back to Nook</a><span><Network size={18} /> Twins map</span><button className="text-button" onClick={() => void circle.refresh()} disabled={circle.loading || availability !== "available" || !profile.name}><RefreshCw size={16} />{circle.loading ? "Refreshing…" : "Refresh"}</button></header>
    <main className="twins-main">
      <div className="twins-heading"><div><span className="eyebrow">YOUR CONNECTED CIRCLE</span><h1>A little world of connections.</h1><p>See who your Twin is connected to, and follow the conversations bringing you together.</p></div><div className="twins-counts"><span><Users size={18} /><strong>{nodes.filter(node => node.phase === "active").length}</strong> connected Twins</span><span><MessageCircle size={18} /><strong>{circle.messages.length}</strong> received messages</span></div></div>
      {storageError && <p role="alert" className="council-error">{storageError}</p>}
      {!ready ? <p role="status">Opening your Circle…</p> : !profile.name ? <div className="twins-empty"><Network size={32} /><h2>Start with your own Twin.</h2><p>Introduce yourself to Nook to create your Circle.</p><a href="/" className="primary-button">Set up my Twin</a></div> : <>
        {availability === "unavailable" && <p className="twins-notice" role="status">Live Twin connections are unavailable. Your local contacts are shown below; conversations will appear when the connection service is available.</p>}
        {circle.error && <p className="council-error" role="alert">{circle.error}</p>}
        <SystemTwins twins={circle.directory} available={availability === "available"} loading={circle.loading} error={circle.error} busy={circle.actionBusy} actionError={circle.actionError} refresh={circle.refresh} onAction={circle.actOnTwin} />
        <div className="twins-layout"><section className="twins-map-panel" aria-label="Twin network">
          <div className="twins-controls"><label className="twins-search"><Search size={17} /><input aria-label="Search Twins" placeholder="Find someone in your Circle" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="Filter connections" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All connections</option><option value="active">Connected</option><option value="invited">Pending</option><option value="local">Local contacts</option><option value="revoked">Disconnected</option></select></div>
          <div ref={graphViewport} className="twins-graph-scroll" tabIndex={0} aria-label="Circular network map. Scroll to explore; select a Twin to see details."><div className="twins-graph" style={{ width: size, height: size }}>
            <svg width={size} height={size} aria-hidden="true">{Array.from({ length: rings }, (_, index) => <circle key={index} cx={center} cy={center} r={firstRadius + index * 100} className="twins-orbit" />)}{positioned.map(node => <line key={node.id} x1={center} y1={center} x2={node.x} y2={node.y} className={`twins-edge ${node.phase} ${selectedId === node.id ? "selected" : ""}`} />)}</svg>
            <button className={`twins-node twins-self ${!selected ? "selected" : ""}`} style={{ left: center, top: center }} onClick={() => setSelectedId("")} aria-label="Select your Twin" aria-pressed={!selected}><span className="twins-node-avatar">{profile.name.slice(0, 2).toUpperCase()}</span><strong>Your Twin</strong><small>{profile.name}</small></button>
            {positioned.map(node => <button key={node.id} className={`twins-node ${node.phase} ${selectedId === node.id ? "selected" : ""}`} style={{ left: node.x, top: node.y }} onClick={() => setSelectedId(node.id)} aria-pressed={selectedId === node.id} aria-label={`${node.name}, ${labels[node.phase]}`}><span className="twins-node-avatar">{node.name.slice(0, 2).toUpperCase()}</span><strong>{node.name}</strong><small>{labels[node.phase]}</small>{circle.messages.some(message => message.connectionId === node.connectionId) && <span className="twins-message-dot" aria-label="Has messages" />}</button>)}
          </div></div>
          <div className="twins-legend"><span><i /> Connected</span><span><i className="pending" /> Pending / local</span><small>Lines show your Twin’s connections.</small></div>
          {!visibleNodes.length && <p className="twins-map-empty" role="status">{circle.loading || availability === "checking" ? "Checking your connections…" : nodes.length ? "No Twins match your filters." : "Your Circle starts here. Add a connection from Nook to grow your map."}</p>}
        </section>
        <aside className="twins-details" aria-label="Selected Twin details"><span className="eyebrow">{selected ? "IN YOUR CIRCLE" : "AT THE CENTER"}</span><h2>{selected ? `${selected.name}’s Twin` : "Your Twin"}</h2><p className="twins-detail-status">{selected ? labels[selected.phase] : `A space shaped around ${profile.name}.`}</p>
          {selected ? selectedConnection ? <AgentInbox key={selected.connectionId} profile={profile} connections={[selectedConnection]} messages={selectedMessages} loading={circle.loading} error="" refresh={circle.refresh} /> : <div className="twins-detail-empty"><MessageCircle size={25} /><p>This person is saved locally. Connect your Twins from Nook’s Circle to start a conversation.</p><a href="/" className="text-button">Return to your Circle <ArrowLeft size={14} /></a></div> : <><p>Select a Twin on the map or in the list below to explore your connection and received conversations.</p><div className="twins-connection-list">{visibleNodes.map(node => <button key={node.id} onClick={() => setSelectedId(node.id)}><span className="avatar">{node.name.slice(0, 2).toUpperCase()}</span><span><strong>{node.name}</strong><small>{labels[node.phase]}</small></span><MessageCircle size={16} /></button>)}</div><p className="subtle">Only connections and messages available to your Twin are shown. Conversations between other people are private.</p></>}
        </aside></div>
      </>}
    </main>
  </div>;
}
