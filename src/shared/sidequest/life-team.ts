import { z } from 'zod'

export const lifeAgentIds = [
  'health',
  'work',
  'growth',
  'people',
  'discovery',
  'admin',
  'money'
] as const
export const lifeAgentIdSchema = z.enum(lifeAgentIds)
export type LifeAgentId = z.infer<typeof lifeAgentIdSchema>
export const lifeAgents: Record<LifeAgentId, { name: string; role: string; goal: string }> = {
  health: {
    name: 'Health & energy',
    role: 'Healthy routines, movement, sleep and recovery',
    goal: 'Make room for healthy routines and recovery.'
  },
  work: {
    name: 'Work & projects',
    role: 'Important work, unfinished projects and career progress',
    goal: 'Help me make progress on personal projects and hackathon collaboration.'
  },
  growth: {
    name: 'Personal growth',
    role: 'Learning, practice and useful experiments',
    goal: 'Learn something useful through practice.'
  },
  people: {
    name: 'People',
    role: 'Time with friends, family and consenting collaborators',
    goal: 'Find new places and shared activities to enjoy with friends.'
  },
  discovery: {
    name: 'Discovery',
    role: 'New ideas, research, places and experiences',
    goal: 'Investigate useful GitHub repositories, state-of-the-art papers and ideas worth trying.'
  },
  admin: {
    name: 'Life admin',
    role: 'Errands, preparation and unfinished everyday tasks',
    goal: 'Reduce unfinished errands and life admin.'
  },
  money: {
    name: 'Everyday money',
    role: 'Spending awareness and practical budget constraints',
    goal: 'Keep everyday spending within my budget.'
  }
}
export const lifeAgentConfigSchema = z.object({
  id: lifeAgentIdSchema,
  enabled: z.boolean(),
  priority: z.number().int().min(1).max(3),
  goal: z.string().trim().min(3).max(1200)
})
export const lifeTeamSettingsSchema = z.object({
  focus: z.string().trim().min(3).max(1200),
  availableMinutes: z.number().int().min(10).max(480),
  budget: z.number().min(0).max(2000),
  energy: z.enum(['low', 'steady', 'high']),
  research: z.boolean()
})
export const lifeTeamProposalSchema = z.object({
  title: z.string().trim().min(3).max(180),
  detail: z.string().trim().min(3).max(1600),
  minutes: z.number().int().min(5).max(120),
  cost: z.number().min(0).max(2000),
  energy: z.enum(['low', 'steady', 'high'])
})
export const lifeTeamSourceSchema = z.object({ title: z.string().max(300), url: z.string().url() })
export const lifeAgentReportSchema = z.object({
  agentId: lifeAgentIdSchema,
  phase: z.enum(['queued', 'researching', 'ready', 'failed']),
  title: z.string().max(180),
  summary: z.string().max(5000),
  mode: z.enum(['local', 'ai']),
  researchStatus: z.enum(['off', 'retrieved', 'unavailable']),
  sources: z.array(lifeTeamSourceSchema).max(8),
  proposals: z.array(lifeTeamProposalSchema).max(3),
  artifactPath: z.string().optional(),
  error: z.string().max(500).optional()
})
export const lifeTeamPlanSchema = z.object({
  summary: z.string().max(2000),
  steps: z
    .array(
      lifeTeamProposalSchema.extend({
        id: z.string(),
        agentId: lifeAgentIdSchema,
        done: z.boolean()
      })
    )
    .max(3),
  deferred: z.array(z.object({ agentId: lifeAgentIdSchema, reason: z.string().max(500) })).max(7),
  totalMinutes: z.number().min(0),
  totalCost: z.number().min(0)
})
export const lifeTeamRunSchema = z.object({
  id: z.string(),
  phase: z.enum(['running', 'ready', 'failed']),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  settings: lifeTeamSettingsSchema,
  agents: z.array(lifeAgentConfigSchema).max(7),
  reports: z.array(lifeAgentReportSchema).max(7),
  plan: lifeTeamPlanSchema.nullable(),
  error: z.string().max(500).optional()
})
export const lifeTeamStateSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().min(0),
  settings: lifeTeamSettingsSchema,
  agents: z.array(lifeAgentConfigSchema).length(7),
  lastRun: lifeTeamRunSchema.nullable(),
  projectIntentions: z.record(z.string(), z.string()).default({})
})
export type LifeAgentConfig = z.infer<typeof lifeAgentConfigSchema>
export type LifeTeamSettings = z.infer<typeof lifeTeamSettingsSchema>
export type LifeTeamProposal = z.infer<typeof lifeTeamProposalSchema>
export type LifeAgentReport = z.infer<typeof lifeAgentReportSchema>
export type LifeTeamPlan = z.infer<typeof lifeTeamPlanSchema>
export type LifeTeamRun = z.infer<typeof lifeTeamRunSchema>
export type LifeTeamState = z.infer<typeof lifeTeamStateSchema>
export type LifeTeamSnapshot = LifeTeamState & { aiEnabled: boolean; researchEnabled: boolean }

export function defaultLifeTeamState(): LifeTeamState {
  return {
    schemaVersion: 1,
    revision: 0,
    settings: {
      focus:
        'Act as my personal assistants: do the research and preparation so I have more time for what matters.',
      availableMinutes: 60,
      budget: 0,
      energy: 'steady',
      research: true
    },
    agents: lifeAgentIds.map((id) => ({
      id,
      enabled: true,
      priority: id === 'health' || id === 'work' ? 3 : 2,
      goal: lifeAgents[id].goal
    })),
    lastRun: null,
    projectIntentions: {}
  }
}

export type LifeTeamApi = {
  read(): Promise<LifeTeamSnapshot>
  configure(input: {
    expectedRevision: number
    settings: LifeTeamSettings
    agents: LifeAgentConfig[]
  }): Promise<LifeTeamSnapshot>
  start(input: { expectedRevision: number }): Promise<LifeTeamSnapshot>
  check(input: { runId: string; stepId: string; done: boolean }): Promise<LifeTeamSnapshot>
  project(input: { agentId: LifeAgentId | 'coordinator' }): Promise<{ intentionId: string }>
}
