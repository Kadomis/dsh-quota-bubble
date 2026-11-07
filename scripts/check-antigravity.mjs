#!/usr/bin/env node
// Exercises the Antigravity branch of the Host half: the family rules, the
// account the sibling plugin would pick, the windows it publishes, and the
// percent the card renders.
//
// The pool is stubbed, so this runs without a Harness and without the
// dsh-agy-link plugin installed. It reads host2.js and client.js as they ship.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostSrc = readFileSync(join(root, 'host2.js'), 'utf8')
const clientSrc = readFileSync(join(root, 'client.js'), 'utf8')

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

// The Host half is imported so the checks drive the code that ships. A parse
// error there is a failure of the check, not a crash that dumps the file.
let mod
try {
  mod = await import(`data:text/javascript;base64,${Buffer.from(hostSrc).toString('base64')}`)
} catch (error) {
  check('host2.js could be parsed', false, error?.message)
  console.log('\nhost2.js could not be parsed, so none of the checks below could run.')
  process.exit(1)
}

const FAR_FUTURE = '2099-01-01T00:00:00Z'
const FAR_PAST = '2000-01-01T00:00:00Z'

/** A pool snapshot with one healthy account per family. */
function poolFixture(overrides = {}) {
  return {
    mode: 'sticky',
    primaryAccountId: 'acc_a',
    lastActiveAccountId: 'acc_a',
    activeAccountIds: { google: 'acc_b', anthropic: 'acc_a' },
    accounts: [
      {
        id: 'acc_a',
        enabled: true,
        lastUsedAt: 1000,
        quotas: {
          google: { remainingFraction: 0.8, resetTime: FAR_FUTURE, weeklyFraction: 0.7, weeklyResetTime: FAR_FUTURE },
          anthropic: { remainingFraction: 0.6, resetTime: FAR_FUTURE, weeklyFraction: 0.5, weeklyResetTime: FAR_FUTURE },
          openai: { remainingFraction: 0.4, resetTime: FAR_FUTURE, weeklyFraction: 0.3, weeklyResetTime: FAR_FUTURE },
          argon: { remainingFraction: 0.9, resetTime: FAR_FUTURE, weeklyFraction: 0.3, weeklyResetTime: FAR_FUTURE },
        },
      },
      {
        id: 'acc_b',
        enabled: true,
        lastUsedAt: 2000,
        quotas: {
          google: { remainingFraction: 0.25, resetTime: FAR_FUTURE, weeklyFraction: 0.15, weeklyResetTime: FAR_FUTURE },
          anthropic: { remainingFraction: 0.9, resetTime: FAR_FUTURE, weeklyFraction: 0.9, weeklyResetTime: FAR_FUTURE },
        },
      },
    ],
    ...overrides,
  }
}

/**
 * The client's own colour helpers, read from the shipped file.
 *
 * They are extracted by brace balance rather than by an indentation pattern,
 * so re-indenting client.js does not silently capture the wrong span. Returns
 * undefined when the file no longer has the expected shape, so the check
 * reports a failure instead of throwing.
 */
function loadClientHelpers() {
  const wanted = ['clampPercent', 'leftOf', 'toneFor']
  const parts = []
  for (const name of wanted) {
    const start = clientSrc.indexOf(`function ${name}(`)
    if (start === -1) return undefined
    const open = clientSrc.indexOf('{', start)
    if (open === -1) return undefined
    let depth = 0
    let end = -1
    for (let i = open; i < clientSrc.length; i += 1) {
      if (clientSrc[i] === '{') depth += 1
      else if (clientSrc[i] === '}') {
        depth -= 1
        if (depth === 0) {
          end = i + 1
          break
        }
      }
    }
    if (end === -1) return undefined
    parts.push(clientSrc.slice(start, end))
  }
  try {
    return eval(`(function(){${parts.join('\n')}
      const c = { stateError: 'error', stateWarning: 'warning', stateSuccess: 'success', stateIdle: 'idle' };
      return { leftOf, tone: (left, status) => toneFor(c, left, status) } })()`)
  } catch {
    return undefined
  }
}

