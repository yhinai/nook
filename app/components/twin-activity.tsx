"use client";

import { ArrowUpRight, Check, Clock3, MessageCircle, Plus, Sparkles, Users } from "lucide-react";

import type { ReactNode } from "react";
import type { AgentMessage } from "@/lib/workspace";

type TwinActivityProps = {
  directory: ReactNode;
  connectedNames: string[];
  messages: AgentMessage[];
  onOpenInbox: () => void;
  friends: string[];
  plans: Record<string, string>;
  onReviewPlan: (name: string) => void;
  onAddConnection: () => void;
  onExploreAgent: (name: string) => void;
};

function planUpdate(status: string | undefined) {
  if (status === "saved") return {
    label: "Plan saved",
    title: "You made room to connect",
    description: "Your interest is saved on this device. Discuss the details with your friend when you’re ready.",
  };
  if (status === "declined") return {
    label: "Set aside",
    title: "Another time works, too",
    description: "You set this plan aside. You can revisit it whenever it feels right.",
  };
  return null;
}

export function TwinActivity({ directory, connectedNames, messages, onOpenInbox, friends, plans, onReviewPlan, onAddConnection, onExploreAgent }: TwinActivityProps) {
  const seen = new Set<string>();
  const localFriends = [...friends, ...Object.keys(plans)].filter(name => {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return <aside className="twin-activity" aria-labelledby="twin-activity-title">
    <div className="twin-activity-heading">
      <span className="eyebrow">YOUR CIRCLE</span>
      <h2 id="twin-activity-title">Other Twins <Users size={19} aria-hidden="true" /></h2>
      <p>A little closer to your people.</p>
    </div>
    <p className="twin-activity-note"><Sparkles size={14} aria-hidden="true" /><span>Your connections & local plan updates</span></p>
    <button type="button" className="twin-activity-add" onClick={onOpenInbox}><MessageCircle size={15} />Twin inbox{messages.length > 0 ? ` · ${messages.length}` : ""}</button>
    <div className="twin-activity-list">
      {!localFriends.length && <p className="twin-card-empty">Your circle starts here. Browse Twins on Nook below or add someone you know.</p>}
      {localFriends.map(name => {
        const connected = connectedNames.includes(name);
        const status = plans[name];
        const update = planUpdate(status);
        return <article className="twin-card twin-card-local" key={name} aria-label={`${name}, ${connected ? "Twin connected" : "saved locally"}`}>
          <div className="twin-card-heading">
            <span className="twin-card-avatar local" aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>
            <div><h3>{name}</h3><span className="twin-card-subtitle">{connected ? "Twin connected" : "Saved locally"}</span></div>
            <span className={`twin-card-status ${update ? status : "local"}`}>{update?.label || "Added"}</span>
          </div>
          {update ? <div className="twin-card-update">{status === "saved" ? <Check size={16} aria-hidden="true" /> : <Clock3 size={16} aria-hidden="true" />}<div><strong>{update.title}</strong><p>{update.description}</p></div></div> : <p className="twin-card-empty">{connected ? "Their Twin is connected. Send an invitation or message through chat." : "Their name is saved on this device. Connect your Twins to exchange messages."}</p>}

          <button type="button" className="twin-card-action" onClick={() => onReviewPlan(name)} aria-label={`Explore a plan with ${name}`}>{status === "saved" ? "Review saved plan" : "Explore a plan"}<ArrowUpRight size={15} aria-hidden="true" /></button>
          <button type="button" className="twin-card-agent-action" onClick={() => onExploreAgent(name)} aria-label={`Talk with your agents about connecting with ${name}`}><MessageCircle size={14} aria-hidden="true" />Talk with your agents</button>
        </article>;
      })}
    </div>
    {directory}
    <button type="button" className="twin-activity-add" onClick={onAddConnection}><Plus size={16} aria-hidden="true" />Add a connection</button>
    <p className="twin-activity-footer">Messages share only what you send. Your private memories stay with you.</p>
  </aside>;
}
