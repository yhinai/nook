import Kernel from '@onkernel/sdk'
import { z } from 'zod'
import { base, text } from './contracts.js'
import type { Store } from './store.js'
import { fresh } from './store.js'
import type { Jobs } from './jobs.js'
import { insist } from './errors.js'
import type { Reasoner } from './ai.js'

export const browserInput = z.object({ url: z.string().url().max(2000), purpose: text }).strict()
const pageSchema = z.object({
  url: z.string().url(),
  title: z.string().max(300),
  text: z.string().max(12000)
})
const summarySchema = z.object({
  summary: text,
  findings: z.array(text).max(8),
  unknowns: z.array(text).max(8)
})
export const browserSchema = base.extend({
  ...browserInput.shape,
  phase: z.enum(['running', 'ready', 'failed']),
  page: pageSchema.nullable(),
  summary: summarySchema.nullable(),
  error: z.string().optional()
})
export type PublicBrowser = {
  enabled: boolean
  read(url: string, signal: AbortSignal): Promise<z.infer<typeof pageSchema>>
}
export function approvedUrl(value: string, domains: string[]): URL {
  const url = new URL(value)
  insist(
    url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      !url.search &&
      !url.hash &&
      domains.includes(url.hostname),
    400,
    'browser_url_blocked',
    'Use an HTTPS URL on an explicitly allowed public domain, without credentials or query parameters.'
  )
  return url
}
export function createKernelBrowser(key: string | undefined, domains: string[]): PublicBrowser {
  const kernel = new Kernel({ apiKey: key || 'not-configured', maxRetries: 0, timeout: 30000 })
  return {
    enabled: Boolean(key),
    async read(value, signal) {
      insist(key, 503, 'kernel_unconfigured', 'Configure Kernel before reading public pages.')
      const url = approvedUrl(value, domains)
      const session = await kernel.browsers.create(
        { headless: true, timeout_seconds: 90 },
        { signal }
      )
      try {
        // The agent cannot provide code; navigation is restricted to this public host.
        const code = `const target = new URL(${JSON.stringify(url.toString())});
          await context.route('**/*', async route => {
            const request = route.request(); const next = new URL(request.url());
            if (request.method() !== 'GET' || next.protocol !== 'https:' || next.hostname !== target.hostname || next.username || next.password || next.port && next.port !== '443' || request.resourceType() !== 'document') return route.abort();
            return route.continue();
          });
          await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 25000 });
          return { url: page.url(), title: (await page.title()).slice(0,300), text: (await page.locator('body').innerText()).slice(0,12000) };`
        const result = await kernel.browsers.playwright.execute(
          session.session_id,
          { code, timeout_sec: 30 },
          { signal }
        )
        insist(result.success, 502, 'browser_failed', 'Kernel could not read that public page.')
        signal.throwIfAborted()
        const page = pageSchema.parse(result.result)
        approvedUrl(page.url, [url.hostname])
        return page
      } finally {
        await kernel.browsers.deleteByID(session.session_id, { signal: AbortSignal.timeout(10000) })
      }
    }
  }
}
export function startBrowserRead(
  store: Store,
  jobs: Jobs,
  reasoner: Reasoner,
  browser: PublicBrowser,
  domains: string[],
  ownerId: string,
  input: unknown
) {
  const request = browserInput.parse(input)
  approvedUrl(request.url, domains)
  insist(
    browser.enabled && reasoner.enabled,
    503,
    'browser_unconfigured',
    'Configure Kernel and an AI provider before starting a browser task.'
  )
  jobs.requireAvailable(ownerId)
  const created = store.insert(
    'browser',
    { ...fresh(ownerId), ...request, phase: 'running', page: null, summary: null },
    browserSchema
  )
  jobs.launch(
    ownerId,
    async (signal) => {
      const page = await browser.read(request.url, signal)
      const summary = await reasoner.generate(
        'browser',
        {
          purpose: request.purpose,
          page,
          instruction:
            'Summarize only retrieved page text. Do not invent links or claim actions occurred.'
        },
        summarySchema,
        signal
      )
      signal.throwIfAborted()
      store.update('browser', { ...created, phase: 'ready', page, summary }, browserSchema)
      store.audit(ownerId, 'browser.ready', created.id)
    },
    () => {
      const current = store.owned('browser', created.id, ownerId, browserSchema)
      if (current.phase === 'running') {
        store.update(
          'browser',
          {
            ...current,
            phase: 'failed',
            error: 'Public page reading failed or timed out. No external action was performed.'
          },
          browserSchema
        )
      }
    }
  )
  return created
}