/**
 * The word the status pill shows for each mode, read from the shipped client.
 *
 * The card has to tell "this provider has no usage endpoint" apart from "the
 * endpoint was read and holds nothing right now", so the words are checked
 * against the file that ships rather than restated here.
 */
function loadPillWords() {
  const start = clientSrc.indexOf('function LivePill(')
  if (start === -1) return undefined
  const open = clientSrc.indexOf('{', start)
  if (open === -1) return undefined
  let depth = 0
  let end = -1
  for (let i = open; i < clientSrc.length; i += 1) {
    if (clientSrc[i] === '{') depth += 1
    else if (clientSrc[i] === '}') {
      depth -= 1
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  if (end === -1) return undefined
  const body = clientSrc.slice(start, end)
  // The pill renders through the DOM helpers, so only the expression that
  // picks the word is evaluated here.
  const expr = body.match(/const word = ([^\n]+)/)
  if (expr === null) return undefined
  try {
    const words = {}
    for (const mode of ['live', 'offline', 'nodata', 'static']) {
      // eslint-disable-next-line no-eval
      words[mode] = eval(`(function(){ const mode = ${JSON.stringify(mode)}; return ${expr[1]} })()`)
    }
    return { words }
  } catch {
    return undefined
  }
}

/** Runs the Host route with a stubbed pool and returns the JSON body. */
async function probe(model, { pool, fetchImpl, origin } = {}) {
  const registered = []
  const calls = { credentials: 0, requests: [] }
  const inner = {
    webServer: {
      register: (route) => {
        registered.push(route)
        return () => {}
      },
      getOrigin: () => {
        if (origin === 'throw') throw new Error('webserver: not listening')
        return origin ?? 'http://127.0.0.1:60251'
      },
    },
    credentials: {
      resolve: async () => {
        calls.credentials += 1
        return 'A-CREDENTIAL-THAT-MUST-NEVER-LEAK'
      },
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'antigravity', model }) },
    llm: { listConfigurableProviders: () => [], listModels: async () => [] },
  }
  const originalFetch = globalThis.fetch; const savedKey = process.env.MINIMAX_API_KEY; delete process.env.MINIMAX_API_KEY;; const savedEnv = process.env.MINIMAX_API_KEY; delete process.env.MINIMAX_API_KEY
  const body = pool === undefined
    ? undefined
    : JSON.stringify(pool)
  globalThis.fetch = fetchImpl ?? (async () =>
    new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }))
  const recordingFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.requests.push({ url: String(url), method: init?.method ?? 'GET', headers: init?.headers })
    return recordingFetch(url, init)
  }
  try {
    mod.apply({
      inject: (deps, cb) => cb({ ...inner, effect: (fn) => { fn(); return () => {} } }),
    })
    const route = registered.find((r) => r.path === '/plugin/quota-bubble')
    if (route === undefined) throw new Error('route not registered')
    let payload
    await route.handler(
      { method: 'GET', url: '/plugin/quota-bubble' },
      { writeHead: () => {}, end: (text) => { payload = JSON.parse(text) } },
    )
    return { body: payload, calls }
  } finally {
    globalThis.fetch = originalFetch; if (savedKey !== undefined) process.env.MINIMAX_API_KEY = savedKey;; if (savedEnv !== undefined) process.env.MINIMAX_API_KEY = savedEnv
  }
}

/** The response body of a probe, for the many checks that only read it. */
async function probeBody(model, options) {
  return (await probe(model, options)).body
}

console.log('=== family rules ===')
let body = await probeBody('gemini-3.8-flash', { pool: poolFixture() })
check('gemini reads the google counter', body.usage?.windows?.length === 2, JSON.stringify(body.usage?.windows))
check(
  'the windows are labelled the way the card names them',
  body.usage?.windows?.[0]?.label === '5-hour' && body.usage?.windows?.[1]?.label === 'Weekly',
  JSON.stringify(body.usage?.windows?.map((window) => window.label)),
)
check(
  'the windows carry the keys the card sorts them by',
  body.usage?.windows?.[0]?.key === 'rolling' && body.usage?.windows?.[1]?.key === 'weekly',
  JSON.stringify(body.usage?.windows?.map((window) => window.key)),
)
check(
  'gemini reads the google figure, not another family',
  Math.abs(body.usage?.windows?.[0]?.percent - (100.5 - Math.round(0.25 * 100))) < 1e-9,
  `percent=${body.usage?.windows?.[0]?.percent}`,
)

