"use client";

import { Check, Plus } from "lucide-react";
import { sampleTwins } from "@/lib/twin-directory";

type Props = { friends: string[]; onAdd: (name: string) => void; compact?: boolean };

export function TwinDirectory({ friends, onAdd, compact = false }: Props) {
  return <section className={`twin-directory ${compact ? "compact" : ""}`} aria-label="Sample Twins">
    <div className="twin-directory-heading"><h3>Meet some Twins</h3><p>Sample profiles to explore. Add one to your local circle to try planning.</p></div>
    <div className="twin-directory-grid">{sampleTwins.map(twin => {
      const added = friends.some(name => name.toLowerCase() === twin.name.toLowerCase());
      return <article className="twin-card" key={twin.name}>
        <div className="twin-card-heading"><span className={`twin-card-avatar ${twin.color}`} aria-hidden="true">{twin.initials}</span><div><h3>{twin.name}’s Twin</h3><span className="twin-card-subtitle">Sample profile</span></div></div>
        <p className="twin-card-empty">{twin.about}</p>
        <div className="twin-values">{twin.values.map(value => <span key={value}>{value}</span>)}</div>
        <button type="button" className="twin-card-action" disabled={added || friends.length >= 100} onClick={() => onAdd(twin.name)} aria-label={added ? `${twin.name} is in your circle` : `Add ${twin.name} to your circle`}>{added ? <>In your circle<Check size={15} /></> : <>Add to circle<Plus size={15} /></>}</button>
      </article>;
    })}</div>
  </section>;
}
