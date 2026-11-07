#!/usr/bin/env node
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

console.log('=== Host session and provider switching ===')

const hostMod = await import(`data:text/javascript;base64,${Buffer.from(hostSrc).toString('base64')}`)

async function createHostContext(sessions = {}) {
  const registered = []
  const inner = {
    webServer: {
      register: (route) => {
        registered.push(route)
        return () => {}
      },
      getOrigin: () => 'http://127.0.0.1:60251',
    },
    credentials: {
      resolve: async () => 'test-key',
    },
    agentDefaultModel: {
      currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
    },
    llm: {
      listConfigurableProviders: () => [
        { provider: 'deepseek', label: 'DeepSeek' },
        { provider: 'minimax', label: 'MiniMax' },
        { provider: 'opencode-go', label: 'OpenCode Go' },
      ],
      listModels: async (providerId) => [
        { id: 'deepseek-chat', name: 'DeepSeek-V3' },
        { id: 'abab6.5s-chat', name: 'MiniMax-Text-01' },
      ],
    },
  }

  const rootCtx = {
    inject: (deps, cb) => cb({ ...inner, effect: (fn) => { fn(); return () => {} } }),
    get: (name) => {
      if (name === 'sessionController') return rootCtx.sessionController
      return undefined
    },
    sessionController: {
      resolveAgent: async (sessionId) => {
        const target = sessions[sessionId]
        if (!target) return undefined
        return {
          model: {
            current: () => target,
          },
        }
      },
    },
  }

  hostMod.apply(rootCtx)
  const route = registered.find((r) => r.path === '/plugin/quota-bubble')
  if (!route) throw new Error('Route not registered')

  return async function invokeRoute(url) {
    let payload
    await route.handler(
      { method: 'GET', url },
      { writeHead: () => {}, end: (text) => { payload = JSON.parse(text) } },
    )
    return payload
  }
}

// 1. Host route default selection
const invokeDefault = await createHostContext({
  'session-a': { provider: 'minimax', model: 'abab6.5s-chat' },
  'session-b': { provider: 'deepseek', model: 'deepseek-chat' },
})

const defaultPayload = await invokeDefault('/plugin/quota-bubble')
check(
  'default route uses agentDefaultModel when no params passed',
  defaultPayload?.runningModel?.provider === 'deepseek' && defaultPayload?.runningModel?.model === 'deepseek-chat',
  JSON.stringify(defaultPayload?.runningModel),
)

// 2. Host route resolves session model
const sessionAPayload = await invokeDefault('/plugin/quota-bubble?session=session-a')
check(
  'session-a query resolves session model from sessionController',
  sessionAPayload?.runningModel?.provider === 'minimax' && sessionAPayload?.runningModel?.model === 'abab6.5s-chat',
  JSON.stringify(sessionAPayload?.runningModel),
)

const sessionBPayload = await invokeDefault('/plugin/quota-bubble?session=session-b')
check(
  'session-b query switches to session-b provider and model',
  sessionBPayload?.runningModel?.provider === 'deepseek' && sessionBPayload?.runningModel?.model === 'deepseek-chat',
  JSON.stringify(sessionBPayload?.runningModel),
)

// 3. Provider and model query params override
const directOverridePayload = await invokeDefault(
  '/plugin/quota-bubble?provider=minimax&model=abab6.5s-chat&reasoningEffort=medium',
)
check(
  'direct provider and model query params override active selection',
  directOverridePayload?.runningModel?.provider === 'minimax' &&
    directOverridePayload?.runningModel?.model === 'abab6.5s-chat' &&
    directOverridePayload?.runningModel?.reasoningEffort === 'medium',
  JSON.stringify(directOverridePayload?.runningModel),
)

// 4. Cache isolation across sessions and providers
const sessionARepeat = await invokeDefault('/plugin/quota-bubble?session=session-a')
check(
  'switching back to session-a retrieves correct minimax model from cache',
  sessionARepeat?.runningModel?.provider === 'minimax' && sessionARepeat?.runningModel?.model === 'abab6.5s-chat',
  JSON.stringify(sessionARepeat?.runningModel),
)

