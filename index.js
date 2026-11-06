/**
 * Session mailbox: cross-session messaging tools.
 *
 * Any agent can discover the other Sessions in this profile, read their recent
 * conversation, and deliver a message or a piece of work to them. Delivery
 * resolves or resumes the target Session through the Session controller and
 * wakes it through its own Agent handle, so an inactive Session starts a turn
 * and a running Session receives the message at its next turn boundary.
 *
 * @module @local/dsh-session-mailbox
 */

import { randomUUID } from 'node:crypto'

import { decideTarget, normalizePolicy } from './lib/policy.js'

/** Cordis plugin name. */
export const name = 'session-mailbox'

/** Services this plugin needs; it stays inactive without them. */
export const inject = ['tools', 'sessionController', 'sessionQuery']

const MAX_LIST_LIMIT = 100
const MAX_READ_LIMIT = 30
const MAX_MESSAGE_CHARS = 4000
const MAX_SNIPPET_CHARS = 1500

/** Clamp a caller-supplied integer into an inclusive range. */
function clampInt(value, fallback, min, max) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
  return Math.min(max, Math.max(min, numeric))
}

/** Join the text-bearing blocks of one message, marking non-text content. */
function contentText(blocks) {
  if (!Array.isArray(blocks)) return ''
  const parts = []
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'image') parts.push('[image]')
    else if (block.type === 'file') parts.push(`[file ${block.attachment?.name ?? 'attachment'}]`)
  }
  return parts.join('\n')
}

/** Extract the human-readable text of one surface event. */
function surfaceText(event) {
  const data = event?.data
  if (data === null || typeof data !== 'object') return ''
  if (event.type === 'user/message') return contentText(data.content)
  if (event.type === 'assistant/message') return contentText(data.message?.content)
  return ''
}

/** Truncate one string, appending a marker when it was shortened. */
function truncate(text, max) {
  if (text.length <= max) return text
  return `${text.slice(0, max)}… [truncated ${text.length - max} chars]`
}

/** Short stable-ish display label for one session row. */
function labelOf(row) {
  return row.title.length > 0 ? row.title : `(untitled ${String(row.id).slice(0, 8)})`
}

/**
 * Load the addressable ordinary Sessions with their titles.
 * @param ctx - context carrying the Session controller and query services.
 * @param includeSubagents - whether subagent-origin Sessions are addressable.
 * @returns newest-first rows with id, title, activity, and directory.
 */
async function loadSessions(ctx, includeSubagents) {
  const list = await ctx.sessionController.list({})
  const items = []
  for (const summary of list.items) {
    if (summary.blank === true) continue
    if (!includeSubagents && (summary.origin === 'subagent' || summary.parentSessionId !== undefined)) continue
    items.push(summary)
  }
  const ids = items.map((item) => item.sessionId)
  const titles = new Map()
  if (ids.length > 0) {
    const observations = await ctx.sessionQuery.readTitleSnapshots(ids)
    for (const observation of observations) {
      if (observation.status !== 'fulfilled') continue
      const title = observation.value.title?.title
      if (typeof title === 'string' && title.length > 0) titles.set(String(observation.sessionId), title)
    }
  }
  const rows = items.map((item) => ({
    id: String(item.sessionId),
    title: titles.get(String(item.sessionId)) ?? '',
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
    running: item.running === true,
    ...(item.cwd === undefined ? {} : { cwd: item.cwd }),
  }))
  rows.sort((left, right) => right.updatedAt - left.updatedAt)
  return rows
}

/**
 * Resolve one target reference to a single Session row.
 * @param ctx - context carrying the Session services.
 * @param reference - exact Session id, exact title, or unambiguous title fragment.
 * @returns the matched row.
 * @throws when nothing matches or a fragment matches several Sessions.
 */
