import type { z } from 'zod'
import type { Store } from './store.js'
import { decisionSchema, interviewSchema, negotiationSchema, type Entity } from './contracts.js'
import { browserSchema } from './browser.js'
export function recoverInterruptedJobs(store: Store) {
  function recover<T extends Entity & { phase: string; error?: string }>(
    kind: string,
    schema: z.ZodType<T>
  ) {
    for (const value of store.list(kind, schema)) {
      if (value.phase === 'running') {
        store.update(
          kind,
          {
            ...value,
            phase: 'failed',
            error:
              'The backend restarted during this task. Completed work was saved; start or retry the task.'
          },
          schema
        )
      }
    }
  }
  recover('decision', decisionSchema)
  recover('interview', interviewSchema)
  recover('negotiation', negotiationSchema)
  recover('browser', browserSchema)
}