// 5. Host fallback to ctx.sessions when sessionController is missing or has no match
async function createHostContextWithSessionsFallback(sessionConfigs = {}) {
  const registered = []
  const inner = {
    webServer: {
      register: (route) => {
        registered.push(route)
        return () => {}
      },
      getOrigin: () => 'http://127.0.0.1:60251',
    },
    credentials: {
      resolve: async () => 'test-key',
    },
    agentDefaultModel: {
      currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
    },
    llm: {
      listConfigurableProviders: () => [
        { provider: 'opencode-go', label: 'OpenCode Go' },
      ],
      listModels: async () => [{ id: 'opencode-model-1', name: 'OpenCode 1' }],
    },
  }

  const rootCtx = {
    inject: (deps, cb) => cb({ ...inner, effect: (fn) => { fn(); return () => {} } }),
    get: (name) => {
      if (name === 'sessions') return rootCtx.sessions
      return undefined
    },
    sessions: {
      get: (sessionId) => {
        const cfg = sessionConfigs[sessionId]
        if (!cfg) return undefined
        return {
          requestHeader: () => ({ config: cfg }),
        }
      },
    },
  }

  hostMod.apply(rootCtx)
  const route = registered.find((r) => r.path === '/plugin/quota-bubble')
  return async function invokeRoute(url) {
    let payload
    await route.handler(
      { method: 'GET', url },
      { writeHead: () => {}, end: (text) => { payload = JSON.parse(text) } },
    )
    return payload
  }
}

const invokeFallback = await createHostContextWithSessionsFallback({
  'session-fallback': { provider: 'opencode-go', model: 'opencode-model-1' },
})
const fallbackPayload = await invokeFallback('/plugin/quota-bubble?session=session-fallback')
check(
  'host resolves session model via ctx.sessions fallback when sessionController is absent',
  fallbackPayload?.runningModel?.provider === 'opencode-go' && fallbackPayload?.runningModel?.model === 'opencode-model-1',
  JSON.stringify(fallbackPayload?.runningModel),
)

console.log('\n=== Client session and model resolution ===')

// Load client.js in a mocked browser context to inspect exported functions
let clientModule
const mockWindow = {
  __ModuleLoader__: {
    load: (def) => {
      clientModule = def
    },
  },
}
const mockDocument = {
  querySelector: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
  visibilityState: 'visible',
}
const mockReact = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useCallback: (fn) => fn,
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (init) => ({ current: init }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  Fragment: 'React.Fragment',
}

const runClient = new Function('window', 'document', 'require', clientSrc)
runClient(mockWindow, mockDocument, (mod) => {
  if (mod === 'react') return mockReact
  return {}
})

const plugin = clientModule.factory(() => mockReact)

check('client plugin exposes getActiveSessionId', typeof plugin.getActiveSessionId === 'function')
check('client plugin exposes getSessionModel', typeof plugin.getSessionModel === 'function')
check('client plugin exposes QuotaBubble component', typeof plugin.QuotaBubble === 'function')

// Test getActiveSessionId resolution strategies
const ctxUiSessionValue = {
  uiSession: {
    current: {
      value: { key: 'session-from-uiSession-value' },
    },
  },
}
check(
  'getActiveSessionId resolves from uiSession.current.value.key',
  plugin.getActiveSessionId(ctxUiSessionValue) === 'session-from-uiSession-value',
  plugin.getActiveSessionId(ctxUiSessionValue),
)

const ctxUiSessionSnapshot = {
  get: (name) => (name === 'uiSession' ? {
    current: {
      getSnapshot: () => ({ key: 'session-from-uiSession-snapshot' }),
    },
  } : undefined),
}
check(
  'getActiveSessionId resolves from uiSession.current.getSnapshot().key',
  plugin.getActiveSessionId(ctxUiSessionSnapshot) === 'session-from-uiSession-snapshot',
  plugin.getActiveSessionId(ctxUiSessionSnapshot),
)

const ctxSessionsList = {
  sessions: {
    list: {
      getSnapshot: () => ({
        byId: {
          s1: { id: 's1', retainedBy: { mainView: 0 } },
          s2: { id: 's2', retainedBy: { mainView: 1 } },
        },
      }),
    },
  },
}
check(
  'getActiveSessionId falls back to sessions.list with mainView > 0',
  plugin.getActiveSessionId(ctxSessionsList) === 's2',
  plugin.getActiveSessionId(ctxSessionsList),
)

// Test getSessionModel resolution strategies
const createStrictCordisProxy = (services) => {
  return new Proxy({}, {
    get(target, prop) {
      if (prop === 'reflect') {
        return {
          get: (name) => services[name],
        }
      }
      throw new Error(`cannot get property "${String(prop)}" without inject`)
    },
  })
}

