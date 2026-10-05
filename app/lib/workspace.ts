import { z } from "zod";
const link = (host?: string) => z.string().trim().max(300).refine(value => {
  if (!value) return true;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && (!host || url.hostname === host || url.hostname.endsWith(`.${host}`)); } catch { return false; }
}, "Enter a valid profile URL (https://…).");
export const socialSchema = z.object({ linkedin: link("linkedin.com").default(""), instagram: link("instagram.com").default(""), website: link().default("") });
export const profileSchema = z.object({ name: z.string().trim().min(1).max(30), priority: z.string().trim().min(1).max(240), values: z.array(z.string().min(1).max(40)).min(1).max(10), weekend: z.boolean(), about: z.string().trim().max(600).default(""), social: socialSchema.default({}) });
export const opinionSchema = z.object({ title: z.string().min(1).max(150), opinion: z.string().min(1).max(1500), stance: z.string().min(1).max(80) });
export const liveCouncilSchema = z.object({ opinions: z.array(opinionSchema).length(3), recommendation: z.string().min(1).max(2000), critique: z.string().min(1).max(1500), mode: z.literal("live") });
export const chatSourceSchema = z.object({ title: z.string().min(1).max(300), url: z.string().max(2000).url().refine(value => { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }), highlights: z.array(z.string().max(3000)).max(4).default([]) });
export const researchStatusSchema = z.enum(["off", "retrieved", "unavailable"]);
export const liveChatSchema = z.object({ message: z.string().trim().min(1).max(6000), sources: z.array(chatSourceSchema).max(6), researchStatus: researchStatusSchema, mode: z.literal("live") });
export const decisionSchema = z.object({ id: z.string().min(1).max(100), question: z.string().min(1).max(1000), kind: z.enum(["balance", "opportunity", "social", "reflection"]), saved: z.boolean(), opinions: z.array(opinionSchema).length(3).optional(), recommendation: z.string().max(2000).optional(), critique: z.string().max(1500).optional(), message: z.string().max(6000).optional(), sources: z.array(chatSourceSchema).max(6).optional(), researchStatus: researchStatusSchema.optional(), mode: z.enum(["live", "preview"]).optional(), profileSnapshot: profileSchema.optional() });
export const workspaceSchema = z.object({ profile: profileSchema, onboardingCompleted: z.boolean().default(false), decisions: z.array(decisionSchema).max(30), plans: z.record(z.enum(["pending", "saved", "declined"])).default({}), friends: z.array(z.string().trim().min(1).max(30)).max(100).default([]) });

export type Profile = z.infer<typeof profileSchema>;

export const connectionViewSchema = z.object({ id: z.string().uuid(), phase: z.enum(["invited", "active", "revoked"]), participants: z.array(z.object({ id: z.string().uuid(), displayName: z.string(), isMe: z.boolean().default(false) })), invitationToken: z.string().optional() });
export type TwinConnection = z.infer<typeof connectionViewSchema>;

export const agentInboxSchema = z.array(z.object({ id: z.string().uuid(), senderId: z.string().uuid(), senderName: z.string(), connectionId: z.string().uuid(), content: z.string().min(1).max(1000), kind: z.enum(["invitation", "message"]), createdAt: z.string() }));
export type AgentMessage = z.infer<typeof agentInboxSchema>[number];

export const deliveryReceiptSchema = z.object({ id: z.string().uuid(), status: z.literal("delivered") });
