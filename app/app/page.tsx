"use client";

import { useLocation } from "@/lib/use-location";
import { LocationPermission } from "@/components/location-permission";
import { ProfileDetails, Onboarding } from "@/components/onboarding";
import { AgentInbox } from "@/components/agent-inbox";
import { useTwinConnections } from "@/lib/use-twin-connections";
import { connectionRequest } from "@/lib/connection-client";
import { agentMessageCommand } from "@/lib/agent-message";
import { SystemTwins } from "@/components/system-twins";
import { addCircleName } from "@/lib/twin-directory";
import { TwinActivity } from "@/components/twin-activity";
import { workspaceSchema, liveChatSchema, profileSchema, connectionViewSchema, type Profile } from "@/lib/workspace";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu, Sun, Check, ChevronRight, Compass, Heart, Leaf, Plus, ShieldCheck, Sparkles, Users, X, BriefcaseBusiness, Fingerprint, LockKeyhole, SlidersHorizontal, ArrowUp, BookOpen, MapPin, Search } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";

type Kind = "balance" | "opportunity" | "social" | "reflection";
type Opinion = { title: string; opinion: string; stance: string };
type Source = { title: string; url: string; highlights?: string[]; snippet?: string };
type Decision = { message?: string; sources?: Source[]; researchStatus?: string; id: string; question: string; kind: Kind; saved: boolean; opinions?: Opinion[]; recommendation?: string; critique?: string; mode?: "live" | "preview"; profileSnapshot?: Profile };
const initial: Profile = { name: "", about: "", social: { linkedin: "", instagram: "", website: "" }, priority: "", values: [], weekend: true };
const teams = [
  { name: "Wellbeing", icon: Leaf, color: "green", people: ["EL", "JA", "RO"], specialty: "Energy · habits · balance", insight: "Rest belongs in the plan, too.", members: ["Ellis · Everyday habits", "Jamie · Movement & recovery", "Robin · Mindful perspective"] },
  { name: "Work & ambition", icon: BriefcaseBusiness, color: "sand", people: ["NO", "LI", "AM"], specialty: "Business · career · direction", insight: "Choose the work that moves you forward.", members: ["Noah · Business & strategy", "Liv · Career & growth", "Amir · Practical tradeoffs"] },
  { name: "Relationships", icon: Heart, color: "rose", people: ["MA", "SA", "EV"], specialty: "Friends · family · connection", insight: "Small moments make strong connections.", members: ["Mara · Connection & care", "Sage · Communication", "Evan · Shared experiences"] },
];
const teamDetails = [
  { purpose: "Make room for a life that feels good.", focus: ["Protect my energy", "Build a sustainable habit", "Make time to rest"], steps: ["Notice what gives and takes energy", "Choose one manageable change", "Leave room to recover"], prompts: ["What is one habit I could make easier this week?", "How could I fit movement into my usual day?", "Help me make space to pause and reflect."] },
  { purpose: "Move forward with a clear sense of direction.", focus: ["Find my next step", "Weigh an opportunity", "Set a boundary at work"], steps: ["Name the outcome you want", "Consider the real tradeoffs", "Choose a small next step"], prompts: ["Help me clarify what I want from my work.", "What could I learn before making a career change?", "Help me compare my options without overcommitting."] },
  { purpose: "Give your people the attention they deserve.", focus: ["Make time to connect", "Have a difficult conversation", "Plan something together"], steps: ["Consider who is affected", "Make space for their perspective", "Find one way to connect"], prompts: ["How could I make more time for people I care about?", "Help me prepare for a conversation I have been avoiding.", "Help me plan a simple weekend with my friends."] },
];
const examples = ["Find somewhere for dinner tonight.", "I want to try something new this weekend.", "I have a lot on my mind. Help me figure it out."];
const classify = (q: string): Kind => /offer|startup|career|opportunity|job/i.test(q) ? "opportunity" : /trip|plan|friends|weekend with/i.test(q) ? "social" : /work|saturday|hiking|rest|burnout|proposal/i.test(q) ? "balance" : "reflection";
function ChatText({ text, sources = [] }: { text: string; sources?: Source[] }) {
  const tokens = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)]+\)|\[\d+\])/g);
  return <>{tokens.map((token, index) => {
    if (token.startsWith("**") && token.endsWith("**")) return <strong key={index}>{token.slice(2, -2)}</strong>;
    const citation = /^\[(\d+)\]$/.exec(token);
    const markdown = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(token);
    const source = citation ? sources[Number(citation[1]) - 1] : markdown ? sources.find(item => item.url === markdown[2]) : undefined;
    return source ? <a key={index} href={source.url} target="_blank" rel="noopener noreferrer">{markdown ? markdown[1] : token}</a> : <span key={index}>{token}</span>;
  })}</>;
}
function Brand({ small = false }: { small?: boolean }) { return <span className={`brand ${small ? "small" : ""}`}><span className="brand-mark"><i /><i /><i /><i /></span><span>nook<span className="brand-period">.</span></span></span>; }
function Avatar({ text, color = "" }: { text: string; color?: string }) { return <span className={`avatar ${color}`} aria-hidden="true">{text}</span>; }
function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const opener = useRef<HTMLElement | null>(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  return <Sheet open onOpenChange={open => { if (!open) onClose(); }}><SheetContent className={`modal nook-sheet ${wide ? "wide" : ""}`} showCloseButton={false} aria-describedby={undefined} onCloseAutoFocus={event => {
    event.preventDefault();
    requestAnimationFrame(() => {
      // A replacement sheet owns focus when switching between utility views.
      if (document.querySelector('[data-slot="sheet-content"][data-state="open"]')) return;
      const target = opener.current?.isConnected ? opener.current : document.querySelector<HTMLElement>(".nook-composer textarea:not(:disabled), .nook-utilities button");
      target?.focus();
    });
  }}><div className="modal-heading"><span className="eyebrow">YOUR PERSONAL SPACE</span><button className="icon-button" aria-label="Close sheet" onClick={onClose}><X size={21} /></button></div><SheetTitle asChild><h2>{title}</h2></SheetTitle><SheetDescription className="sr-only">Your Nook preferences and saved information.</SheetDescription>{children}</SheetContent></Sheet>;
}
export default function Home() {
  const location = useLocation();
  const [profile, setProfile] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [plans, setPlans] = useState<Record<string, string>>({});
  const [localFriends, setFriends] = useState<string[]>([]);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<"unavailable" | "corrupt" | null>(null);
  const [canPersist, setCanPersist] = useState(false);
  const [dialog, setDialog] = useState<"saved" | "you" | "council" | "circle" | "profile" | "plan" | "privacy" | "invite" | "search" | null>(null);
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [thread, setThread] = useState<Decision[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiProvider, setAiProvider] = useState("Nook AI");
  const [agentsAvailable, setAgentsAvailable] = useState(false);
  const [invitationToken, setInvitationToken] = useState("");
  const [acceptToken, setAcceptToken] = useState("");
  const [newTwinName, setNewTwinName] = useState("");
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [researchAvailable, setResearchAvailable] = useState(false);
  const [planReflection, setPlanReflection] = useState("");
  const [planDecision, setPlanDecision] = useState<Decision | null>(null);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [councilError, setCouncilError] = useState("");
  const requestController = useRef<AbortController | null>(null);
  const [team, setTeam] = useState<number | null>(null);
  const [selectedMember, setSelectedMember] = useState(0);
  const openTeam = (next: number | null) => { setTeam(next); setSelectedMember(0); };

  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [friend, setFriend] = useState("");
  const friendPlanStatus = plans[friend] || "pending";
  const [shared, setShared] = useState({ availability: true, preference: true });
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const hydration = setTimeout(() => {
    try {
      const raw = localStorage.getItem("nook.v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && !parsed.plans && ["pending", "saved", "declined"].includes(parsed.planStatus)) parsed.plans = { Maya: parsed.planStatus };
        const result = workspaceSchema.safeParse(parsed);
        if (result.success) { setProfile(result.data.profile); setOnboardingCompleted(result.data.onboardingCompleted); setDecisions(result.data.decisions); setPlans(result.data.plans); setFriends(result.data.friends); setCanPersist(true); }
        else setStorageError("corrupt");
      } else setCanPersist(true);
    } catch { setStorageError("corrupt"); }
    setReady(true);
    }, 0);
    return () => { clearTimeout(hydration); if (toastTimer.current) clearTimeout(toastTimer.current); requestController.current?.abort(); };
  }, []);
  useEffect(() => { if (ready && canPersist && onboardingCompleted) try { localStorage.setItem("nook.v1", JSON.stringify({ profile, onboardingCompleted, decisions, plans, friends: localFriends })); } catch { queueMicrotask(() => { setStorageError("unavailable"); setCanPersist(false); }); } }, [ready, canPersist, profile, onboardingCompleted, decisions, plans, localFriends]);
  const notify = (text: string) => { setToast(text); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(""), 4000); };
  const close = () => { setDialog(null); openTeam(null); };
  useEffect(() => { if (!mobileMenu) return; const listener = (e: KeyboardEvent) => { if (e.key === "Escape") { setMobileMenu(false); menuButton.current?.focus(); } }; document.addEventListener("keydown", listener); return () => document.removeEventListener("keydown", listener); }, [mobileMenu]);
  useEffect(() => { if (!busy && conversation && !dialog && team === null) composer.current?.focus(); }, [busy, conversation, dialog, team]);
  const edit = () => { setDraft({ ...profile, values: [...profile.values] }); setDialog("profile"); };
  const activate = () => { setConversation(true); };
  useEffect(() => { if (conversation) composer.current?.focus(); }, [conversation]);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy && !dialog && team === null) composer.current?.focus();
    wasBusy.current = busy;
  }, [busy, dialog, team]);
  useEffect(() => { threadEnd.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "end" }); }, [thread, busy, councilError]);
  useEffect(() => { const controller = new AbortController(); fetch("/api/chat", { signal: controller.signal }).then(r => r.ok ? r.json() as Promise<{ available: boolean; provider?: string; researchAvailable?: boolean; agentsAvailable?: boolean }> : null).then(s => { setAgentsAvailable(Boolean(s?.agentsAvailable)); setAiAvailable(Boolean(s?.available)); setLiveEnabled(Boolean(s?.available)); setAiProvider(s?.provider || "Nook AI"); setResearchAvailable(Boolean(s?.researchAvailable)); }).catch(() => {}); return () => controller.abort(); }, []);
  const circle = useTwinConnections(profile, ready && onboardingCompleted && agentsAvailable);
  const connectedNames = circle.connections.filter(connection => connection.phase === "active").flatMap(connection => connection.participants.filter(person => !person.isMe).map(person => person.displayName));
  const friends = [...new Set([...connectedNames, ...localFriends])];
  const addTwin = (name: string) => {
    const next = addCircleName(localFriends, name);
    if (next === localFriends || friends.some(friend => friend.toLowerCase() === name.trim().toLowerCase())) {
      notify(friends.length >= 100 ? "Your circle is full." : "This person is already in your circle.");
      return;
    }
    setFriends(next); setNewTwinName("");
    notify(`${name.trim()} added to your circle on this device.`);
  };
  const connectionProfile = () => ({ name: profile.name, priority: profile.priority, values: profile.values, weekend: profile.weekend, about: profile.about });
  const connectTwin = async (action: "invite" | "accept") => {
    if (connectionBusy) return;
    setConnectionBusy(true);
    try {
      const result = await connectionRequest(connectionProfile(), action, action === "accept" ? { invitationToken: acceptToken.trim() } : {});
      if (action === "invite") setInvitationToken(connectionViewSchema.parse(result).invitationToken || "");
      else {
        await circle.refresh();
        setAcceptToken(""); close(); notify("Twins connected. You can now invite or message them in chat.");
      }
    } catch (error) { notify(error instanceof Error ? error.message : "Could not connect your Twin."); }
    finally { setConnectionBusy(false); }
  };
  const unavailableMessage = aiAvailable ? "Live AI is switched off. Enable it in Privacy to start a conversation." : "Nook’s AI is unavailable. Connect an AI provider on the server to start a conversation; connect Exa for current web information.";
  const deliveryRequest = useRef<{ text: string; id: string } | null>(null);
  const askLive = async (text: string, history: { role: string; content: string }[] = [], requestId = crypto.randomUUID(), perspective?: "wellbeing" | "work" | "relationships") => {
    const controller = new AbortController(); requestController.current = controller;
    const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text.trim(), requestId, location: location.forRequest(), ...(perspective ? { perspective } : {}), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, profile: { name: profile.name, priority: profile.priority, values: profile.values, weekend: profile.weekend, about: profile.about }, history }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(65000)]) });
    const result = await response.json().catch(() => ({ error: "Nook returned an unreadable response. Please try again." })) as { error?: string };
    if (!response.ok) throw new Error(result.error || "Could not reach Nook. Please try again.");
    return liveChatSchema.parse(result);
  };
  const exploreTeam = async () => {
    if (team === null || !message.trim() || busy) return;
    if (!liveEnabled) { setReply(""); notify(unavailableMessage); return; }
    setBusy(true); setReply("");
    try { const result = await askLive(message, reply ? [{ role: "assistant", content: reply.slice(0, 2000) }] : [], crypto.randomUUID(), (["wellbeing", "work", "relationships"] as const)[team]); setReply(result.message); }
    catch (error) { if (!requestController.current?.signal.aborted) notify(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  };
  const explorePlan = async () => {
    if (busy || !liveEnabled || !shared.availability || !shared.preference) return;
    setBusy(true); setPlanReflection(""); setPlanDecision(null);
    try { const result = await askLive(`Help me plan an activity to discuss with ${friend}. Their availability, location, and preferences are unknown. Ask what you need to know before suggesting specific places. Do not impersonate them or their Twin.`); setPlanReflection(result.message); setPlanDecision({ id: crypto.randomUUID(), question: `Plan an activity to discuss with ${friend}`, kind: "social", saved: false, profileSnapshot: { ...profile, values: [...profile.values] }, ...result }); }
    catch (error) { if (!requestController.current?.signal.aborted) notify(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  };
  const consult = async (q: string) => {
    if (!q.trim() || busy) return;
    setCouncilError(""); close(); setConversation(true);
    if (!liveEnabled && !(agentsAvailable && agentMessageCommand(q))) { setQuestion(q.trim()); setCouncilError(unavailableMessage); return; }
    setQuestion(""); setPendingQuestion(q.trim()); setBusy(true);
    const snapshot = { ...profile, values: [...profile.values] };
    if (!deliveryRequest.current || deliveryRequest.current.text !== q.trim()) deliveryRequest.current = { text: q.trim(), id: crypto.randomUUID() };
    try {
      const result = await askLive(q, thread.slice(-3).flatMap(d => [{ role: "user", content: d.question.slice(0, 2000) }, { role: "assistant", content: (d.message || d.recommendation || "This saved turn has no reply.").slice(0, 2000) }]), deliveryRequest.current.id);
      const d: Decision = { id: crypto.randomUUID(), question: q.trim(), kind: classify(q), saved: false, profileSnapshot: snapshot, ...result };
      setThread(old => [...old, d]); setDecisions(old => [d, ...old].slice(0, 30)); setPendingQuestion(""); deliveryRequest.current = null;
    } catch (error) { if (requestController.current?.signal.aborted) return; setQuestion(q.trim()); setCouncilError(error instanceof Error ? error.message : "Could not reach Nook. Please try again."); }
    finally { setBusy(false); }
  };
  const showPlan = (name: string) => { setFriend(name); setShared({ availability: true, preference: true }); setPlanReflection(""); setPlanDecision(null); setDialog("plan"); };
  const saveDecision = (decision: Decision) => {
    setDecisions(old => [{ ...decision, saved: true }, ...old.filter(d => d.id !== decision.id)].slice(0, 30));
    setThread(old => old.map(d => d.id === decision.id ? { ...d, saved: true } : d));
    notify("Your next step is saved.");
  };
  const revisit = (decision: Decision) => { close(); setConversation(true); setThread(old => old.some(d => d.id === decision.id) ? old : [...old, decision]); setQuestion(""); };
  const newConversation = () => { if (busy) return; setThread([]); setQuestion(""); setCouncilError(""); setPendingQuestion(""); deliveryRequest.current = null; setConversation(false); };
  const agentWorkspace = useRef({ onboarded: onboardingCompleted, busy, liveEnabled, savedCount: decisions.filter(d => d.saved).length, connectionCount: connectedNames.length });
  useEffect(() => { agentWorkspace.current = { onboarded: onboardingCompleted, busy, liveEnabled, savedCount: decisions.filter(d => d.saved).length, connectionCount: connectedNames.length }; }, [onboardingCompleted, busy, liveEnabled, decisions, connectedNames.length]);
  useEffect(() => {
    type BrowserTool = { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => unknown };
    const context = (document as Document & { modelContext?: { registerTool: (tool: BrowserTool, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: BrowserTool) => { try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Browser tools are optional; the UI remains usable. */ } };
    register({ name: "read_nook_workspace_status", description: "Read local workspace counts and council mode without exposing private profile content or saved questions.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute(input) { if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) throw new Error("Expected an empty object."); return { savedReflections: agentWorkspace.current.savedCount, connectionCount: agentWorkspace.current.connectionCount, councilMode: agentWorkspace.current.liveEnabled ? "live" : "unavailable", friendAgents: agentWorkspace.current.connectionCount ? "connected" : "not_connected" }; } });
    register({ name: "prepare_nook_question", description: "Prepare a question in the visible composer for human review. Does not submit it, invoke AI, or contact anyone.", inputSchema: { type: "object", properties: { question: { type: "string", minLength: 1, maxLength: 1000 } }, required: ["question"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, async execute(input) { if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1) throw new Error("Expected only a question."); const question = (input as { question?: unknown }).question; if (typeof question !== "string" || !question.trim() || question.length > 1000) throw new Error("Provide a question under 1,000 characters."); if (!agentWorkspace.current.onboarded) throw new Error("Complete your Twin introduction first."); if (agentWorkspace.current.busy) throw new Error("Wait for the current reflection to finish."); setDialog(null); openTeam(null); setConversation(true); setQuestion(question.trim()); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); return { status: "prepared", submitted: false }; } });
    return () => lifecycle.abort();
  }, []);
  if (!ready) return <main className="onboarding-loading" role="status">Opening your space…</main>;
  if (!onboardingCompleted) return <Onboarding initialProfile={profile} storageError={storageError} onComplete={next => { setProfile(next); setOnboardingCompleted(true); }} />;
  return <div className={`nook-app ${conversation ? "conversation-open" : ""}`}>
    <header className="nook-toolbar"><button className="brand-button" onClick={newConversation} disabled={busy} aria-label="Nook home"><Brand small /></button><div className="nook-utilities"><button onClick={() => setDialog("search")}><Search size={17} /><span>Search users</span></button><a href="/twins" className="text-button"><Users size={17} /><span>Twins map</span></a><button onClick={() => setDialog("saved")}><BookOpen size={17} /><span>Saved</span></button><button onClick={() => setDialog("you")}><Fingerprint size={18} /><span>You</span></button></div><button className="icon-button nook-mobile-search" aria-label="Search users" onClick={() => { setMobileMenu(false); setDialog("search"); }}><Search size={21} /></button><button ref={menuButton} className="icon-button nook-hamburger" aria-label={mobileMenu ? "Close menu" : "Open menu"} aria-expanded={mobileMenu} aria-controls="nook-mobile-menu" onClick={() => setMobileMenu(!mobileMenu)}>{mobileMenu ? <X size={22} /> : <Menu size={22} />}</button></header>
    {mobileMenu && <nav className="nook-mobile-menu" id="nook-mobile-menu" aria-label="More options"><button onClick={() => { setMobileMenu(false); setDialog("search"); }}>Search users<Search size={16} /></button><a href="/twins" className="text-button" onClick={() => setMobileMenu(false)}>Twins map<ChevronRight size={16} /></a>{[{ label: "Saved reflections", target: "saved" }, { label: "Your Twin preferences", target: "you" }, { label: "Privacy & live AI", target: "privacy" }].map(item => <button key={item.target} onClick={() => { setMobileMenu(false); setDialog(item.target as "saved" | "you" | "privacy"); }}>{item.label}<ChevronRight size={16} /></button>)}</nav>}
    <div className="nook-workspace">
    <main className="nook-canvas">
      <LocationPermission control={location} />
      {!conversation ? <section className="nook-idle"><button className="nook-orb" onClick={activate} aria-label="Talk to Nook"><span className="nook-orb-core" aria-hidden="true"><i /><i /><i /><i /></span></button><span className="nook-orb-caption">A LITTLE SPACE, JUST FOR YOU</span><h1>What’s on your mind, {profile.name}?</h1><p>Dinner plans. A new idea. Whatever’s on your mind.</p><button className="nook-start" onClick={activate}>Talk to Nook</button><span className="nook-idle-hint">A conversation that starts with you.</span></section> : <section className="nook-conversation">
        <div className="nook-conversation-header"><div><button className="nook-mini-orb" onClick={newConversation} disabled={busy} aria-label="Return to Nook"><span aria-hidden="true">n</span></button><span><strong>Nook</strong><small>{liveEnabled ? "Your AI companion" : "AI unavailable"}</small></span></div><button className="text-button" onClick={newConversation} disabled={busy}>New conversation</button></div>
        <div className="nook-thread" role="log" aria-live="polite" aria-relevant="additions" aria-label="Your conversation">
          {!thread.length && !busy && <div className="conversation-welcome"><h2>Let’s make a little room.</h2><p>Tell me what you’re thinking about. We’ll find a next step together.</p><div className="prompt-suggestions">{examples.map(q => <button key={q} onClick={() => consult(q)}>{q}<ChevronRight size={16} /></button>)}</div></div>}
          {thread.map(d => <article className="chat-turn" key={d.id}><p className="chat-question">{d.question}</p>{d.message ? <section className="chat-answer"><span className="chat-assistant-name"><Sparkles size={14} /> Nook</span><div className="chat-answer-body">{d.message.split(/\n\s*\n/).filter(Boolean).map((paragraph, index) => <p key={index}><ChatText text={paragraph} sources={d.sources} /></p>)}</div>{Boolean(d.sources?.length) && <div className="chat-sources"><span className="eyebrow">SOURCES</span>{d.sources?.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer"><strong>{source.title}</strong><small>{new URL(source.url).hostname}</small><ChevronRight size={15} /></a>)}</div>}{d.researchStatus && <p className="chat-research-status">{d.researchStatus === "retrieved" || d.researchStatus === "complete" ? "Searched the web with Exa · see linked sources" : d.researchStatus === "unavailable" ? "Web research was unavailable for this reply." : d.researchStatus === "off" ? "No live web research was used for this reply." : "No web search needed for this reply."}</p>}<div className="reflection-actions"><button className="text-button" disabled={d.saved} onClick={() => saveDecision(d)}><Check size={15} />{d.saved ? "Saved" : "Save reply"}</button><button className="text-button" onClick={() => { setQuestion(d.question); composer.current?.focus(); }}>Revisit</button></div></section> : <section className="reflection-card"><div className="reflection-heading"><span className="eyebrow"><Sparkles size={14} /> A THOUGHTFUL NEXT STEP</span><span>{d.mode === "live" ? "Live" : "Sample"}</span></div><h3>{d.recommendation || "This older reflection has no saved reply. Revisit the question to talk it through with Nook."}</h3><p className="reflection-values">Guided by {(d.profileSnapshot || profile).values.join(" · ")}</p><details className="reflection-perspectives"><summary>See the different perspectives <ChevronRight size={15} /></summary><div className="opinion-list">{(d.opinions || []).map((o, i) => { const t = teams[i]; return <article className="opinion" key={t.name}><button className={`lens-icon ${t.color}`} aria-label={`Meet the ${t.name} team`} onClick={() => { openTeam(i); setMessage(""); setReply(""); }}><t.icon size={20} /></button><div><div className="opinion-title"><h4>{t.name}</h4><span>{o.stance}</span></div><h4>{o.title}</h4><p>{o.opinion}</p></div></article>; })}</div></details><details className="critic-note"><summary>A counterpoint worth keeping</summary><p>{d.critique || "This is a starting point, based on the preferences you shared. Check the practical details and talk with anyone affected before deciding."}</p></details><div className="reflection-actions"><button className="text-button" disabled={d.saved} onClick={() => saveDecision(d)}><Check size={15} />{d.saved ? "Saved" : "Save next step"}</button><button className="text-button" onClick={() => { setQuestion(d.question); composer.current?.focus(); }}>Revisit</button></div></section>}</article>)}
          {busy && <div className="chat-turn"><p className="chat-question">{pendingQuestion}</p><div className="thinking" role="status"><span className="thinking-icon"><Sparkles size={22} /></span><p>Thinking through your request…</p></div></div>}
          {councilError && <p className="council-error" role="alert">{councilError}</p>}<div ref={threadEnd} />
        </div>
        <div className="nook-composer-dock"><form className="nook-composer" onSubmit={e => { e.preventDefault(); consult(question); }}><label className="sr-only" htmlFor="question">Message Nook</label><textarea ref={composer} id="question" rows={1} value={question} maxLength={1000} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); consult(question); } }} placeholder="What’s on your mind?" /><button className="icon-button send-button" aria-label="Send message" disabled={busy || !question.trim()}><ArrowUp size={20} /></button></form><div className="composer-meta"><span>{liveEnabled ? researchAvailable ? "Live AI · Exa web research connected" : "Live AI · web research unavailable" : "AI unavailable · open Privacy for connection details"}</span><button onClick={() => setDialog("privacy")}><MapPin size={11} />{location.status === "enabled" ? "Location on" : "Location"}</button><button onClick={() => setDialog("privacy")}>Privacy <LockKeyhole size={11} /></button></div></div>
      </section>}
      {storageError && <p className="storage-warning" role="status">{storageError === "corrupt" ? "Saved data could not be read. Your previous data is preserved; new changes will last for this session until you reset local data." : "Browser storage is unavailable. Changes will last for this session only."}</p>}
    </main>
    <TwinActivity directory={<SystemTwins twins={circle.directory} available={agentsAvailable} loading={circle.loading} error={circle.error} busy={circle.actionBusy} actionError={circle.actionError} refresh={circle.refresh} onAction={circle.actOnTwin} />} connectedNames={connectedNames} messages={circle.messages} onOpenInbox={() => { void circle.refresh(); setDialog("circle"); }} friends={friends} plans={plans} onReviewPlan={showPlan} onExploreAgent={name => { setDialog(null); openTeam(2); setMessage(`Help me prepare a plan to discuss with ${name}. Their availability and preferences are unknown. What should I ask them?`); setReply(""); }} onAddConnection={() => { setFriend(""); openTeam(null); setDialog("invite"); }} />
    </div>
    <nav className="nook-bottom-nav" aria-label="Mobile navigation"><button className={!dialog && team === null ? "active" : ""} onClick={() => { close(); setMobileMenu(false); if (!busy) newConversation(); }}><Sun size={21} /><span>Today</span></button><button className={dialog === "council" || team !== null ? "active" : ""} onClick={() => { setMobileMenu(false); openTeam(null); setDialog("council"); }}><Compass size={21} /><span>Council</span></button><button className={dialog === "circle" || dialog === "plan" ? "active" : ""} onClick={() => { setMobileMenu(false); openTeam(null); void circle.refresh(); setDialog("circle"); }}><Users size={21} /><span>Circle</span></button><button className={dialog === "you" || dialog === "profile" ? "active" : ""} onClick={() => { setMobileMenu(false); openTeam(null); setDialog("you"); }}><Fingerprint size={21} /><span>My Twin</span></button></nav>
    {dialog === "council" && <Modal title="Your personal council." onClose={close}><p className="modal-description">Good advice isn’t always agreement. Your wellbeing, ambition, and relationships each deserve a perspective.</p><div className="council-grid">{teams.map((t, i) => <button className="council-card" key={t.name} onClick={() => { setDialog(null); openTeam(i); setMessage(""); setReply(""); }}><span className={`lens-icon ${t.color}`}><t.icon size={22} /></span><div><h3>{t.name}</h3><p className="council-role">{t.specialty}</p><p className="council-quote">{t.insight}</p></div><ChevronRight size={17} /></button>)}</div><button className="primary-button council-start" onClick={() => { close(); activate(); }}><Sparkles size={16} /> Bring a question to your council</button></Modal>}
    {dialog === "circle" && <Modal title="Your people. A little closer." onClose={close}><p className="modal-description">Explore a shared plan with a friend’s Twin. Connect your Twins to send invitations and messages through chat.</p><section className="utility-section">{friends.map(name => <button className="utility-row" key={name} onClick={() => showPlan(name)}><Users size={18} /><span>{name}’s Twin<small>{connectedNames.includes(name) ? "Twin connected" : "Saved locally"} · {plans[name] === "saved" ? "Plan saved" : plans[name] === "declined" ? "Set aside" : "Plan to explore"}</small></span><ChevronRight size={16} /></button>)}</section><button className="secondary-button" onClick={() => { setFriend(""); setDialog("invite"); }}><Plus size={17} /> Connect a Twin</button>{agentsAvailable && <AgentInbox messages={circle.messages} connections={circle.connections} profile={profile} error={circle.error} loading={circle.loading} refresh={circle.refresh} />}</Modal>}
    {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
    {dialog === "saved" && <Modal title="Room to come back to." onClose={close}><p className="modal-description">Your reflections and plans, kept on this device.</p><section className="utility-section"><h3>Reflections</h3>{decisions.length ? <div className="saved-list">{decisions.map(d => <button key={d.id} className="decision-row" onClick={() => revisit(d)}><span className="row-icon"><BookOpen size={18} /></span><span>{d.question}<small>{d.saved ? "Saved next step" : "Recent reflection"}</small></span><ChevronRight size={16} /></button>)}</div> : <p className="subtle">A conversation is a good place to start. Your reflections will appear here.</p>}</section><section className="utility-section"><h3>Your plans</h3>{friends.map(name => <button className="utility-row" key={name} onClick={() => showPlan(name)}><Users size={17} /><span>A plan with {name}<small>{plans[name] === "saved" ? "Saved plan" : plans[name] === "declined" ? "Set aside" : "Plan to explore"}</small></span><ChevronRight size={16} /></button>)}</section></Modal>}
    {dialog === "you" && <Modal title="A little more you." onClose={close}><div className="you-summary"><Avatar text={profile.name.slice(0, 2).toUpperCase()} color="you-avatar" /><h3>{profile.name}</h3><p>{profile.priority}</p><div className="twin-values you-values">{profile.values.map(v => <span key={v}>{v}</span>)}</div><button className="secondary-button" onClick={edit}><SlidersHorizontal size={16} /> Edit your preferences</button></div><section className="utility-section"><h3>Your perspectives</h3>{teams.map((t, i) => <button className="utility-row" key={t.name} onClick={() => { setDialog(null); openTeam(i); setMessage(""); setReply(""); }}><span className={`lens-icon ${t.color}`}><t.icon size={19} /></span><span>{t.name}<small>{t.specialty}</small></span><ChevronRight size={16} /></button>)}</section><section className="utility-section"><h3>Your people</h3>{friends.map(name => <button className="utility-row" key={name} onClick={() => showPlan(name)}><Users size={17} /><span>{name}<small>{connectedNames.includes(name) ? "Twin connected" : "Saved locally"}</small></span><ChevronRight size={16} /></button>)}<button className="text-button" onClick={() => { setFriend(""); setDialog("invite"); }}><Plus size={16} /> Add a connection</button></section><button className="utility-row" onClick={() => setDialog("privacy")}><ShieldCheck size={18} /><span>Privacy & live AI<small>{liveEnabled ? "Live council enabled" : "AI unavailable"}</small></span><ChevronRight size={16} /></button></Modal>}
  {team !== null && <Modal title={teams[team].name} onClose={close} wide>
    <div className={`team-overview ${teams[team].color}`}>
      <span className={`lens-icon ${teams[team].color}`}>{(() => { const Icon = teams[team].icon; return <Icon size={24} />; })()}</span>
      <div><p>{teamDetails[team].purpose}</p><span className="team-mode"><span /> {liveEnabled ? `${aiProvider} · live perspectives` : "AI unavailable"}</span></div>
    </div>
    <section className="team-goal"><span className="eyebrow">GUIDED BY YOUR PRIORITY</span><p>{profile.priority}</p><div className="twin-values">{profile.values.map(value => <span key={value}>{value}</span>)}</div></section>
    <section className="team-section"><div className="team-section-heading"><h3>Meet your team</h3><span>AI perspectives</span></div>
      <div className="team-member-options">{teams[team].members.map((member, index) => <button key={member} aria-pressed={selectedMember === index} onClick={() => setSelectedMember(index)}><Avatar text={teams[team].people[index]} color={teams[team].color} /><strong>{member.split(" · ")[0]}</strong><small>{member.split(" · ")[1]}</small></button>)}</div>
      <div className="team-member-note"><span className="eyebrow">EXPLORE WITH {teams[team].members[selectedMember].split(" · ")[0].toUpperCase()}</span><p>{teamDetails[team].prompts[selectedMember]}</p><button className="text-button" onClick={() => { setMessage(teamDetails[team].prompts[selectedMember]); document.getElementById("message")?.focus(); }}>Use this question <ArrowUp size={15} /></button></div>
    </section>
    <section className="team-section"><div className="team-section-heading"><h3>Where would you like to focus?</h3></div><div className="team-focus-options">{teamDetails[team].focus.map(focus => <button key={focus} onClick={() => { setMessage(`Help me ${focus.toLowerCase()}.`); document.getElementById("message")?.focus(); }}>{focus}<Plus size={14} /></button>)}</div></section>
    <section className="team-section team-next-steps"><h3>A way forward</h3><ol>{teamDetails[team].steps.map(step => <li key={step}>{step}</li>)}</ol></section>
    <div className="team-conversation"><form onSubmit={e => { e.preventDefault(); void exploreTeam(); }}><label className="field-label" htmlFor="message">What would you like to explore?</label><div className="team-message-input"><textarea id="message" value={message} onChange={e => setMessage(e.target.value)} placeholder="Share a situation with this team…" maxLength={1000} rows={2} required /><button className="icon-button send-button" aria-label={liveEnabled ? "Get a live perspective" : "Send to your team"} disabled={busy || !message.trim()}><ArrowUp size={20} /></button></div></form>
    {busy && <p role="status">Your team is reflecting…</p>}
    {reply && <div className="team-reply" role="status"><span className="eyebrow">{liveEnabled ? "A LIVE PERSPECTIVE" : "AI UNAVAILABLE"}</span><p>{reply}</p><button className="text-button" onClick={() => consult(message)} disabled={busy}>Bring this to the whole council <ChevronRight size={16} /></button></div>}
    <p className="preview-note">{liveEnabled ? "Live AI personas · reasoning perspectives, not professional advisers" : "Connect live AI to speak with this team."}</p></div>
  </Modal>}
  {dialog === "profile" && <Modal title="Shape what your Twin knows." onClose={close}><p className="modal-description">Start with the things that matter. You can change your mind anytime.</p><form onSubmit={e => { e.preventDefault(); const result = profileSchema.safeParse(draft); if (!result.success) return; setProfile(result.data); close(); notify("Your Twin preferences have been updated."); }}><label className="field-label" htmlFor="name">What should we call you?</label><input id="name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} maxLength={30} required /><label className="field-label" htmlFor="priority">What matters most right now?</label><textarea id="priority" value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value })} maxLength={240} rows={3} required /><span className="field-label">Choose your values</span><div className="value-options">{["Wellbeing", "Meaningful work", "Time with people", "Learning", "Freedom", "Financial stability"].map(v => <button type="button" key={v} aria-pressed={draft.values.includes(v)} className={draft.values.includes(v) ? "selected" : ""} onClick={() => setDraft({ ...draft, values: draft.values.includes(v) ? draft.values.filter(x => x !== v) : [...draft.values, v] })}>{draft.values.includes(v) && <Check size={14} />}{v}</button>)}</div><label className="checkbox-row"><input type="checkbox" checked={draft.weekend} onChange={e => setDraft({ ...draft, weekend: e.target.checked })} /><span>Protect my weekends for rest and my people.</span></label><ProfileDetails profile={draft} onChange={setDraft} /><div className="form-actions"><span className="subtle">Saved only on this device</span><button className="primary-button" disabled={!draft.name.trim() || !draft.priority.trim() || !draft.values.length}>Save my preferences</button></div></form></Modal>}
  {dialog === "plan" && <Modal title="Make a plan together." onClose={close}><p className="preview-note">{liveEnabled ? `Plan an activity to discuss with ${friend}` : "AI unavailable"}</p>{liveEnabled ? <section className="proposed-plan"><h3>A plan to explore together</h3><p>{planReflection || "Generate a suggestion guided by your preferences, then confirm the details with your friend."}</p><button className="secondary-button" disabled={busy || !shared.availability || !shared.preference} onClick={() => void explorePlan()}>{busy ? "Your Twin is planning…" : planReflection ? "Generate another suggestion" : "Suggest a plan with AI"}</button></section> : <p className="council-error">{unavailableMessage}</p>}<section className="sharing-box"><h4><ShieldCheck size={16} /> You choose what to share</h4><label className="checkbox-row"><input type="checkbox" checked={shared.availability} onChange={e => setShared({ ...shared, availability: e.target.checked })} /><span>Share availability when known</span></label><label className="checkbox-row"><input type="checkbox" checked={shared.preference} onChange={e => setShared({ ...shared, preference: e.target.checked })} /><span>Share activity preferences when known</span></label><small>Your personal memories, health, and finances stay private.</small></section><p className="preview-note">Saving records your interest locally. {friend} has not been contacted and no booking is made.</p><div className="form-actions"><button className="text-button" onClick={() => { setPlans(old => ({ ...old, [friend]: "declined" })); close(); notify("The plan is set aside."); }}>Maybe another time</button><button className="primary-button" disabled={!shared.availability || !shared.preference || friendPlanStatus === "saved" || !liveEnabled || !planReflection} onClick={() => { setPlans(old => ({ ...old, [friend]: "saved" })); if (planDecision) saveDecision(planDecision); close(); notify("Plan saved. No message has been sent."); }}><Check size={16} />{friendPlanStatus === "saved" ? "Plan saved" : "Save this plan"}</button></div>{(!shared.availability || !shared.preference) && <p className="preview-note">Both details are needed to generate a plan. You can keep them private and set the plan aside.</p>}</Modal>}
  {dialog === "privacy" && <Modal title="Your space stays yours." onClose={close}>{[{ icon: LockKeyhole, title: "On this device", text: "Your workspace is saved in this browser’s local storage. No sign-in is required: a private browser cookie keeps your Twin identity and connections separate from other visitors. Clearing that cookie loses access to that guest Twin. When you are signed in, Nook uses your signed-in identity. Live council processing is separate: when enabled, your question, recent conversation, and your stated preferences and about-you answers are sent to the configured AI service through Nook’s server. Profile links stay on this device; Nook does not import social account data." }, { icon: Sparkles, title: "A transparent first version", text: "Replies come from the configured AI provider. Exa can retrieve current web information and source links when connected. If a service is unavailable, Nook tells you. Connected Twins can exchange messages through their inboxes. Calendars and bookings are not connected." }, { icon: ShieldCheck, title: "You choose what leaves your space", text: "Plan review previews scoped sharing. Explicit invitation and message commands send your message to the connected person’s Twin inbox. Your private profile and memories are not included. AI requests use the information described above." }].map(p => <div className="privacy-item" key={p.title}><p.icon size={22} /><div><h3>{p.title}</h3><p>{p.text}</p></div></div>)}<LocationPermission control={location} settings /><section className="live-setting"><h3>Live AI & web research</h3><p>{aiAvailable ? "An AI service is configured. When enabled, your question, recent conversation, and stated Twin preferences are sent to the configured AI service through Nook’s server to answer your request. When you allow location, approximate coordinates also accompany AI requests and may be included in Exa search queries. Location stays in memory for this session and expires after 15 minutes." : "AI is unavailable. Configure the Nook backend or an AI provider key on the server. Configure Exa to enable current web research."}</p><label className="checkbox-row"><input type="checkbox" checked={liveEnabled} disabled={!aiAvailable} onChange={e => setLiveEnabled(e.target.checked)} /><span>Use live AI for conversations, perspectives, and plans</span></label></section><button className="secondary-button" onClick={() => { try { localStorage.removeItem("nook.v1"); setCanPersist(true); setStorageError(null); } catch { setStorageError("unavailable"); setCanPersist(false); } requestController.current?.abort(); setBusy(false); setLiveEnabled(false); location.disable(); setProfile(initial); setOnboardingCompleted(false); setDecisions([]); setThread([]); setQuestion(""); setPendingQuestion(""); setCouncilError(""); setConversation(false); setPlans({}); setFriends([]); setInvitationToken(""); setAcceptToken(""); close(); notify("This device’s workspace has been reset."); }}>Reset local workspace</button></Modal>}
  {dialog === "search" && <Modal title="Find your people." onClose={close}><SystemTwins autoFocus twins={circle.directory} available={agentsAvailable} loading={circle.loading} error={circle.error} busy={circle.actionBusy} actionError={circle.actionError} refresh={circle.refresh} onAction={circle.actOnTwin} /></Modal>}
  {dialog === "invite" && <Modal title="Connect your Twins." onClose={close}><SystemTwins twins={circle.directory} available={agentsAvailable} loading={circle.loading} error={circle.error} busy={circle.actionBusy} actionError={circle.actionError} refresh={circle.refresh} onAction={circle.actOnTwin} /><section className="utility-section"><h3>Add someone you know</h3><form onSubmit={e => { e.preventDefault(); addTwin(newTwinName); }}><label className="field-label" htmlFor="new-twin-name">Their name</label><input id="new-twin-name" value={newTwinName} onChange={e => setNewTwinName(e.target.value)} placeholder="e.g. Alex" maxLength={30} required /><div className="form-actions"><span className="subtle">Saved on this device</span><button className="secondary-button" disabled={!newTwinName.trim() || localFriends.length >= 100}><Plus size={16} /> Add to circle</button></div></form></section><section className="utility-section"><h3>Connect a live Twin</h3><p className="modal-description">Connect with someone’s Twin, then say “invite Maya for dinner” or “message Maya: hello” in chat.</p>{agentsAvailable ? <><button className="secondary-button" disabled={connectionBusy} onClick={() => connectTwin("invite")}><Plus size={16} /> Create connection invitation</button>{invitationToken && <><p className="modal-description">Share this invitation code with them. It expires in 24 hours and can be accepted once.</p><input aria-label="Your connection invitation code" value={invitationToken} readOnly onFocus={e => e.target.select()} /><button type="button" className="text-button" onClick={() => { void navigator.clipboard.writeText(invitationToken).then(() => notify("Invitation code copied.")).catch(() => notify("Select the code and copy it manually.")); }}>Copy invitation code</button></>}<form onSubmit={e => { e.preventDefault(); void connectTwin("accept"); }}><label className="field-label" htmlFor="accept-token">Accept their invitation code</label><input id="accept-token" value={acceptToken} onChange={e => setAcceptToken(e.target.value)} placeholder="Paste their connection code" autoComplete="off" spellCheck={false} maxLength={100} required /><div className="form-actions"><button className="primary-button" disabled={connectionBusy || acceptToken.trim().length !== 43}>Connect Twins</button></div></form></> : <p className="modal-description">Live Twin connections are not available yet. You can add people to your circle and explore plans now. Invitations and messages become available when the Nook agent backend is connected.</p>}</section></Modal>}
  </div>;
}
