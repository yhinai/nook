"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Leaf } from "lucide-react";
import { profileSchema, socialSchema, type Profile } from "@/lib/workspace";

const values = ["Wellbeing", "Meaningful work", "Time with people", "Learning", "Freedom", "Financial stability"];

export function ProfileDetails({ profile, onChange }: { profile: Profile; onChange: (profile: Profile) => void }) {
  return <>
    <label className="field-label" htmlFor="about">What would help us understand you? <span className="subtle">Optional</span></label>
    <textarea id="about" rows={3} maxLength={600} value={profile.about} onChange={e => onChange({ ...profile, about: e.target.value })} placeholder="What do you do? What do you enjoy? What are you working toward?" />
    <p className="preview-note">Share as much or as little as you like.</p>
    {([['linkedin', 'LinkedIn', 'https://www.linkedin.com/in/your-name'], ['instagram', 'Instagram', 'https://www.instagram.com/your-name'], ['website', 'Website or another profile', 'https://your-site.com']] as const).map(([key, label, placeholder]) => <div key={key}>
      <label className="field-label" htmlFor={key}>{label} <span className="subtle">Optional</span></label>
      <input id={key} type="url" maxLength={300} value={profile.social[key]} placeholder={placeholder} onChange={e => onChange({ ...profile, social: { ...profile.social, [key]: e.target.value } })} onInput={e => e.currentTarget.setCustomValidity("")} onBlur={e => { const result = socialSchema.shape[key].safeParse(e.currentTarget.value); e.currentTarget.setCustomValidity(result.success ? "" : key === "website" ? "Enter a valid http or https URL." : `Enter a valid ${label} profile URL.`); }} />
    </div>)}
    <p className="preview-note">Links are saved on this device. Nook doesn’t connect to these accounts or read their posts. You can edit or remove them anytime in You.</p>
  </>;
}

export function Onboarding({ initialProfile, onComplete, storageError }: { initialProfile: Profile; onComplete: (profile: Profile) => void; storageError: "unavailable" | "corrupt" | null }) {
  const [profile, setProfile] = useState(initialProfile);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);
  const titles = ["A little space, just for you.", `What matters to you${profile.name.trim() ? `, ${profile.name.trim()}` : ""}?`, "A little more of your story."];
  const descriptions = ["Let’s start with an introduction. Your answers help Nook understand your priorities.", "Tell us where you’d like a little support. You can change these answers anytime.", "Add a few details or profile links, if you like. This whole step is optional."];
  function finish(skipDetails = false) {
    const result = profileSchema.safeParse(skipDetails ? { ...profile, about: "", social: { linkedin: "", instagram: "", website: "" } } : profile);
    if (!result.success) { setError(result.error.issues[0]?.message || "Please check your answers."); return; }
    onComplete(result.data);
  }
  return <main className="onboarding-shell">
    <div className="onboarding-brand">nook<span>.</span></div>
    <section className="onboarding-card" aria-labelledby="onboarding-title">
      <div className="onboarding-top"><span className="onboarding-icon"><Leaf size={25} /></span><span className="eyebrow">GETTING TO KNOW YOU · {step + 1} OF 3</span></div>
      <div className="onboarding-progress" aria-hidden="true">{[0, 1, 2].map(index => <span key={index} className={index <= step ? "filled" : ""} />)}</div>
      <h1 id="onboarding-title" ref={heading} tabIndex={-1}>{titles[step]}</h1>
      <p className="onboarding-description">{descriptions[step]}</p>
      <form onSubmit={e => { e.preventDefault(); setError(""); if (step < 2) { if (!profile.name.trim()) { setError("Please enter your name."); return; } if (step === 1 && (!profile.priority.trim() || !profile.values.length)) { setError("Share a priority and choose at least one value."); return; } setStep(step + 1); } else finish(); }}>
        {step === 0 && <><label className="field-label" htmlFor="onboarding-name">What should we call you?</label><input id="onboarding-name" autoComplete="given-name" maxLength={30} required value={profile.name} placeholder="Your name" onChange={e => setProfile({ ...profile, name: e.target.value })} /><p className="preview-note">A first name or nickname is perfect.</p></>}
        {step === 1 && <><label className="field-label" htmlFor="onboarding-priority">What matters most right now?</label><textarea id="onboarding-priority" maxLength={240} rows={3} required value={profile.priority} placeholder="A goal, a change, or something you want more room for…" onChange={e => setProfile({ ...profile, priority: e.target.value })} /><fieldset className="onboarding-values"><legend className="field-label">What do you want to make room for?</legend><div className="value-options">{values.map(value => <button type="button" key={value} aria-pressed={profile.values.includes(value)} className={profile.values.includes(value) ? "selected" : ""} onClick={() => setProfile({ ...profile, values: profile.values.includes(value) ? profile.values.filter(v => v !== value) : [...profile.values, value] })}>{profile.values.includes(value) && <Check size={14} />}{value}</button>)}</div></fieldset><label className="checkbox-row"><input type="checkbox" checked={profile.weekend} onChange={e => setProfile({ ...profile, weekend: e.target.checked })} /><span>Protect my weekends for rest and my people.</span></label></>}
        {step === 2 && <ProfileDetails profile={profile} onChange={setProfile} />}
        {error && <p className="onboarding-error" role="alert">{error}</p>}
        <div className="onboarding-actions">{step > 0 ? <button className="text-button" type="button" onClick={() => { setError(""); setStep(step - 1); }}>Back</button> : <span className="subtle">Saved only on this device</span>}<button className="primary-button" type="submit">{step === 2 ? "Make yourself at home" : "Continue"}<ArrowRight size={17} /></button></div>
        {step === 2 && <button type="button" className="text-button onboarding-skip" onClick={() => finish(true)}>Skip optional details</button>}
      </form>
      {storageError && <p className="storage-warning" role="status">{storageError === "corrupt" ? "Your saved data could not be read and is preserved. These answers will last for this session only." : "Browser storage is unavailable. These answers will last for this session only."}</p>}
    </section>
  </main>;
}