const strictCordisCtx = createStrictCordisProxy({
  uiSession: {
    current: {
      value: { key: 'session-from-strict-cordis' },
    },
  },
  modelDirectories: {
    directoryFor: (sid) => ({
      store: {
        getSnapshot: () => ({
          current: { provider: 'opencode-go', model: 'opencode-model-strict', reasoningEffort: 'medium' },
        }),
      },
    }),
  },
})

check(
  'getActiveSessionId succeeds via reflect.get without inject throw on strict Cordis proxy',
  plugin.getActiveSessionId(strictCordisCtx) === 'session-from-strict-cordis',
  plugin.getActiveSessionId(strictCordisCtx),
)

const strictModel = plugin.getSessionModel(strictCordisCtx, 'session-from-strict-cordis')
check(
  'getSessionModel succeeds via reflect.get without inject throw on strict Cordis proxy',
  strictModel?.provider === 'opencode-go' && strictModel?.model === 'opencode-model-strict' && strictModel?.reasoningEffort === 'medium',
  JSON.stringify(strictModel),
)

const ctxModelDirectories = {
  modelDirectories: {
    directoryFor: (sid) => ({
      store: {
        getSnapshot: () => ({
          current: { provider: 'opencode-go', model: 'opencode-model-1', reasoningEffort: 'high' },
        }),
      },
    }),
  },
}
const m1 = plugin.getSessionModel(ctxModelDirectories, 'test-session')
check(
  'getSessionModel resolves from modelDirectories.directoryFor',
  m1?.provider === 'opencode-go' && m1?.model === 'opencode-model-1' && m1?.reasoningEffort === 'high',
  JSON.stringify(m1),
)

const ctxProjectionsFace = {
  sessions: {
    binding: (sid) => ({
      session: {
        projections: {
          faceOf: (name) => ({
            getSnapshot: () => ({ provider: 'minimax', model: 'abab6.5s-chat' }),
          }),
        },
      },
    }),
  },
}
const m2 = plugin.getSessionModel(ctxProjectionsFace, 'test-session')
check(
  'getSessionModel falls back to session projections faceOf modelSelection',
  m2?.provider === 'minimax' && m2?.model === 'abab6.5s-chat',
  JSON.stringify(m2),
)

const ctxProjectionValues = {
  sessions: {
    list: {
      getSnapshot: () => ({
        byId: {
          'test-session': {
            projectionValues: {
              modelSelection: { provider: 'deepseek', model: 'deepseek-coder' },
            },
          },
        },
      }),
    },
  },
}
const m3 = plugin.getSessionModel(ctxProjectionValues, 'test-session')
check(
  'getSessionModel falls back to projectionValues on session list snapshot',
  m3?.provider === 'deepseek' && m3?.model === 'deepseek-coder',
  JSON.stringify(m3),
)

// Test plugin registration and slot injection
const slotsRegistered = []
const mockSlotCtx = {
  slots: {
    inject: (name, cb) => cb(),
    register: (opts, comp) => {
      slotsRegistered.push({ opts, comp })
    },
  },
}
plugin.apply(mockSlotCtx)
const shellOverlay = slotsRegistered.find((s) => s.opts?.name === 'shell.overlay')
const bundleConfig = slotsRegistered.find((s) => s.opts?.name === 'plugins.bundle.config')

check(
  'plugin declares slots in inject',
  Array.isArray(plugin.inject) && plugin.inject.includes('slots') && plugin.inject.length === 1,
  JSON.stringify(plugin.inject),
)
check(
  'plugin.apply registers shell.overlay with id dsh-quota-bubble and order 39',
  shellOverlay?.opts?.name === 'shell.overlay' &&
    shellOverlay?.opts?.id === 'dsh-quota-bubble' &&
    shellOverlay?.opts?.order === 39 &&
    shellOverlay?.comp === plugin.QuotaBubble,
  JSON.stringify(shellOverlay?.opts),
)
check(
  'plugin.apply registers plugins.bundle.config with key dsh-quota-bubble',
  bundleConfig?.opts?.name === 'plugins.bundle.config' &&
    bundleConfig?.opts?.key === 'dsh-quota-bubble' &&
    bundleConfig?.comp === plugin.PluginSettingsCard,
  JSON.stringify(bundleConfig?.opts),
)

