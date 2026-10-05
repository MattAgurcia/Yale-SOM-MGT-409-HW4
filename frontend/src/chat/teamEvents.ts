import type { ChatEvent, TeamMember } from '../api'

// Shown until the stream's "team" event names the members.
export const DEFAULT_TEAM: TeamMember[] = [
  {
    id: 'concierge',
    name: 'Dan',
    model: 'gpt-5.6-terra',
    job: 'Bulldog concierge: talks to you, checks prices, stock and sizes',
  },
  { id: 'scout', name: 'Scout', model: 'gpt-5.6-luna', job: 'Searches the catalogue' },
  { id: 'stylist', name: 'Stylist', model: 'gpt-5.6-luna', job: 'Outfits and alternatives' },
]

export const STATE_LABEL: Record<string, string> = {
  thinking: 'Thinking',
  working: 'On it',
  done: 'Done',
  idle: 'Standing by',
}

/** "gpt-5.6-terra" -> "Terra". */
export const tier = (model: string) => {
  const name = model.split('-').pop() ?? model
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export function members(events: ChatEvent[]): TeamMember[] {
  const team = events.find((e) => e.type === 'team')
  return team?.type === 'team' ? team.data.members : DEFAULT_TEAM
}

/** A plain-English line for each step, or null for steps that don't need one. */
export function describe(event: ChatEvent, names: Record<string, string>): string | null {
  const name = (id: string) => names[id] ?? id
  switch (event.type) {
    case 'delegate':
      return `${name(event.data.from)} → ${name(event.data.to)}: ${event.data.task}`
    case 'tool':
      return `${name(event.data.agent)} ${event.data.summary}`
    case 'report':
      return `${name(event.data.from)} → ${name(event.data.to)}: ${event.data.summary}${
        event.data.instant ? ' (answered from the database, no model call)' : ''
      }`
    default:
      return null
  }
}