body = await probeBody('claude-sonnet-4-6', { pool: poolFixture() })
check('claude reads the anthropic counter', body.usage?.windows?.length === 2)
check(
  'claude reads the anthropic figure, not the google one',
  Math.abs(body.usage?.windows?.[0]?.percent - (100.5 - Math.round(0.6 * 100))) < 1e-9,
  `percent=${body.usage?.windows?.[0]?.percent}`,
)

body = await probeBody('gpt-oss-120b-medium', { pool: poolFixture() })
check('gpt-oss reads the openai counter', body.usage?.windows?.length === 2)
check(
  'gpt-oss reads the openai figure, not the google one',
  Math.abs(body.usage?.windows?.[0]?.percent - (100.5 - Math.round(0.4 * 100))) < 1e-9,
  `percent=${body.usage?.windows?.[0]?.percent}`,
)

body = await probeBody('gemini-4-argon-preview', { pool: poolFixture() })
check('argon is matched before gemini', body.usage?.windows?.length === 1, JSON.stringify(body.usage?.windows))
check('argon publishes one window', body.usage?.windows?.[0]?.key === 'weekly')
check(
  'argon reads the argon figure, not the google one',
  Math.abs(body.usage?.windows?.[0]?.percent - (100.5 - Math.round(0.3 * 100))) < 1e-9,
  `percent=${body.usage?.windows?.[0]?.percent}`,
)
check(
  'argon prefers the weekly figure over the 5-hour one',
  Math.abs(body.usage?.windows?.[0]?.percent - (100.5 - Math.round(0.9 * 100))) > 1e-9,
  `percent=${body.usage?.windows?.[0]?.percent}`,
)

body = await probeBody('some-unknown-model', { pool: poolFixture() })
check('an unknown slug degrades gracefully', body.ok === true && body.provider.usageApi === false)
check('an unknown slug explains itself', typeof body.note === 'string' && body.note.length > 0, body.note)

console.log('\n=== the sibling plugin is asked over loopback, with no credential ===')
{
  const { calls } = await probe('gemini-3.8-flash', { pool: poolFixture() })
  const request = calls.requests[0]
  check('the pool route is the one requested', request?.url.endsWith('/plugins/agy-link/pool'), request?.url)
  check('no other route is requested', calls.requests.length === 1, `${calls.requests.length} requests`)
  check('the request is a read', request?.method === 'GET', request?.method)
  check(
    'the request goes to the host the bubble is served from',
    request?.url.startsWith('http://127.0.0.1:60251/'),
    request?.url,
  )
  check(
    'the request carries no credential',
    request?.headers !== undefined &&
      Object.keys(request.headers).every((name) => name.toLowerCase() !== 'authorization'),
    JSON.stringify(request?.headers),
  )
  check('no credential is ever resolved', calls.credentials === 0, `${calls.credentials} resolutions`)
}

console.log('\n=== account selection mirrors the request path ===')
// The sibling plugin picks the account that would serve the request: the one
// pinned for the family. The global pointer it keeps for the UI can name a
// different account, and the card must not follow it.
body = await probeBody('gemini-3.8-flash', { pool: poolFixture() })
const google = body.usage?.windows?.[0]
check(
  'the google figure is the family pin, not the global pointer',
  google !== undefined && Math.abs(google.percent - (100.5 - Math.round(0.25 * 100))) < 1e-9,
  `percent=${google?.percent}`,
)
check(
  'the global pointer would have said something else',
  google !== undefined && Math.abs(google.percent - (100.5 - Math.round(0.8 * 100))) > 1e-9,
)