// Test shortcut registration
let shortcutRegistered
const mockShortcutCtx = {
  slots: { inject: () => {}, register: () => {} },
  shortcuts: {
    register: (def) => {
      shortcutRegistered = def
    },
  },
}
plugin.apply(mockShortcutCtx)
check(
  'plugin registers quota-bubble.toggle shortcut with Alt+Shift+B default',
  shortcutRegistered?.id === 'quota-bubble.toggle' &&
    shortcutRegistered?.defaultKeybinding === 'Alt+Shift+B' &&
    typeof shortcutRegistered?.run === 'function',
  JSON.stringify(shortcutRegistered),
)
check(
  'matchShortcut matches Alt+Shift+B key events and blocks Cmd quit conflicts',
  plugin.matchShortcut({ altKey: true, shiftKey: true, ctrlKey: false, metaKey: false, key: 'b' }, 'Alt+Shift+B') === true &&
    plugin.matchShortcut({ altKey: true, shiftKey: false, ctrlKey: false, metaKey: false, key: 'b' }, 'Alt+Shift+B') === false &&
    plugin.matchShortcut({ altKey: true, shiftKey: true, ctrlKey: false, metaKey: true, key: 'b' }, 'Alt+Shift+B') === false,
  'matchShortcut verification',
)

// Test semver comparison and update checker
check(
  'compareSemver correctly detects newer, older, and equal versions',
  plugin.compareSemver('0.2.0', '0.1.0') > 0 &&
    plugin.compareSemver('0.1.1', '0.1.0') > 0 &&
    plugin.compareSemver('0.1.0', '0.1.0') === 0 &&
    plugin.compareSemver('0.0.9', '0.1.0') < 0 &&
    plugin.compareSemver('v1.0.0', '0.9.9') > 0,
  'compareSemver verification',
)
const updateResult = await plugin.checkPluginUpdate(false)
check(
  'checkPluginUpdate returns valid status and latestVersion object',
  typeof updateResult === 'object' &&
    ['up-to-date', 'update-available', 'checking'].includes(updateResult.status) &&
    typeof updateResult.latestVersion === 'string',
  JSON.stringify(updateResult),
)

// Test sentence case formatting for email
check(
  'toSentenceCase capitalizes first letter of email address',
  plugin.toSentenceCase('user@example.com') === 'User@example.com' &&
    plugin.toSentenceCase('john.doe@gmail.com') === 'John.doe@gmail.com' &&
    plugin.toSentenceCase('Account_1') === 'Account_1' &&
    plugin.toSentenceCase('') === '',
  'toSentenceCase verification',
)

// Test Live Countdown Timer formatting
const testBaseTime = 1700000000000
check(
  'resetText formats live second-accurate countdowns and past timestamps',
  plugin.resetText(new Date(testBaseTime + 45_000).toISOString(), testBaseTime) === 'in 45s' &&
    plugin.resetText(new Date(testBaseTime + 14 * 60_000 + 23_000).toISOString(), testBaseTime) === 'in 14m 23s' &&
    plugin.resetText(new Date(testBaseTime + 14 * 60_000).toISOString(), testBaseTime) === 'in 14m' &&
    plugin.resetText(new Date(testBaseTime + 2 * 3600_000 + 15 * 60_000).toISOString(), testBaseTime) === 'in 2h 15m' &&
    plugin.resetText(new Date(testBaseTime - 5000).toISOString(), testBaseTime) === 'resetting now' &&
    plugin.resetText(undefined) === '',
  'resetText verification',
)

// Test Burn Rate and Runway Estimation
const baselineRunway = plugin.computeSessionRunway(75, { turns: 5, totalTokens: 12000 }, { startLeft: 85, startTurns: 1 })
const emptyRunway = plugin.computeSessionRunway(75, { turns: 0, totalTokens: 0 }, null)
const lowRunway = plugin.computeSessionRunway(10, { turns: 10, totalTokens: 40000 }, { startLeft: 90, startTurns: 2 })
check(
  'computeSessionRunway estimates remaining turns and flags low quota accurately',
  baselineRunway !== null &&
    baselineRunway.turnsLeft === 30 &&
    baselineRunway.badge === '~30 turns left' &&
    baselineRunway.isLow === false &&
    emptyRunway === null &&
    lowRunway !== null &&
    lowRunway.isLow === true &&
    lowRunway.turnsLeft === 1,
  JSON.stringify({ baselineRunway, emptyRunway, lowRunway }),
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) process.exit(1)
