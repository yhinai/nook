import { profile } from './profile.ts'
import { CATEGORIES } from './schemas.ts'
import type { EventRecord, Flagged, ScoutState } from './schemas.ts'

const RSVP_LABEL = {
  open: 'Open',
  approval_required: 'Approval required',
  waitlist: 'Waitlist',
  sold_out: 'Sold out',
  closed: 'Closed',
  unknown: 'Status not shown',
} as const

/** One table cell: no pipes or line breaks, and a dash when there is nothing to show. */
export function cell(value: string | null | undefined): string {
  const text = (value ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()
  return text || '—'
}

function when(event: EventRecord): string {
  const day = new Date(`${event.date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
  if (!event.startTime) return `${day} · time not listed`
  const time = event.endTime ? `${event.startTime}–${event.endTime}` : event.startTime
  return `${day} · ${time}${event.timezone ? ` ${event.timezone}` : ''}`
}

function flaggedList(heading: string, intro: string, items: Flagged[]): string[] {
  if (items.length === 0) return []
  return [`## ${heading}`, '', intro, '', ...items.map(item => `- [${cell(item.title)}](${item.url}): ${item.reason}`), '']
}

/** Phase 4: events.md for one stay. Pure formatting; every fact comes from the earlier phases. */
export function render(state: ScoutState): string {
  const { stay } = state
  const events = [...state.events].sort((a, b) =>
    `${a.date} ${a.startTime ?? ''}`.localeCompare(`${b.date} ${b.startTime ?? ''}`),
  )
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const lines: string[] = [
    `# Events: ${stay.city}, ${stay.start} to ${stay.end}`,
    '',
    `${stay.mode === 'visit' ? 'Short visit' : 'Moving here'} · interests: ${profile.interests.join(', ')} · generated ${stamp} UTC`,
    '',
    'Research only: nothing was RSVP\'d, registered for, or sent to anyone.',
    '',
  ]

  if (events.length === 0) {
    lines.push('No events passed verification for these dates.', '')
  } else {
    lines.push('| Event | Type | Date / time | Venue | Cost | RSVP link |', '|---|---|---|---|---|---|')
    for (const event of events) {
      const venue = [event.venue, event.address].filter(Boolean).join(', ')
      lines.push(
        `| ${cell(event.title)} | ${CATEGORIES[event.category].label} | ${cell(when(event))} | ${cell(venue)} | ${cell(event.cost)} | [${RSVP_LABEL[event.rsvp]}](${event.url.replace(/\|/g, '%7C')}) |`,
      )
    }
    lines.push('', '## Who to talk to', '')
    for (const event of events) {
      const checked =
        event.source === 'live' ? 'Checked on the live page.' : 'Checked against a cached copy, so RSVP status may be stale.'
      lines.push(`### ${event.title} (${when(event)})`, '')
      lines.push(`${event.fit === null ? '' : `Fit ${event.fit}/100. `}${event.fitReason ?? ''} ${checked}`.trim(), '')
      if (event.unverified.length > 0) lines.push(`> Could not verify: ${event.unverified.join('; ')}`, '')
      for (const person of event.people) {
        lines.push(`- **${person.name}**, ${person.role}`)
        lines.push(`  - Why: ${person.whyRelevant}`)
        lines.push(`  - Opener: "${person.opener}"`)
        const sources = person.sources.map((source, i) => `[${i + 1}](${source})`).join(' ')
        lines.push(`  - Background: ${person.background}${sources ? ` Sources: ${sources}` : ''}`)
        if (person.unverified) lines.push(`  - Could not verify: ${person.unverified}`)
      }
      if (event.peopleNote) lines.push(`${event.people.length > 0 ? '\n' : ''}_${event.peopleNote}_`)
      lines.push('')
    }
  }

  lines.push(
    ...flaggedList(
      'Could not verify',
      'These looked relevant but could not be confirmed, so they are not in the table. Check them yourself.',
      state.unverified,
    ),
    ...flaggedList('Dropped', 'Opened and ruled out.', state.dropped),
    '## Run notes',
    '',
    `- ${state.candidates.length} candidates found, ${events.length} kept, ${state.unverified.length} unverifiable, ${state.dropped.length} dropped.`,
    ...state.notes.map(note => `- ${note}`),
    '',
  )
  return lines.join('\n')
}