// dsh-agy-link only follows the pin when there is one. An unset pin falls
// through to the expiry order, and it must not match an account with no id.
// The named account frees up first, so the expiry order picks it: a pin that
// wrongly matched the id-less account would show the other figure.
body = await probeBody('gemini-3.8-flash', {
  pool: {
    mode: 'sticky',
    accounts: [
      { id: 'acc_b', enabled: true, quotas: { google: { remainingFraction: 0.25, resetTime: FAR_FUTURE, weeklyFraction: 0.25, weeklyResetTime: FAR_PAST } } },
      { enabled: true, quotas: { google: { remainingFraction: 0.5, resetTime: FAR_FUTURE, weeklyFraction: 0.5, weeklyResetTime: FAR_FUTURE } } },
    ],
  },
})
check(
  'an unset pin falls through instead of matching an account with no id',
  body.usage?.windows?.[0] !== undefined &&
    Math.abs(body.usage.windows[0].percent - (100.5 - Math.round(0.25 * 100))) < 1e-9,
  `percent=${body.usage?.windows?.[0]?.percent}`,
)

// An account with no id must never be picked by the pin, even when the pin is
// set to nothing.
body = await probeBody('gemini-3.8-flash', {
  pool: {
    mode: 'sticky',
    activeAccountIds: { google: undefined },
    accounts: [
      { id: 'acc_b', enabled: true, quotas: { google: { remainingFraction: 0.25, resetTime: FAR_FUTURE, weeklyFraction: 0.25, weeklyResetTime: FAR_PAST } } },
      { enabled: true, quotas: { google: { remainingFraction: 0.5, resetTime: FAR_FUTURE, weeklyFraction: 0.5, weeklyResetTime: FAR_FUTURE } } },
    ],
  },
})
check(
  'a pin set to nothing still falls through',
  body.usage?.windows?.[0] !== undefined &&
    Math.abs(body.usage.windows[0].percent - (100.5 - Math.round(0.25 * 100))) < 1e-9,
  `percent=${body.usage?.windows?.[0]?.percent}`,
)

body = await probeBody('gemini-3.8-flash', {
  pool: poolFixture({ mode: 'round-robin' }),
})
check(
  'round-robin picks the account that has gone longest unused',
  Math.abs(body.usage?.windows?.[0]?.percent - (100.5 - Math.round(0.8 * 100))) < 1e-9,
  `percent=${body.usage?.windows?.[0]?.percent}`,
)

body = await probeBody('gemini-3.8-flash', {
  pool: poolFixture({
    accounts: [
      {
        id: 'acc_a',
        enabled: true,
        quotas: { google: { remainingFraction: 0.05, resetTime: FAR_FUTURE, weeklyFraction: 0.5, weeklyResetTime: FAR_FUTURE } },
      },
      {
        id: 'acc_b',
        enabled: true,
        quotas: { google: { remainingFraction: 0.7, resetTime: FAR_FUTURE, weeklyFraction: 0.6, weeklyResetTime: FAR_FUTURE } },
      },
    ],
    activeAccountIds: { google: 'acc_a' },
  }),
})
check(
  'an account with a spent window is skipped',
  Math.abs(body.usage?.windows?.[0]?.percent - (100.5 - Math.round(0.7 * 100))) < 1e-9,
  `percent=${body.usage?.windows?.[0]?.percent}`,
)

// The weekly cap is a separate limit: an account can have 5-hour room left
// and still be spent for the week.
body = await probeBody('gemini-3.8-flash', {
  pool: poolFixture({
    accounts: [
      {
        id: 'acc_a',
        enabled: true,
        quotas: { google: { remainingFraction: 0.9, resetTime: FAR_FUTURE, weeklyFraction: 0.01, weeklyResetTime: FAR_FUTURE } },
      },
      {
        id: 'acc_b',
        enabled: true,
        quotas: { google: { remainingFraction: 0.7, resetTime: FAR_FUTURE, weeklyFraction: 0.6, weeklyResetTime: FAR_FUTURE } },
      },
    ],
    activeAccountIds: { google: 'acc_a' },
  }),
})
check(
  'an account with a spent weekly cap is skipped',
  Math.abs(body.usage?.windows?.[0]?.percent - (100.5 - Math.round(0.7 * 100))) < 1e-9,
  `percent=${body.usage?.windows?.[0]?.percent}`,
)

