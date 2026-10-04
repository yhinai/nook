import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { Store } from './store.js'
import { fresh } from './store.js'
import { memoryInput, memorySchema, twinSchema, userSchema, type Memory } from './contracts.js'
import { insist } from './errors.js'

export function isCurrent(memory: Memory, now = Date.now()): boolean {
  return memory.status === 'confirmed' && (!memory.expiresAt || Date.parse(memory.expiresAt) > now)
}
export function register(store: Store, input: unknown) {
  const { displayName } = z
    .object({ displayName: z.string().trim().min(1).max(100) })
    .strict()
    .parse(input)
  return store.transaction(() => {
    const ownerId = randomUUID()
    const user = store.insert('user', { ...fresh(ownerId), id: ownerId, displayName }, userSchema)
    const twin = store.insert(
      'twin',
      { ...fresh(ownerId), id: ownerId, label: `${displayName}'s AI Twin` },
      twinSchema
    )
    return { user, twin, token: store.issueToken(ownerId) }
  })
}
export function touchTwin(store: Store, ownerId: string) {
  const twin = store.owned('twin', ownerId, ownerId, twinSchema)
  return store.update('twin', twin, twinSchema)
}
export function createMemory(store: Store, ownerId: string, input: unknown): Memory {
  const parsed = memoryInput.parse(input)
  insist(
    !parsed.expiresAt || Date.parse(parsed.expiresAt) > Date.now(),
    400,
    'expired',
    'A memory expiry must be in the future.'
  )
  return store.transaction(() => {
    const memory = store.insert(
      'memory',
      {
        ...fresh(ownerId),
        ...parsed,
        status: 'pending',
        confidence: parsed.kind === 'inferred' ? 0.5 : 1,
        source: { type: 'user', sourceId: ownerId, quote: parsed.statement }
      },
      memorySchema
    )
    touchTwin(store, ownerId)
    store.audit(ownerId, 'memory.created', memory.id)
    return memory
  })
}
export const memoryReview = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    status: z.enum(['confirmed', 'rejected']),
    supersedesIds: z.array(z.string().uuid()).max(20).default([])
  })
  .strict()
export function reviewMemory(store: Store, ownerId: string, memoryId: string, input: unknown) {
  const request = memoryReview.parse(input)
  return store.transaction(() => {
    const memory = store.owned('memory', memoryId, ownerId, memorySchema)
    insist(
      memory.revision === request.expectedRevision,
      409,
      'revision_conflict',
      'Memory changed. Read it again.'
    )
    insist(
      memory.status !== 'superseded',
      409,
      'superseded',
      'Create a corrected memory instead of restoring a superseded one.'
    )
    if (request.status === 'confirmed') {
      insist(
        !memory.expiresAt || Date.parse(memory.expiresAt) > Date.now(),
        409,
        'expired',
        'An expired memory cannot be confirmed.'
      )
      const other = store
        .list('memory', memorySchema, ownerId)
        .filter((item) => item.id !== memory.id && item.field === memory.field && isCurrent(item))
      insist(
        other.every((item) => request.supersedesIds.includes(item.id)),
        409,
        'memory_conflict',
        'Confirm which existing memories this correction supersedes.'
      )
      for (const supersededId of request.supersedesIds) {
        const prior = store.owned('memory', supersededId, ownerId, memorySchema)
        insist(
          prior.id !== memory.id && prior.field === memory.field,
          400,
          'different_field',
          'Corrections can only supersede the same memory field.'
        )
        store.update('memory', { ...prior, status: 'superseded' }, memorySchema)
      }
    } else {
      insist(
        request.supersedesIds.length === 0,
        400,
        'invalid_review',
        'A rejection cannot supersede other memories.'
      )
    }
    const saved = store.update('memory', { ...memory, status: request.status }, memorySchema)
    touchTwin(store, ownerId)
    store.audit(ownerId, `memory.${request.status}`, memory.id)
    return saved
  })
}
export function profile(store: Store, ownerId: string) {
  const twin = store.owned('twin', ownerId, ownerId, twinSchema)
  const memories = store.list('memory', memorySchema, ownerId)
  const active = memories.filter((memory) => isCurrent(memory))
  const conflicts = memories
    .filter((memory) => memory.status === 'pending')
    .map((memory) => ({
      memoryId: memory.id,
      conflictsWith: active.filter((item) => item.field === memory.field).map((item) => item.id)
    }))
    .filter((item) => item.conflictsWith.length)
  return {
    twin,
    confirmed: active,
    pending: memories.filter((item) => item.status === 'pending'),
    conflicts
  }
}
export function relevantMemories(
  store: Store,
  ownerId: string,
  question: string,
  limit = 16
): Memory[] {
  const words = new Set(question.toLowerCase().match(/[a-z]{4,}/g) ?? [])
  const scored = store
    .list('memory', memorySchema, ownerId)
    .filter((memory) => isCurrent(memory))
    .map((memory) => {
      const wordsMatched = `${memory.statement} ${memory.field}`
        .toLowerCase()
        .split(/\W+/)
        .filter((word) => words.has(word)).length
      return {
        memory,
        score:
          wordsMatched * 4 +
          memory.importance +
          (memory.kind === 'decision_rule' ? 5 : 0) +
          (memory.dimension === 'constraints' ? 4 : 0)
      }
    })
  return scored
    .sort((a, b) => b.score - a.score || a.memory.id.localeCompare(b.memory.id))
    .slice(0, limit)
    .map(({ memory }) => memory)
}
export function memoryContext(memories: Memory[]) {
  return memories.map(({ id, dimension, statement, value, confidence, field, source }) => ({
    id,
    dimension,
    statement,
    field,
    value,
    confidence,
    source: { type: source.type, quote: source.quote }
  }))
}

export const visibilityInput = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    visibility: memoryInput.shape.visibility.removeDefault()
  })
  .strict()
export function changeVisibility(store: Store, ownerId: string, memoryId: string, input: unknown) {
  const request = visibilityInput.parse(input)
  return store.transaction(() => {
    const memory = store.owned('memory', memoryId, ownerId, memorySchema)
    insist(
      memory.revision === request.expectedRevision,
      409,
      'revision_conflict',
      'Read the latest memory before changing visibility.'
    )
    const saved = store.update(
      'memory',
      { ...memory, visibility: request.visibility },
      memorySchema
    )
    touchTwin(store, ownerId)
    store.audit(ownerId, 'memory.visibility_changed', memoryId)
    return saved
  })
}
