import { useEffect, useRef } from 'react'
import type { ChatActivity, ChatEvent } from '../api'
import { STATE_LABEL, describe, members, tier } from '../chat/teamEvents'
import { pew, thunk, tick } from '../chat/teamSound'

/**
 * The live view while the shop team works on a message: who's busy, hand-offs
 * travelling along the wires, and what each one just did. Plays a sound per step.
 */
export default function TeamActivity({ events }: { events: ChatEvent[] }) {
  const team = members(events)
  const names = Object.fromEntries(team.map((m) => [m.id, m.name]))
  const [boss, ...crew] = team

  const states: Record<string, string> = {}
  for (const event of events) if (event.type === 'status') states[event.data.agent] = event.data.state
  const stateOf = (id: string) => states[id] ?? 'idle'

  // One sound per new step.
  const heard = useRef(0)
  useEffect(() => {
    for (const event of events.slice(heard.current)) {
      if (event.type === 'delegate') pew()
      else if (event.type === 'report') thunk(Boolean(event.data.instant))
      else if (event.type === 'tool') tick()
    }
    heard.current = events.length
  }, [events])

  const lines = events.map((event) => describe(event, names)).filter((line): line is string => Boolean(line))

  return (
    <div className="team" role="status" aria-label="The shop team is working on your message">
      <div className={`team__node team__node--boss is-${stateOf(boss.id)}`}>
        <span className="team__name">{boss.name}</span>
        <span className="team__model">{tier(boss.model)}</span>
        <span className="team__state">{STATE_LABEL[stateOf(boss.id)]}</span>
      </div>
      <ul className="team__crew">
        {crew.map((member) => (
          <li key={member.id} className="team__lane">
            <span className="team__wire" aria-hidden="true">
              {events.map((event, i) => {
                if (event.type === 'delegate' && event.data.to === member.id)
                  return <span key={i} className="team__spark team__spark--out" />
                if (event.type === 'report' && event.data.from === member.id)
                  return <span key={i} className="team__spark team__spark--back" />
                return null
              })}
            </span>
            <div className={`team__node is-${stateOf(member.id)}`} title={member.job}>
              <span className="team__name">{member.name}</span>
              <span className="team__model">{tier(member.model)}</span>
              <span className="team__state">{STATE_LABEL[stateOf(member.id)]}</span>
            </div>
          </li>
        ))}
      </ul>
      <ol className="team__log">
        {lines.length === 0 && <li>Reading your message…</li>}
        {lines.slice(-4).map((line, i) => (
          <li key={lines.length - 4 + i}>{line}</li>
        ))}
      </ol>
    </div>
  )
}

/** After the reply: who worked on it, how long it took, and what it used, in a fold-out. */
export function ActivitySummary({ activity, trace }: { activity: ChatActivity; trace: ChatEvent[] }) {
  const team = members(trace)
  const names = Object.fromEntries(team.map((m) => [m.id, m.name]))
  const involved = ['concierge', ...trace.flatMap((e) => (e.type === 'delegate' ? [e.data.to] : []))]
  const who = [...new Set(involved)].map((id) => names[id] ?? id).join(' + ')
  const lines = trace.map((event) => describe(event, names)).filter((line): line is string => Boolean(line))

  const byTier: Record<string, { calls: number; input: number; cached: number; output: number }> = {}
  for (const u of activity.usage) {
    const row = (byTier[tier(u.model)] ??= { calls: 0, input: 0, cached: 0, output: 0 })
    row.calls += u.requests
    row.input += u.input_tokens
    row.cached += u.cached_tokens
    row.output += u.output_tokens
  }
  const fmt = (n: number) => n.toLocaleString('en-US')

  return (
    <details className="chat-behind">
      <summary>
        Behind the scenes · {who} · {activity.seconds.toFixed(1)} s
      </summary>
      {lines.length > 0 && (
        <ol className="chat-behind__steps">
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      )}
      <ul className="chat-behind__usage">
        {Object.entries(byTier).map(([name, row]) => (
          <li key={name}>
            <strong>{name}</strong>: {row.calls} model call{row.calls === 1 ? '' : 's'} · {fmt(row.input)} tokens in (
            {fmt(row.cached)} from cache) · {fmt(row.output)} out
          </li>
        ))}
      </ul>
    </details>
  )
}