// A spent window that has already reset makes the account eligible again.
body = await probeBody('gemini-3.8-flash', {
  pool: poolFixture({
    accounts: [
      {
        id: 'acc_a',
        enabled: true,
        quotas: { google: { remainingFraction: 0.05, resetTime: FAR_PAST, weeklyFraction: 0.5, weeklyResetTime: FAR_FUTURE } },
      },
      {
        id: 'acc_b',
        enabled: true,
        quotas: { google: { remainingFraction: 0.7, resetTime: FAR_FUTURE, weeklyFraction: 0.6, weeklyResetTime: FAR_FUTURE } },
      },
    ],
    activeAccountIds: { google: 'acc_a' },
  }),
})
check(
  'an account whose window has reset is eligible again',
  Math.abs(body.usage?.windows?.[0]?.percent - (100.5 - Math.round(0.05 * 100))) < 1e-9,
  `percent=${body.usage?.windows?.[0]?.percent}`,
)

// An account in cooldown cannot serve the family until the cooldown ends.
body = await probeBody('gemini-3.8-flash', {
  pool: poolFixture({
    accounts: [
      {
        id: 'acc_a',
        enabled: true,
        cooldowns: { google: { cooldownUntil: Date.now() + 3_600_000 } },
        quotas: { google: { remainingFraction: 0.9, resetTime: FAR_FUTURE, weeklyFraction: 0.9, weeklyResetTime: FAR_FUTURE } },
      },
      {
        id: 'acc_b',
        enabled: true,
        quotas: { google: { remainingFraction: 0.7, resetTime: FAR_FUTURE, weeklyFraction: 0.6, weeklyResetTime: FAR_FUTURE } },
      },
    ],
    activeAccountIds: { google: 'acc_a' },
  }),
})
check(
  'an account in cooldown is skipped',
  Math.abs(body.usage?.windows?.[0]?.percent - (100.5 - Math.round(0.7 * 100))) < 1e-9,
  `percent=${body.usage?.windows?.[0]?.percent}`,
)

// A disabled account cannot serve the family either.
body = await probeBody('gemini-3.8-flash', {
  pool: poolFixture({
    accounts: [
      {
        id: 'acc_a',
        enabled: false,
        quotas: { google: { remainingFraction: 0.9, resetTime: FAR_FUTURE, weeklyFraction: 0.9, weeklyResetTime: FAR_FUTURE } },
      },
      {
        id: 'acc_b',
        enabled: true,
        quotas: { google: { remainingFraction: 0.7, resetTime: FAR_FUTURE, weeklyFraction: 0.6, weeklyResetTime: FAR_FUTURE } },
      },
    ],
    activeAccountIds: { google: 'acc_a' },
  }),
})
check(
  'a disabled account is skipped',
  Math.abs(body.usage?.windows?.[0]?.percent - (100.5 - Math.round(0.7 * 100))) < 1e-9,
  `percent=${body.usage?.windows?.[0]?.percent}`,
)

// A signed-out account cannot serve the family either, even though it is
// enabled and has quota to spare.
body = await probeBody('gemini-3.8-flash', {
  pool: poolFixture({
    accounts: [
      {
        id: 'acc_a',
        enabled: true,
        authRequired: true,
        quotas: { google: { remainingFraction: 0.9, resetTime: FAR_FUTURE, weeklyFraction: 0.9, weeklyResetTime: FAR_FUTURE } },
      },
      {
        id: 'acc_b',
        enabled: true,
        quotas: { google: { remainingFraction: 0.7, resetTime: FAR_FUTURE, weeklyFraction: 0.6, weeklyResetTime: FAR_FUTURE } },
      },
    ],
    activeAccountIds: { google: 'acc_a' },
  }),
})
check(
  'a signed-out account is skipped',
  Math.abs(body.usage?.windows?.[0]?.percent - (100.5 - Math.round(0.7 * 100))) < 1e-9,
  `percent=${body.usage?.windows?.[0]?.percent}`,
)

