/**
 * Target policy for the session mailbox.
 *
 * The policy is deliberately simple and pure so it can be unit-tested without a
 * harness: a target is refused when it appears on the deny list, otherwise an
 * allow list (when present) restricts delivery to its members, and an empty
 * policy falls back to the configured default.
 *
 * References are matched exactly: a full session id, or a full title compared
 * without letter case. Fragments are intentionally not matched here — a loose
 * match must never widen who may be woken up.
 */

/** @typedef {{ id: string, title: string }} MailboxTarget */
/** @typedef {{ defaultAllow: boolean, allow: string[], deny: string[] }} MailboxPolicy */

/** Keep only non-empty strings, trimmed. */
function referencesOf(value) {
  if (!Array.isArray(value)) return []
  const references = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (trimmed.length > 0) references.push(trimmed)
  }
  return references
}

/**
 * Normalize the row configuration into a policy.
 * @param {unknown} raw - the plugin row's `config` value, possibly absent.
 * @returns {MailboxPolicy}
 */
export function normalizePolicy(raw) {
  const config = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    defaultAllow: config.defaultAllow !== false,
    allow: referencesOf(config.allow),
    deny: referencesOf(config.deny),
  }
}

/**
 * Whether one configured reference names this target.
 * @param {string} reference - a session id or a full session title.
 * @param {MailboxTarget} target - the resolved session.
 * @returns {boolean}
 */
export function refMatches(reference, target) {
  const wanted = String(reference ?? '').trim()
  if (wanted.length === 0) return false
  if (wanted === String(target.id ?? '')) return true
  const title = String(target.title ?? '').trim()
  return title.length > 0 && wanted.toLowerCase() === title.toLowerCase()
}

/**
 * Decide whether the policy admits delivery to one target.
 * @param {MailboxPolicy} policy - normalized policy.
 * @param {MailboxTarget} target - the resolved session.
 * @returns {{ allowed: boolean, rule: 'deny' | 'allow' | 'allow-list' | 'default', reason: string }}
 */
export function decideTarget(policy, target) {
  const denied = policy.deny.find((reference) => refMatches(reference, target))
  if (denied !== undefined) {
    return { allowed: false, rule: 'deny', reason: `target is on the deny list ("${denied}")` }
  }

  if (policy.allow.length > 0) {
    const allowed = policy.allow.find((reference) => refMatches(reference, target))
    if (allowed === undefined) {
      return { allowed: false, rule: 'allow-list', reason: 'target is not on the allow list' }
    }
    return { allowed: true, rule: 'allow', reason: `target is on the allow list ("${allowed}")` }
  }

  return policy.defaultAllow
    ? { allowed: true, rule: 'default', reason: 'policy allows every target by default' }
    : { allowed: false, rule: 'default', reason: 'policy denies every target by default' }
}
