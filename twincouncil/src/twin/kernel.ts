import Kernel from '@onkernel/sdk'

export type PageSnapshot = {
  url: string
  finalUrl: string
  status: number | null
  title: string
  description: string
  jsonLd: string
  text: string
  /** live: rendered just now in a Kernel cloud browser. cached: Exa's stored copy. */
  source: 'live' | 'cached'
}

export type PageReader = {
  read: (url: string) => Promise<PageSnapshot>
  close: () => Promise<void>
}

// Runs inside Kernel's browser VM. The page is opened and read, never interacted with: no clicks,
// no typing, and every request that is not a plain read is aborted, so nothing can be submitted.
const READ_PAGE = String.raw`
const p = await context.newPage();
try {
  await p.route('**/*', (route) => {
    const request = route.request();
    const method = request.method();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') return route.abort();
    const type = request.resourceType();
    if (type === 'image' || type === 'media' || type === 'font') return route.abort();
    return route.continue();
  });
  const response = await p.goto(__URL__, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForTimeout(2500);
  const page = await p.evaluate(() => {
    const meta = (selector) => {
      const el = document.querySelector(selector);
      return (el && el.getAttribute('content')) || '';
    };
    const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map((s) => s.textContent || '')
      .join('\n')
      .slice(0, 12000);
    const text = (document.body ? document.body.innerText : '').replace(/\n{3,}/g, '\n\n').slice(0, 14000);
    return {
      title: document.title || '',
      description: meta('meta[property="og:description"]') || meta('meta[name="description"]'),
      jsonLd,
      text,
    };
  });
  return { status: response ? response.status() : null, finalUrl: p.url(), ...page };
} finally {
  await p.close();
}
`

/** Public http(s) URL with tracking parameters removed, or null if it is not one. */
export function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    const host = u.hostname.toLowerCase().replace(/\.$/, '')
    const internal = host === 'localhost' || /\.(local|localhost|internal)$/.test(host)
    const ipLiteral = /^[\d.]+$/.test(host) || host.includes(':')
    if (internal || ipLiteral || !host.includes('.')) return null
    u.hash = ''
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|aff$|ref$)/i.test(key)) u.searchParams.delete(key)
    }
    return u.toString()
  } catch {
    return null
  }
}

/** One headless Kernel browser for the whole verification phase. Null when KERNEL_API_KEY is not set. */
export async function openCloudBrowser(): Promise<PageReader | null> {
  if (!process.env.KERNEL_API_KEY) return null
  const kernel = new Kernel()
  // Deleted explicitly when the phase ends; the long idle timeout only covers gaps between reads.
  const browser = await kernel.browsers.create({ headless: true, timeout_seconds: 1800 })
  return {
    read: async url => {
      // JSON.stringify makes the URL a string literal, so a hostile URL cannot become code.
      const code = READ_PAGE.split('__URL__').join(JSON.stringify(url))
      // A browser runs one script at a time, so parallel reads queue: give each request room to
      // wait its turn instead of timing out at the SDK's 60 s default and retrying.
      const run = await kernel.browsers.playwright.execute(browser.session_id, { code, timeout_sec: 60 }, { timeout: 200_000 })
      if (!run.success) throw new Error(run.error || 'Kernel could not run the page read')
      const page = run.result as Omit<PageSnapshot, 'url' | 'source'>
      return { ...page, url, source: 'live' }
    },
    close: async () => {
      await kernel.browsers.deleteByID(browser.session_id)
    },
  }
}