// When no account can serve the family, the card must not show a spent
// account's figures as if they were a live allowance.
body = await probeBody('gemini-3.8-flash', {
  pool: poolFixture({
    accounts: [
      {
        id: 'acc_a',
        enabled: true,
        cooldowns: { google: { cooldownUntil: Date.now() + 3_600_000 } },
        quotas: { google: { remainingFraction: 0.8, resetTime: FAR_FUTURE, weeklyFraction: 0.7, weeklyResetTime: FAR_FUTURE } },
      },
    ],
    activeAccountIds: { google: 'acc_a' },
  }),
})
check('no servable account shows no allowance', body.usage?.windows?.length === 0, JSON.stringify(body.usage?.windows))
check('no servable account degrades gracefully', body.ok === true && body.provider.usageApi === false)
check(
  'no servable account explains itself',
  typeof body.note === 'string' && body.note.length > 0,
  body.note,
)
// The pool was read and holds nothing for this model, which is not the same
// as a provider with no usage endpoint: the card must not say "no api".
check(
  'no servable account says the pool was read',
  body.provider.usageEmpty === true,
  `usageEmpty=${body.provider.usageEmpty}`,
)
check(
  'no servable account and an empty pool read differently',
  body.note !== 'No Antigravity account is configured yet.',
  body.note,
)
check(
  'no servable account says no account can serve',
  body.note === 'No Antigravity account can serve this model right now.',
  body.note,
)

// The exact threshold an account is dropped at: dsh-agy-link treats a share
// of 0.1 or less as spent, so a 0.1 account cannot serve and a 0.11 one can.
body = await probeBody('gemini-3.8-flash', {
  pool: poolFixture({
    accounts: [
      {
        id: 'acc_a',
        enabled: true,
        quotas: { google: { remainingFraction: 0.1, resetTime: FAR_FUTURE, weeklyFraction: 0.5, weeklyResetTime: FAR_FUTURE } },
      },
      {
        id: 'acc_b',
        enabled: true,
        quotas: { google: { remainingFraction: 0.11, resetTime: FAR_FUTURE, weeklyFraction: 0.6, weeklyResetTime: FAR_FUTURE } },
      },
    ],
    activeAccountIds: { google: 'acc_a' },
  }),
})
check(
  'a share of exactly 0.1 counts as spent',
  Math.abs(body.usage?.windows?.[0]?.percent - (100.5 - Math.round(0.11 * 100))) < 1e-9,
  `percent=${body.usage?.windows?.[0]?.percent}`,
)

// The same for the weekly cap: 0.05 or less is spent, 0.06 is not.
body = await probeBody('gemini-3.8-flash', {
  pool: poolFixture({
    accounts: [
      {
        id: 'acc_a',
        enabled: true,
        quotas: { google: { remainingFraction: 0.9, resetTime: FAR_FUTURE, weeklyFraction: 0.05, weeklyResetTime: FAR_FUTURE } },
      },
      {
        id: 'acc_b',
        enabled: true,
        quotas: { google: { remainingFraction: 0.7, resetTime: FAR_FUTURE, weeklyFraction: 0.06, weeklyResetTime: FAR_FUTURE } },
      },
    ],
    activeAccountIds: { google: 'acc_a' },
  }),
})
check(
  'a weekly share of exactly 0.05 counts as spent',
  Math.abs(body.usage?.windows?.[0]?.percent - (100.5 - Math.round(0.7 * 100))) < 1e-9,
  `percent=${body.usage?.windows?.[0]?.percent}`,
)

console.log('\n=== graceful degradation ===')
body = await probeBody('gemini-3.8-flash', {
  fetchImpl: async () => new Response('', { status: 404 }),
})
check('a missing sibling plugin degrades gracefully', body.ok === true && body.provider.usageApi === false)
check('a missing sibling plugin explains itself', typeof body.note === 'string' && body.note.length > 0, body.note)
check(
  'a missing sibling plugin says what to do about it',
  body.note === 'Install the dsh-agy-link plugin to read Antigravity quota.',
  body.note,
)
// The route was never reached, so this is a provider with no endpoint to read
// rather than a pool that holds nothing.
check(
  'a missing sibling plugin does not claim the pool was read',
  body.provider.usageEmpty !== true,
  `usageEmpty=${body.provider.usageEmpty}`,
)

