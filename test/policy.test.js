import assert from 'node:assert/strict'
import test from 'node:test'

import { decideTarget, normalizePolicy, refMatches } from '../lib/policy.js'

const reviewer = { id: 'session-06ed43db-3976-4537-814a-66113d90509d', title: '审查者' }
const writer = { id: 'session-2148ce36-ae73-4239-b667-ca938223d97f', title: '需求等文档撰写者' }

test('an empty policy allows every target', () => {
  const policy = normalizePolicy(undefined)
  assert.equal(policy.defaultAllow, true)
  assert.deepEqual(policy.allow, [])
  assert.deepEqual(policy.deny, [])
  assert.equal(decideTarget(policy, reviewer).allowed, true)
  assert.equal(decideTarget(policy, writer).rule, 'default')
})

test('defaultAllow false refuses targets unless allow-listed', () => {
  const policy = normalizePolicy({ defaultAllow: false })
  const decision = decideTarget(policy, reviewer)
  assert.equal(decision.allowed, false)
  assert.equal(decision.rule, 'default')
})

test('an allow list restricts delivery to its members', () => {
  const policy = normalizePolicy({ defaultAllow: false, allow: ['审查者'] })
  assert.equal(decideTarget(policy, reviewer).allowed, true)
  assert.equal(decideTarget(policy, reviewer).rule, 'allow')
  assert.equal(decideTarget(policy, writer).allowed, false)
  assert.equal(decideTarget(policy, writer).rule, 'allow-list')
})

test('the deny list wins over both the allow list and the default', () => {
  const policy = normalizePolicy({ allow: ['审查者'], deny: ['审查者'] })
  const decision = decideTarget(policy, reviewer)
  assert.equal(decision.allowed, false)
  assert.equal(decision.rule, 'deny')
})

test('references match an exact id or a title without letter case', () => {
  assert.equal(refMatches(reviewer.id, reviewer), true)
  assert.equal(refMatches('  审查者  ', reviewer), true)
  assert.equal(refMatches('需求等文档撰写者', writer), true)
  assert.equal(refMatches('审查', reviewer), false, 'a title fragment must not match')
  assert.equal(refMatches('session-06ed43db', reviewer), false, 'an id prefix must not match')
  assert.equal(refMatches('', reviewer), false)
})

test('a target without a title never matches on an empty reference', () => {
  const untitled = { id: 'session-x', title: '' }
  assert.equal(refMatches('', untitled), false)
  const policy = normalizePolicy({ allow: [' '] })
  assert.deepEqual(policy.allow, [], 'blank references are dropped')
  assert.equal(decideTarget(policy, untitled).allowed, true)
})

test('non-string and blank list entries are ignored', () => {
  const policy = normalizePolicy({ allow: ['审查者', 42, null, ''], deny: ['  '] })
  assert.deepEqual(policy.allow, ['审查者'])
  assert.deepEqual(policy.deny, [])
})

test('a malformed config falls back to allow-all', () => {
  assert.equal(normalizePolicy('nope').defaultAllow, true)
  assert.equal(normalizePolicy(null).defaultAllow, true)
  assert.equal(normalizePolicy({ defaultAllow: 'false' }).defaultAllow, true, 'only the boolean false disables the default')
})