async function resolveTarget(ctx, reference) {
  const needle = String(reference).trim()
  if (needle.length === 0) throw new Error('target must name a Session id or title')
  const rows = await loadSessions(ctx, false)
  const lowered = needle.toLowerCase().replace(/^["'«]+|["'»]+$/g, '')
  const exactId = rows.find((row) => row.id === needle || row.id.startsWith(needle))
  if (exactId !== undefined) return exactId
  const exactTitle = rows.filter((row) => row.title.toLowerCase() === lowered)
  if (exactTitle.length === 1) return exactTitle[0]
  if (exactTitle.length > 1) {
    throw new Error(
      `title "${needle}" matches ${exactTitle.length} Sessions; use the Session id instead: ` +
        exactTitle.map((row) => `${row.title} (${row.id})`).join(', '),
    )
  }
  const partial = rows.filter((row) => row.title.toLowerCase().includes(lowered))
  if (partial.length === 1) return partial[0]
  if (partial.length > 1) {
    throw new Error(
      `target "${needle}" is ambiguous; candidates: ` +
        partial.slice(0, 8).map((row) => `${row.title || '(untitled)'} (${row.id})`).join(', '),
    )
  }
  throw new Error(`no Session matches "${needle}"; call session_list to see available Sessions`)
}

/** Read one Session's latest user/assistant messages from its model surface. */
async function readMessages(ctx, sessionId, limit) {
  const snapshot = await ctx.sessionQuery.readSurface(sessionId)
  const messages = []
  for (const event of snapshot.events) {
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
    const text = surfaceText(event).trim()
    if (text.length === 0) continue
    messages.push({
      role: event.type === 'user/message' ? 'user' : 'assistant',
      seq: Number(event.seq),
      time: Number(event.time),
      text: truncate(text, MAX_SNIPPET_CHARS),
    })
  }
  const total = messages.length
  return { messages: messages.slice(Math.max(0, total - limit)), total }
}

/** Describe one delivery failure without leaking a stack trace to the model. */
function describeFailure(error) {
  if (error !== null && typeof error === 'object' && typeof error.code === 'string' && typeof error.message === 'string') {
    return `${error.code}: ${error.message}`
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * Register the three Session mailbox tools for this composition.
 * @param ctx - context providing the tool registry and the Session services.
 * @param config - the row configuration: `defaultAllow`, `allow`, and `deny`.
 */
export function apply(ctx, config) {
  const policy = normalizePolicy(config)
  ctx.tools.register({
    name: 'session_list',
    description:
      'List the other Sessions in this workspace with their titles, activity, and ids. Use it to discover the Session that owns a responsibility before reading from it or delivering work to it.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Case-insensitive title fragment used to narrow the list.',
        },
        includeSubagents: {
          type: 'boolean',
          description: 'Include subagent-origin child Sessions. Defaults to false.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum rows to return, 1-100. Defaults to 20.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          sessions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                updatedAt: { type: 'number' },
                running: { type: 'boolean' },
                cwd: { type: 'string' },
                allowed: { type: 'boolean' },
              },
            },
          },
        },
      },
      render(_args, value) {
        const lines = [`${value.total} Session(s), newest first:`]
        value.sessions.forEach((row, index) => {
          const when = row.updatedAt > 0 ? new Date(row.updatedAt).toISOString() : 'unknown time'
          const blocked = row.allowed === false ? ' — blocked by policy' : ''
          lines.push(`${index + 1}. ${row.title || '(untitled)'} — ${row.running ? 'running' : 'idle'} — ${when} — ${row.id}${blocked}`)
        })
        if (value.sessions.length === 0) lines.push('(none)')
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const rows = await loadSessions(ctx, args.includeSubagents === true)
      let filtered = rows.map((row) => ({
        ...row,
        allowed: decideTarget(policy, row).allowed,
      }))
      if (typeof args.query === 'string' && args.query.trim().length > 0) {
        const needle = args.query.trim().toLowerCase()
        filtered = filtered.filter((row) => row.title.toLowerCase().includes(needle))
      }
      const sessions = filtered.slice(0, clampInt(args.limit, 20, 1, MAX_LIST_LIMIT))
      return { total: filtered.length, sessions }
    },
  })

  ctx.tools.register({
    name: 'session_send',
    description:
      'Deliver a message or a piece of work to another Session by id or title. The target is resolved or resumed and woken, so it starts a turn when idle and receives the message at its next turn boundary when running. Use this to hand work to the Session that owns another responsibility, then read its answer with session_read.',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Target Session id, exact title, or unambiguous title fragment.',
        },
        message: {
          type: 'string',
          description: 'The message or work to deliver. Write it as a complete instruction: the target has no access to this conversation.',
        },
        mode: {
          type: 'string',
          enum: ['queue', 'steer'],
          description:
            'queue delivers as the next turn (default, right for a hand-off); steer injects at the target\'s nearest step boundary when it is already running.',
        },
      },
      required: ['target', 'message'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          sent: { type: 'boolean' },
          sessionId: { type: 'string' },
          title: { type: 'string' },
          mode: { type: 'string' },
        },
      },
      render(_args, value) {
        const label = value.title.length > 0 ? `${value.title} (${value.sessionId})` : value.sessionId
        return [{ type: 'text', text: `Delivered to ${label} in ${value.mode} mode.` }]
      },
    },
    async execute(args, exec) {
      const sender = exec.agent
      if (sender === undefined) throw new Error('session_send needs a calling agent Session')
      const message = String(args.message ?? '').trim()
      if (message.length === 0) throw new Error('message must contain text')
      const clipped = truncate(message, MAX_MESSAGE_CHARS)
      const mode = args.mode === 'steer' ? 'steer' : 'queue'

      const target = await resolveTarget(ctx, args.target)
      if (target.id === String(sender.id)) throw new Error('session_send cannot target the calling Session')
      const decision = decideTarget(policy, target)
      if (!decision.allowed) {
        throw new Error(
          `delivery to ${labelOf(target)} is blocked by policy: ${decision.reason}; ` +
            'adjust the session-mailbox row config (defaultAllow / allow / deny)',
        )
      }

      const senderId = String(sender.id)
      const senderTitle = (await ctx.sessionQuery.readTitle(sender.id))?.title
      const senderLabel = typeof senderTitle === 'string' && senderTitle.length > 0 ? senderTitle : senderId

      const resolved = await ctx.sessionController.resolveAgent(target.id)
      if (resolved.agent === undefined) {
        throw new Error(`cannot deliver to Session ${target.id}: ${describeFailure(resolved.error)}`)
      }

      // The Agent inbox stores the supplied message verbatim as the durable
      // `user/message` payload, and replay validation requires an identified
      // message: non-empty `id`, the `user` role, a sourced content list.
      const userMessage = {
        id: randomUUID(),
        role: 'user',
        source: { kind: 'user' },
        content: [
          {
            type: 'text',
            text:
              `[Session message from "${senderLabel}" (${senderId})]\n\n` +
              `${clipped}\n\n` +
              `[Reply to this Session with the session_send tool using target "${senderId}".]`,
          },
        ],
      }
      try {
        if (mode === 'steer') await resolved.agent.steer(userMessage)
        else await resolved.agent.followup(userMessage)
      } catch (error) {
        throw new Error(`delivery to Session ${target.id} failed: ${describeFailure(error)}`)
      }

      return { sent: true, sessionId: target.id, title: target.title, mode }
    },
  })

  ctx.tools.register({
    name: 'session_read',
    description:
      'Read the latest user and assistant messages of another Session by id or title. Use it to inspect what another responsibility already did, or to collect its answer after session_send. Read-only: it never wakes the target.',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Target Session id, exact title, or unambiguous title fragment.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum messages to return, 1-30. Defaults to 10.',
        },
      },
      required: ['target'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          title: { type: 'string' },
          total: { type: 'integer' },
          messages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string' },
                seq: { type: 'number' },
                time: { type: 'number' },
                text: { type: 'string' },
              },
            },
          },
        },
      },
      render(_args, value) {
        const lines = [`${value.title || '(untitled)'} (${value.sessionId}) — last ${value.messages.length} of ${value.total} message(s):`]
        for (const message of value.messages) lines.push(`\n[${message.role} #${message.seq}]\n${message.text}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('session_read needs a calling agent Session')
      const target = await resolveTarget(ctx, args.target)
      const decision = decideTarget(policy, target)
      if (!decision.allowed) {
        throw new Error(`reading ${labelOf(target)} is blocked by policy: ${decision.reason}`)
      }
      const limit = clampInt(args.limit, 10, 1, MAX_READ_LIMIT)
      const { messages, total } = await readMessages(ctx, target.id, limit)
      return { sessionId: target.id, title: target.title, total, messages }
    },
  })
}