body = await probeBody('gemini-3.8-flash', { pool: { mode: 'sticky', accounts: [] } })
check('an empty pool degrades gracefully', body.ok === true && body.provider.usageApi === false)
check(
  'an empty pool says the pool was read',
  body.provider.usageEmpty === true,
  `usageEmpty=${body.provider.usageEmpty}`,
)
check(
  'an empty pool and an unusable pool read differently',
  body.note === 'No Antigravity account is configured yet.',
  body.note,
)

body = await probeBody('gemini-3.8-flash', {
  pool: { mode: 'sticky', primaryAccountId: 'acc_a', accounts: [{ id: 'acc_a', enabled: true, quotas: {} }] },
})
check('an account with no counter degrades gracefully', body.ok === true && body.provider.usageApi === false)
check(
  'an account with no counter says the pool was read',
  body.provider.usageEmpty === true,
  `usageEmpty=${body.provider.usageEmpty}`,
)

body = await probeBody('gemini-3.8-flash', { origin: 'throw' })
check('a host with no origin degrades gracefully', body.ok === true && body.provider.usageApi === false)
check('a host with no origin explains itself', typeof body.note === 'string' && body.note.length > 0, body.note)

body = await probeBody('gemini-3.8-flash', {
  fetchImpl: async () => {
    const error = new TypeError('fetch failed')
    error.cause = { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }
    throw error
  },
})
check('an untrusted host certificate degrades gracefully', body.ok === true && body.provider.usageApi === false)
check('an untrusted host certificate explains itself', typeof body.note === 'string' && body.note.length > 0, body.note)

console.log('\n=== failures that are not "no number right now" ===')
body = await probeBody('gemini-3.8-flash', {
  fetchImpl: async () => {
    throw new Error('boom')
  },
})
check('an unreachable endpoint is a hard error', body.ok === false && body.error === 'network', body.error)

body = await probeBody('gemini-3.8-flash', {
  fetchImpl: async () => new Response('not json', { status: 200 }),
})
check('a malformed body is a hard error', body.ok === false && body.error === 'unexpected-response', body.error)

body = await probeBody('gemini-3.8-flash', {
  fetchImpl: async () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }),
})
check('a null body is a hard error', body.ok === false && body.error === 'unexpected-response', body.error)

body = await probeBody('gemini-3.8-flash', {
  fetchImpl: async () => {
    const error = new Error('aborted')
    error.name = 'AbortError'
    throw error
  },
})
check('a timeout is a hard error', body.ok === false && body.error === 'timeout', body.error)

// A timeout can also fire while the body is streaming, which reaches the JSON
// read rather than the fetch itself. That is still a timeout.
body = await probeBody('gemini-3.8-flash', {
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    },
  }),
})
check('a timeout while reading the body is a timeout', body.ok === false && body.error === 'timeout', body.error)

console.log('\n=== the card agrees with the sibling plugin ===')
// dsh-agy-link rounds the share still left to a whole percentage and colours
// that rounded number: 20% left or less is low, 50% or less is medium. The
// card colours with strict bounds, so the Host has to hand it a share that
// lands in the same band. This checks both against the shipped client.
const client = loadClientHelpers()
if (client === undefined) {
  check('the shipped client helpers could be read', false, 'client.js no longer matches the expected shape')
} else {
  let bandMismatch = 0
  let numberMismatch = 0
  for (let i = 0; i <= 20000; i += 1) {
    const remaining = i / 20000
    const shown = Math.round(remaining * 100)
    const upstreamBand = shown <= 20 ? 'error' : shown <= 50 ? 'warning' : 'success'
    const upstreamNumber = shown
    const result = await probeBody('gemini-3.8-flash', {
      pool: poolFixture({
        accounts: [
          {
            id: 'acc_a',
            enabled: true,
            quotas: { google: { remainingFraction: remaining, resetTime: FAR_FUTURE, weeklyFraction: remaining, weeklyResetTime: FAR_FUTURE } },
          },
        ],
        activeAccountIds: { google: 'acc_a' },
      }),
    })
    const entry = result.usage?.windows?.[0]
    if (entry === undefined) continue
    const left = client.leftOf(entry)
    // The shipped window carries its own status; the band must come from it.
    if (client.tone(left, entry.status) !== upstreamBand) bandMismatch += 1
    if (Math.round(left) !== upstreamNumber) numberMismatch += 1
  }
  check('the colour band matches the sibling plugin for every share', bandMismatch === 0, `${bandMismatch} mismatches`)
  check('the number matches the sibling plugin for every share', numberMismatch === 0, `${numberMismatch} mismatches`)

  // A window whose status is not "ok" paints as an error in the client, so the
  // Host must not hand one over for a healthy counter.
  const healthy = await probeBody('gemini-3.8-flash', { pool: poolFixture() })
  check(
    'a healthy window reports the ok status',
    healthy.usage?.windows?.length === 2 &&
      healthy.usage.windows.every((window) => window.status === 'ok'),
    JSON.stringify(healthy.usage?.windows?.map((window) => window.status)),
  )
  check(
    'the argon window reports the ok status too',
    (await probeBody('gemini-4-argon-preview', { pool: poolFixture() })).usage?.windows?.every(
      (window) => window.status === 'ok',
    ) === true,
  )
}

console.log('\n=== the card says which state it is in ===')
{
  const pill = loadPillWords()
  if (pill === undefined) {
    check('the shipped status pill could be read', false, 'client.js no longer matches the expected shape')
  } else {
    check('a live card says live', pill.words.live === 'live', pill.words.live)
    check('a failed card says offline', pill.words.offline === 'offline', pill.words.offline)
    check('a provider with no endpoint says no api', pill.words.static === 'no api', pill.words.static)
    check(
      'a pool that was read and holds nothing says no data',
      pill.words.nodata === 'no data',
      pill.words.nodata,
    )
    check(
      'no data is not the same word as no api',
      pill.words.nodata !== pill.words.static,
      `${pill.words.nodata} / ${pill.words.static}`,
    )
    // The card picks the mode from the payload, so the mode it picks for a
    // pool that was read and holds nothing has to be the one that says so.
    const mode = clientSrc.match(/providerInfo\.usageEmpty === true[\s\S]{0,40}?'(\w+)'/)
    check(
      'a pool that was read and holds nothing picks its own mode',
      mode !== null && mode[1] === 'nodata',
      mode === null ? 'the mode was not found' : mode[1],
    )
  }
}

console.log('\n=== other providers are untouched ===')
{
  const savedKey = process.env.MINIMAX_API_KEY
  delete process.env.MINIMAX_API_KEY
  const registered = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  try {
    mod.apply({
      inject: (deps, cb) =>
        cb({
          webServer: { register: (route) => { registered.push(route); return () => {} }, getOrigin: () => 'http://127.0.0.1:60251' },
          credentials: { resolve: async () => undefined },
          agentDefaultModel: { currentSelection: () => ({ provider: 'minimax', model: 'MiniMax-M3.1-Flash' }) },
          llm: { listConfigurableProviders: () => [], listModels: async () => [] },
          effect: (fn) => { fn(); return () => {} },
        }),
    })
    const route = registered.find((r) => r.path === '/plugin/quota-bubble')
    let payload
    await route.handler(
      { method: 'GET', url: '/plugin/quota-bubble' },
      { writeHead: () => {}, end: (text) => { payload = JSON.parse(text) } },
    )
    check('another provider still resolves a credential', payload.error === 'missing-credential', payload.error)
    check('another provider still names its own usage source', payload.provider?.usageSource === 'minimax', payload.provider?.usageSource)
  } finally {
    globalThis.fetch = originalFetch
    if (savedKey !== undefined) process.env.MINIMAX_API_KEY = savedKey
  }
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) {
  console.log('FAILURES:')
  for (const f of failed) console.log(` - ${f.name}${f.detail === undefined ? '' : ` (${f.detail})`}`)
  process.exitCode = 1
}
