/**
 * Host half of the quota bubble.
 *
 * Serves one same-origin JSON route that the Client half reads. The route
 * resolves the provider behind the running model from the Harness LLM service,
 * resolves that provider's credential through the harness credential seam (the
 * key never leaves the Host), probes the provider's usage or balance endpoint
 * where the provider exposes one, and normalizes the reply into a
 * provider-neutral payload.
 *
 * Provider identity is discovered live (ctx.llm.listProviders +
 * listConfigurableProviders + listModels), so switching the model in the
 * Harness switches the card without any manual configuration. Usage numbers are
 * only shown for providers that expose a real usage/balance API; the rest get
 * their identity and model plus an explicit "not exposed" state.
 */

const ROUTE_PATH = '/plugin/quota-bubble'
const CACHE_TTL_MS = 30_000
const CATALOG_TTL_MS = 10 * 60_000
const MODELS_TTL_MS = 10 * 60_000
const REQUEST_TIMEOUT_MS = 12_000
const USER_AGENT = 'dsh-quota-bubble/0.5.0'
const REVISION = 4

/**
 * Antigravity quota is not published by an OpenAI-shaped usage endpoint. It is
 * owned by the dsh-agy-link plugin, which holds the Google OAuth session and
 * keeps one counter per account and per model family. That plugin already
 * serves the counter on its own same-origin route, so the bubble reads it from
 * there instead of taking a second copy of the credential.
 */
const AGY_POOL_PATH = '/plugins/agy-link/pool'

/**
 * What the card says when the Antigravity counters are not readable. These
 * are "no live number right now" states rather than failures: the sibling
 * plugin may not be serving the pool at all, and the running model may not
 * draw down a counter this pool publishes.
 */
const AGY_NOTES = {
  'http-404': 'Install the dsh-agy-link plugin to read Antigravity quota.',
  'no-model-family': 'Antigravity does not publish a quota counter for this model.',
  'no-account': 'No Antigravity account is configured yet.',
  'no-eligible-account': 'No Antigravity account can serve this model right now.',
  'no-quota': 'The Antigravity account that would serve this model has no published counter yet.',
  'no-origin': 'The Antigravity quota endpoint is not reachable yet.',
  'tls-untrusted': 'The host certificate is not trusted, so the Antigravity quota cannot be read.',
}

const BRAND_LABELS = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI Codex',
  google: 'Google',
  'google-vertex': 'Google Vertex',
  antigravity: 'Antigravity',
  deepseek: 'DeepSeek',
  'deepseek-official': 'DeepSeek',
  'deepseek-account': 'DeepSeek Account',
  opencode: 'OpenCode Zen',
  'opencode-go': 'OpenCode Go',
  openrouter: 'OpenRouter',
  moonshotai: 'Moonshot AI',
  'moonshotai-cn': 'Moonshot AI (CN)',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax (CN)',
  mistral: 'Mistral',
  groq: 'Groq',
  cerebras: 'Cerebras',
  xai: 'xAI',
  zai: 'Z.AI',
  'zai-coding-cn': 'Z.AI (CN)',
  'kimi-coding': 'Kimi for Coding',
  'github-copilot': 'GitHub Copilot',
  'amazon-bedrock': 'Amazon Bedrock',
  azure: 'Azure OpenAI',
  cloudflare: 'Cloudflare',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway',
  'cloudflare-workers-ai': 'Cloudflare Workers AI',
  nvidia: 'NVIDIA',
  together: 'Together AI',
  fireworks: 'Fireworks',
  baseten: 'Baseten',
  huggingface: 'Hugging Face',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  radius: 'Radius',
  'ant-ling': 'Ant Ling',
  meta: 'Meta',
  xiaomi: 'Xiaomi',
  qwen: 'Qwen',
  'qwen-token-plan': 'Qwen Token Plan',
  'qwen-token-plan-cn': 'Qwen Token Plan (CN)',
  'qwen-token-plan-individual': 'Qwen Token Plan Individual',
}

const STRATEGIES = {
  'opencode-go': {
    kind: 'windows',
    usageEndpoint: 'https://opencode.ai/inference/go/v1/usage',
    credentialRefs: ['OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY'],
    windows: [
      { key: 'rolling', label: '5-hour' },
      { key: 'weekly', label: 'Weekly' },
      { key: 'monthly', label: 'Monthly' },
    ],
  },
  deepseek: {
    kind: 'balance',
    usageEndpoint: 'https://api.deepseek.com/user/balance',
    credentialRefs: ['DEEPSEEK_API_KEY'],
    currency: 'USD',
  },
  'deepseek-official': {
    kind: 'balance',
    usageEndpoint: 'https://api.deepseek.com/user/balance',
    credentialRefs: ['DEEPSEEK_API_KEY'],
    currency: 'USD',
  },
  openrouter: {
    kind: 'openrouter-key',
    usageEndpoint: 'https://openrouter.ai/api/v1/auth/key',
    credentialRefs: ['OPENROUTER_API_KEY'],
    currency: 'USD',
  },
  minimax: {
    kind: 'minimax',
    base: 'https://api.minimax.io',
    credentialRefs: ['MINIMAX_API_KEY'],
    currency: 'USD',
  },
  'minimax-cn': {
    kind: 'minimax',
    base: 'https://api.minimaxi.com',
    credentialRefs: ['MINIMAX_CN_API_KEY', 'MINIMAX_API_KEY'],
    currency: 'CNY',
  },
  moonshotai: {
    kind: 'balance',
    usageEndpoint: 'https://api.moonshot.ai/v1/users/me/balance',
    credentialRefs: ['MOONSHOT_API_KEY'],
    currency: 'USD',
  },
  'moonshotai-cn': {
    kind: 'balance',
    usageEndpoint: 'https://api.moonshot.cn/v1/users/me/balance',
    credentialRefs: ['MOONSHOT_API_KEY'],
    currency: 'CNY',
  },
  antigravity: {
    kind: 'agy-pool',
    poolPath: AGY_POOL_PATH,
  },
  groq: {
    kind: 'models-ping',
    usageEndpoint: 'https://api.groq.com/openai/v1/models',
    credentialRefs: ['GROQ_API_KEY'],
    source: 'groq',
  },
  together: {
    kind: 'models-ping',
    usageEndpoint: 'https://api.together.xyz/v1/models',
    credentialRefs: ['TOGETHER_API_KEY', 'TOGETHERAI_API_KEY'],
    source: 'together',
  },
  togetherai: {
    kind: 'models-ping',
    usageEndpoint: 'https://api.together.xyz/v1/models',
    credentialRefs: ['TOGETHER_API_KEY', 'TOGETHERAI_API_KEY'],
    source: 'together',
  },
  mistral: {
    kind: 'models-ping',
    usageEndpoint: 'https://api.mistral.ai/v1/models',
    credentialRefs: ['MISTRAL_API_KEY'],
    source: 'mistral',
  },
  openai: {
    kind: 'models-ping',
    usageEndpoint: 'https://api.openai.com/v1/models',
    credentialRefs: ['OPENAI_API_KEY'],
    source: 'openai',
  },
  cerebras: {
    kind: 'models-ping',
    usageEndpoint: 'https://api.cerebras.ai/v1/models',
    credentialRefs: ['CEREBRAS_API_KEY'],
    source: 'cerebras',
  },
}

function words(text) {
  return String(text)
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
}

function titleCaseWord(word) {
  if (/^v\d/.test(word)) return `V${word.slice(1)}`
  if (/^[a-z]/.test(word)) return word.charAt(0).toUpperCase() + word.slice(1)
  return word
}

function providerLabel(providerId, catalog) {
  const entry = catalog.get(providerId)
  const declared = entry === undefined ? undefined : entry.displayName
  if (typeof declared === 'string' && declared.length > 0 && declared !== providerId) return declared
  if (BRAND_LABELS[providerId] !== undefined) return BRAND_LABELS[providerId]
  return words(providerId).map(titleCaseWord).join(' ')
}

function providerShort(label) {
  const parts = words(label)
  if (parts.length === 0) return 'Quota'
  if (parts.length === 1) return parts[0]
  return parts[parts.length - 1]
}

function numberOrUndefined(value) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value))
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Whether a fetch failed because the host's own certificate is not trusted.
 *
 * The bubble reaches the web server over loopback, so it is talking to the
 * process it is running inside. A host configured with a self-signed
 * certificate would otherwise look like an unreachable endpoint.
 */
function tlsUntrusted(error) {
  const code = error?.cause?.code
  return code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN'
}

/**
 * The Antigravity model slug -> the quota counter family that bills it.
 *
 * Mirrors the family rules dsh-agy-link applies when it charges a request, so
 * the bubble reads the counter the running model actually draws down. Argon
 * bills against its own weekly pool and its ids look like "gemini-4-argon-*",
 * so it must be matched before the Gemini prefix.
 */
function agyFamilyOf(modelId) {
  if (typeof modelId !== 'string' || modelId.length === 0) return undefined
  const id = modelId.toLowerCase()
  if (id.includes('argon')) return 'argon'
  if (id.startsWith('claude-') || id.includes('claude')) return 'anthropic'
  if (id.startsWith('gemini-') || id.startsWith('gemma-') || id.includes('gemini')) return 'google'
  if (id.startsWith('gpt-') || id.startsWith('openai/') || id.includes('gpt-oss')) return 'openai'
  return undefined
}

/**
 * A remaining fraction (0..1) -> the percent-consumed the card renders.
 *
 * dsh-agy-link rounds the share still left to a whole percentage and colours
 * that rounded number: 20% left or less is low, 50% or less is medium. The
 * card colours the share it is handed with strict bounds instead, so the
 * rounded share travels half a point under the whole percentage it stands
 * for. The number on screen and the band it lands in then match the counters
 * the sibling plugin shows, for every share a quota can take.
 */
function agyUsedPercent(remainingFraction) {
  const remaining = numberOrUndefined(remainingFraction)
  if (remaining === undefined) return undefined
  const shown = Math.round(Math.min(1, Math.max(0, remaining)) * 100)
  return 100.5 - shown
}

function isoOrUndefined(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Account identity for selection. Sign-in, disabling, and family cooldown
 * determine whether an account can serve; the reported counters are separate.
 */
function agyEligible(account, family, now) {
  if (account === null || typeof account !== 'object') return false
  if (!account.enabled || account.authRequired) return false
  const cooldown = account.cooldowns?.[family]
  if (cooldown !== null && typeof cooldown === 'object') {
    const until = numberOrUndefined(cooldown.cooldownUntil)
    if (until !== undefined && until > now) return false
  }
  return true
}

/** Whether the account's reported counters can serve the current request. */
function agyAccountAvailable(account, family, now) {
  if (!agyEligible(account, family, now)) return false
  const quota = account?.quotas?.[family]
  if (quota === null || typeof quota !== 'object') return false
  if (typeof quota.remainingFraction === 'number' && quota.remainingFraction <= 0.1) {
    const reset = Date.parse(isoOrUndefined(quota.resetTime) ?? '')
    if (Number.isNaN(reset) || reset > now) return false
  }
  if (typeof quota.weeklyFraction === 'number' && quota.weeklyFraction <= 0.05) {
    const reset = Date.parse(isoOrUndefined(quota.weeklyResetTime) ?? '')
    if (Number.isNaN(reset) || reset > now) return false
  }
  return true
}

/**
 * Mirrors the account selection used by dsh-agy-link to answer a request.
 * Sign-in is not enough to promise that the selected account can serve; the
 * probe checks the returned account's counters separately.
 */
function agySelectAccount(pool, family, now) {
  const accounts = Array.isArray(pool?.accounts) ? pool.accounts : []
  const candidates = accounts.filter((account) => agyAccountAvailable(account, family, now))
  if (candidates.length === 0) return undefined
  if (candidates.length > 1 && pool?.mode === 'round-robin') {
    let picked = candidates[0]
    for (const account of candidates) {
      if ((account?.lastUsedAt ?? 0) < (picked?.lastUsedAt ?? 0)) picked = account
    }
    return picked
  }
  const pinned = pool?.activeAccountIds?.[family]
  if (pinned) {
    const pinnedAccount = candidates.find((account) => account?.id === pinned)
    if (pinnedAccount !== undefined) return pinnedAccount
  }
  return agyOrderByExpiry(accounts, candidates, family, pinned)[0]
}

/**
 * "Use it or lose it" rotation order: the account whose weekly cap frees up
 * soonest first, then the one whose 5-hour window frees up soonest, then pool
 * order measured cyclically from the family's current account.
 */
function agyOrderByExpiry(accounts, candidates, family, fromId) {
  const now = Date.now()
  const total = accounts.length
  const distance = (id) => {
    const index = accounts.findIndex((account) => account?.id === id)
    if (index === -1) return Number.MAX_SAFE_INTEGER
    if (fromId === undefined) return index
    const start = accounts.findIndex((account) => account?.id === fromId)
    if (start === -1) return index
    return (index - start + total) % total
  }
  const remaining = (value) => {
    const at = Date.parse(isoOrUndefined(value) ?? '')
    return Number.isNaN(at) ? undefined : Math.max(0, at - now)
  }
  return candidates.slice().sort((a, b) => {
    const weeklyA = remaining(a?.quotas?.[family]?.weeklyResetTime)
    const weeklyB = remaining(b?.quotas?.[family]?.weeklyResetTime)
    if (weeklyA !== undefined && weeklyB !== undefined) {
      if (weeklyA !== weeklyB) return weeklyA - weeklyB
    } else if (weeklyA !== undefined || weeklyB !== undefined) {
      return weeklyA !== undefined ? -1 : 1
    }
    const rollingA = remaining(a?.quotas?.[family]?.resetTime)
    const rollingB = remaining(b?.quotas?.[family]?.resetTime)
    if (rollingA !== undefined && rollingB !== undefined) {
      if (rollingA !== rollingB) return rollingA - rollingB
    } else if (rollingA !== undefined || rollingB !== undefined) {
      return rollingA !== undefined ? -1 : 1
    }
    const distanceA = distance(a?.id)
    const distanceB = distance(b?.id)
    return distanceA !== distanceB ? distanceA - distanceB : 0
  })
}

/**
 * The family's counters as the card's windows. The pool reports the share
 * still left in each window; the card renders the share consumed.
 *
 * Argon bills against one pool of its own, so dsh-agy-link shows a single
 * number for it and copies the 5-hour reading into the weekly slot. The card
 * follows: one window, not two bars holding the same figure.
 */
function agyWindows(account, family) {
  const quota = account?.quotas?.[family]
  if (quota === null || typeof quota !== 'object') return undefined
  const windows = []
  if (family === 'argon') {
    const percent = agyUsedPercent(quota.weeklyFraction ?? quota.remainingFraction)
    if (percent === undefined) return undefined
    windows.push({
      key: 'weekly',
      label: 'Weekly',
      percent,
      status: 'ok',
      resetsAt: isoOrUndefined(quota.weeklyResetTime ?? quota.resetTime),
    })
    return windows
  }
  const rolling = agyUsedPercent(quota.remainingFraction)
  if (rolling !== undefined) {
    windows.push({ key: 'rolling', label: '5-hour', percent: rolling, status: 'ok', resetsAt: isoOrUndefined(quota.resetTime) })
  }
  const weekly = agyUsedPercent(quota.weeklyFraction)
  if (weekly !== undefined) {
    windows.push({ key: 'weekly', label: 'Weekly', percent: weekly, status: 'ok', resetsAt: isoOrUndefined(quota.weeklyResetTime) })
  }
  return windows.length === 0 ? undefined : windows
}

export function apply(ctx) {
  ctx.inject(['webServer', 'credentials', 'agentDefaultModel', 'llm'], (inner) => {
    const cache = new Map()
    let catalogCache
    const modelsCache = new Map()

    async function resolveSessionModel(sessionId) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
      try {
        const sc = ctx.get ? ctx.get('sessionController') : ctx.sessionController
        if (sc && typeof sc.resolveAgent === 'function') {
          const agent = await sc.resolveAgent(sessionId)
          const current = agent?.model?.current?.()
          if (current && typeof current.provider === 'string' && typeof current.model === 'string') {
            return {
              provider: current.provider,
              model: current.model,
              reasoningEffort: typeof current.reasoningEffort === 'string' ? current.reasoningEffort : undefined,
            }
          }
        }
      } catch {}
      try {
        const sessions = ctx.get ? ctx.get('sessions') : ctx.sessions
        const s = sessions?.get?.(sessionId)
        const cfg = s?.requestHeader?.()?.config
        if (cfg && typeof cfg.provider === 'string' && typeof cfg.model === 'string') {
          return {
            provider: cfg.provider,
            model: cfg.model,
            reasoningEffort: typeof cfg.reasoningEffort === 'string' ? cfg.reasoningEffort : undefined,
          }
        }
      } catch {}
      return undefined
    }

    function runningModel(override) {
      if (override && typeof override.provider === 'string' && typeof override.model === 'string') {
        return {
          provider: override.provider,
          model: override.model,
          reasoningEffort: typeof override.reasoningEffort === 'string' ? override.reasoningEffort : undefined,
        }
      }
      try {
        const selection = inner.agentDefaultModel.currentSelection()
        if (selection === undefined || selection === null) return undefined
        return {
          provider: typeof selection.provider === 'string' ? selection.provider : undefined,
          model: typeof selection.model === 'string' ? selection.model : undefined,
          reasoningEffort: typeof selection.reasoningEffort === 'string' ? selection.reasoningEffort : undefined,
        }
      } catch {
        return undefined
      }
    }

    function loadCatalog() {
      if (catalogCache !== undefined && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.map
      const map = new Map()
      try {
        for (const entry of inner.llm.listConfigurableProviders()) {
          if (entry !== null && typeof entry === 'object' && typeof entry.provider === 'string') map.set(entry.provider, entry)
        }
      } catch {
        return catalogCache === undefined ? map : catalogCache.map
      }
      catalogCache = { at: Date.now(), map }
      return map
    }

    async function loadModels(providerId) {
      const cached = modelsCache.get(providerId)
      if (cached !== undefined && Date.now() - cached.at < MODELS_TTL_MS) return cached.models
      try {
        const models = await inner.llm.listModels(providerId)
        if (Array.isArray(models)) {
          if (modelsCache.size > 20) {
            const oldest = modelsCache.keys().next().value
            modelsCache.delete(oldest)
          }
          modelsCache.set(providerId, { at: Date.now(), models })
          return models
        }
      } catch {
        /* model catalog is optional for the card */
      }
      return []
    }

    function displayNameOf(models, modelId) {
      if (typeof modelId !== 'string') return undefined
      const hit = models.find((model) => model !== null && typeof model === 'object' && (model.id === modelId || model.model === modelId))
      if (hit === undefined) return undefined
      return typeof hit.name === 'string' && hit.name.length > 0 ? hit.name : undefined
    }

    async function resolveCredential(refs) {
      for (const ref of refs) {
        try {
          const hit = await inner.credentials.resolve(ref)
          if (hit !== undefined && hit !== null && typeof hit.value === 'string' && hit.value.length > 0) {
            return { key: hit.value, ref }
          }
        } catch {
          /* fall through to the ambient environment */
        }
        const ambient = process.env[ref]
        if (typeof ambient === 'string' && ambient.length > 0) return { key: ambient, ref }
      }
      return undefined
    }

    async function getJson(url, key) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const headers = { accept: 'application/json', 'user-agent': USER_AGENT }
        if (typeof key === 'string') headers.authorization = `Bearer ${key}`
        const response = await fetch(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        })
        if (!response.ok) return { failure: `http-${response.status}` }
        try {
          return { body: await response.json() }
        } catch (error) {
          // A timeout that fires while the body is streaming arrives here, not
          // at the fetch itself, so it is a timeout and not a bad answer.
          if (error?.name === 'AbortError') return { failure: 'timeout' }
          return { failure: 'unexpected-response' }
        }
      } catch (error) {
        if (error?.name === 'AbortError') return { failure: 'timeout' }
        return { failure: 'network', detail: tlsUntrusted(error) ? 'tls-untrusted' : undefined }
      } finally {
        clearTimeout(timer)
      }
    }

    function opencodeWindows(definition, usage) {
      return definition.map((window) => {
        const entry = usage === null || usage === undefined ? undefined : usage[window.key]
        return {
          key: window.key,
          label: window.label,
          percent: typeof entry?.percent === 'number' ? entry.percent : undefined,
          status: typeof entry?.status === 'string' ? entry.status : undefined,
          resetsAt: typeof entry?.resetsAt === 'string' ? entry.resetsAt : undefined,
        }
      })
    }

    function deepseekBalance(body) {
      const infos = body !== null && typeof body === 'object' && Array.isArray(body.balance_infos) ? body.balance_infos : []
      const info = infos.find((candidate) => numberOrUndefined(candidate?.total_balance) !== undefined)
      if (info === undefined) return undefined
      const amount = numberOrUndefined(info.total_balance)
      if (amount === undefined) return undefined
      return {
        amount,
        currency: typeof info.currency === 'string' ? info.currency : 'USD',
        label: 'DeepSeek balance',
      }
    }

    function openRouterKey(body) {
      const data = body !== null && typeof body === 'object' && typeof body.data === 'object' ? body.data : undefined
      if (data === undefined) return undefined
      const remaining = numberOrUndefined(data.limit_remaining)
      const limit = numberOrUndefined(data.limit)
      const usage = numberOrUndefined(data.usage)
      const windows = []
      if (limit !== undefined && limit > 0 && usage !== undefined) {
        windows.push({
          key: 'key',
          label: 'Key limit',
          percent: Math.min(100, Math.max(0, (usage / limit) * 100)),
          status: 'ok',
          resetsAt: undefined,
        })
      }
      const balance =
        remaining === undefined
          ? undefined
          : { amount: remaining, currency: 'USD', label: 'OpenRouter credits' }
      return { windows, balance }
    }

    function moonshotBalance(body, currency) {
      const data = body !== null && typeof body === 'object' && typeof body.data === 'object' ? body.data : undefined
      if (data === undefined) return undefined
      const amount =
        numberOrUndefined(data.available_balance) ??
        numberOrUndefined(data.cash_balance) ??
        numberOrUndefined(data.voucher_balance)
      if (amount === undefined) return undefined
      return { amount, currency, label: 'Moonshot balance' }
    }

    function minimaxPlan(body) {
      const rows = body !== null && typeof body === 'object' && Array.isArray(body.model_remains) ? body.model_remains : []
      const entry = rows.find((row) => row !== null && typeof row === 'object' && row.model_name === 'general') ?? rows[0]
      if (entry === null || entry === undefined) return undefined
      const usedPercent = (value) => {
        const remaining = numberOrUndefined(value)
        if (remaining === undefined) return undefined
        return Math.min(100, Math.max(0, 100 - remaining))
      }
      const rollingPercent = usedPercent(entry.current_interval_remaining_percent)
      const weeklyPercent = usedPercent(entry.current_weekly_remaining_percent)
      const windows = []
      if (rollingPercent !== undefined) {
        windows.push({
          key: 'rolling',
          label: '5-hour',
          percent: rollingPercent,
          status: 'ok',
          resetsAt: typeof entry.end_time === 'number' ? new Date(entry.end_time).toISOString() : undefined,
        })
      }
      if (weeklyPercent !== undefined) {
        windows.push({
          key: 'weekly',
          label: 'Weekly',
          percent: weeklyPercent,
          status: 'ok',
          resetsAt: typeof entry.weekly_end_time === 'number' ? new Date(entry.weekly_end_time).toISOString() : undefined,
        })
      }
      if (windows.length === 0) return undefined
      return { windows, balance: null }
    }

    function minimaxBalance(body, currency) {
      const data = body !== null && typeof body === 'object' && typeof body.data === 'object' ? body.data : body
      if (data === null || typeof data !== 'object') return undefined
      const amount =
        numberOrUndefined(data.available_amount) ??
        numberOrUndefined(data.cash_balance) ??
        numberOrUndefined(data.credit_balance)
      if (amount === undefined) return undefined
      return { windows: [], balance: { amount, currency, label: 'MiniMax balance' } }
    }

    /**
     * The origin the Host half reaches its own web server on.
     *
     * dsh-agy-link serves the quota pool on the very listener the bubble is
     * served from, so the bubble reads it back over loopback instead of
     * keeping a second copy of the Google OAuth session. A wildcard bind has
     * no address of its own, and loopback reaches the same listener.
     */
    function loopbackOrigin() {
      let origin
      try {
        origin = inner.webServer.getOrigin()
      } catch {
        return undefined
      }
      if (typeof origin !== 'string' || origin.length === 0) return undefined
      try {
        // The bind address is always one concrete local interface: the web
        // server refuses a wildcard address, so this origin reaches the same
        // listener the bubble is served from.
        return new URL(origin).origin
      } catch {
        return undefined
      }
    }

    /**
     * The Antigravity counters, read from the pool dsh-agy-link already keeps.
     *
     * That plugin owns the Google OAuth session and one counter per account
     * and model family, and publishes them on its own route. The bubble asks
     * for the pool over loopback and sends no credential of its own: the
     * family comes from the running model's slug, and the account is the one
     * that would serve that family next, recomputed from the snapshot rather
     * than by asking the sibling plugin to pick one.
     */
    async function probeAgPool(strategy, modelId) {
      const family = agyFamilyOf(modelId)
      if (family === undefined) return { failure: 'no-model-family' }
      const origin = loopbackOrigin()
      if (origin === undefined) return { failure: 'no-origin' }
      const result = await getJson(`${origin}${strategy.poolPath}`, undefined)
      if (result.body === undefined) {
        // A host with an untrusted certificate is still reachable, so say that
        // rather than reporting the pool as missing.
        return { failure: result.detail === 'tls-untrusted' ? 'tls-untrusted' : result.failure }
      }
      if (result.body === null || typeof result.body !== 'object') return { failure: 'unexpected-response' }
      // The pool was read. Whatever follows is the pool's answer about this
      // model, not a problem reaching it.
      const accounts = Array.isArray(result.body.accounts) ? result.body.accounts : []
      if (accounts.length === 0) return { failure: 'no-account', poolRead: true }
      const now = Date.now()
      const account = agySelectAccount(result.body, family, now)
      if (account === undefined) return { failure: 'no-eligible-account', poolRead: true }
      if (!agyAccountAvailable(account, family, now)) return { failure: 'no-eligible-account', poolRead: true }
      const windows = agyWindows(account, family)
      if (windows === undefined) return { failure: 'no-quota', poolRead: true }
      const eligibleAccounts = accounts.filter((a) => agyAccountAvailable(a, family, now))
      const poolInfo = {
        totalAccounts: accounts.length,
        activeId: account.id,
        activeEmail: account.email ? (account.email.charAt(0).toUpperCase() + account.email.slice(1)) : account.id,
        eligibleCount: eligibleAccounts.length,
        nextEligibleId: eligibleAccounts.find((a) => a.id !== account.id)?.id,
      }
      return { windows, balance: null, poolInfo }
    }

    async function probeUsage(strategy, key, modelId) {
      if (strategy.kind === 'agy-pool') {
        return probeAgPool(strategy, modelId)
      }
      if (strategy.kind === 'models-ping') {
        const result = await getJson(strategy.usageEndpoint, key)
        if (result.body === undefined) return { failure: result.failure }
        if (result.body?.error) return { failure: result.body.error?.code ?? 'api-error' }
        const models = Array.isArray(result.body?.data) ? result.body.data : []
        return {
          windows: [],
          balance: null,
          note: `Active provider connection (${models.length} models available)`,
          usageSource: strategy.source,
        }
      }
      if (strategy.kind === 'minimax') {
        const paygo = typeof key === 'string' && key.startsWith('sk-api-')
        const endpoint = paygo ? `${strategy.base}/account/query_balance` : `${strategy.base}/v1/token_plan/remains`
        const result = await getJson(endpoint, key)
        if (result.body === undefined) return { failure: result.failure }
        const status = result.body?.base_resp?.status_code
        if (typeof status === 'number' && status !== 0) return { failure: `api-${status}` }
        if (paygo) {
          const parsed = minimaxBalance(result.body, strategy.currency)
          if (parsed === undefined) return { failure: 'unexpected-response' }
          return { ...parsed, endpoint }
        }
        const plan = minimaxPlan(result.body)
        if (plan === undefined) return { failure: 'unexpected-response' }
        return { ...plan, endpoint }
      }
      const result = await getJson(strategy.usageEndpoint, key)
      if (result.body === undefined) return { failure: result.failure }
      if (strategy.kind === 'windows') {
        const usage = result.body?.usage
        if (usage === undefined || usage === null) return { failure: 'unexpected-response' }
        return { windows: opencodeWindows(strategy.windows, usage), balance: null }
      }
      if (strategy.kind === 'balance' && strategy.usageEndpoint.includes('deepseek')) {
        const balance = deepseekBalance(result.body)
        if (balance === undefined) return { failure: 'unexpected-response' }
        return { windows: [], balance: { ...balance, currency: strategy.currency ?? balance.currency } }
      }
      if (strategy.kind === 'balance') {
        const balance = moonshotBalance(result.body, strategy.currency)
        if (balance === undefined) return { failure: 'unexpected-response' }
        return { windows: [], balance }
      }
      if (strategy.kind === 'openrouter-key') {
        const parsed = openRouterKey(result.body)
        if (parsed === undefined) return { failure: 'unexpected-response' }
        return parsed
      }
      return { failure: 'unsupported-strategy' }
    }

    async function probe(modelOverride) {
      const model = runningModel(modelOverride)
      const providerId = model === undefined ? undefined : model.provider
      const catalog = loadCatalog()
      if (providerId === undefined) {
        return { ok: false, error: 'no-model', runningModel: model, revision: REVISION }
      }
      const label = providerLabel(providerId, catalog)
      const short = providerShort(label)
      const provider = { id: providerId, label, short }

      const models = await loadModels(providerId)
      const displayName = displayNameOf(models, model.model)
      const runningModelPayload =
        model === undefined ? undefined : { ...model, displayName }

      const strategy = STRATEGIES[providerId]
      if (strategy === undefined) {
        return {
          ok: true,
          provider: { ...provider, usageApi: false, usageSource: null },
          runningModel: runningModelPayload,
          usage: { windows: [], balance: null },
          note: 'This provider does not expose a live usage or balance API.',
          fetchedAt: new Date().toISOString(),
          revision: REVISION,
        }
      }

      // Antigravity quota is owned by the dsh-agy-link plugin, which holds the
      // Google OAuth session and keeps the counters itself. The bubble resolves
      // no credential for it: it reads the counters that plugin already keeps.
      if (strategy.kind === 'agy-pool') {
        const usageResult = await probeUsage(strategy, undefined, model.model)
        if (usageResult.failure !== undefined) {
          const note = AGY_NOTES[usageResult.failure]
          if (note !== undefined) {
            return {
              ok: true,
              // The pool route was read; it simply holds nothing for this
              // model right now. That is not the same as a provider with no
              // usage endpoint, and the card says so.
              provider: {
                ...provider,
                usageApi: false,
                usageSource: null,
                usageEmpty: usageResult.poolRead === true,
              },
              runningModel: runningModelPayload,
              usage: { windows: [], balance: null },
              note,
              fetchedAt: new Date().toISOString(),
              revision: REVISION,
            }
          }
          return {
            ok: false,
            error: usageResult.failure,
            provider: { ...provider, usageApi: true, usageSource: strategy.kind },
            endpoint: strategy.poolPath,
            runningModel: runningModelPayload,
            revision: REVISION,
          }
        }
        return {
          ok: true,
          provider: { ...provider, usageApi: true, usageSource: 'windows' },
          usage: usageResult,
          poolInfo: usageResult.poolInfo,
          endpoint: strategy.poolPath,
          runningModel: runningModelPayload,
          fetchedAt: new Date().toISOString(),
          revision: REVISION,
        }
      }

      const credential = await resolveCredential(strategy.credentialRefs)
      if (credential === undefined) {
        return {
          ok: false,
          error: 'missing-credential',
          provider: { ...provider, usageApi: true, usageSource: strategy.kind },
          credentialRefs: strategy.credentialRefs,
          runningModel: runningModelPayload,
          revision: REVISION,
        }
      }

      const usageResult = await probeUsage(strategy, credential.key, model.model)
      if (usageResult.failure !== undefined) {
        return {
          ok: false,
          error: usageResult.failure,
          provider: { ...provider, usageApi: true, usageSource: strategy.kind },
          endpoint: usageResult.endpoint ?? strategy.usageEndpoint,
          runningModel: runningModelPayload,
          revision: REVISION,
        }
      }

      return {
        ok: true,
        provider: {
          ...provider,
          usageApi: true,
          usageSource:
            usageResult.usageSource ??
            (usageResult.windows && usageResult.windows.length > 0
              ? 'windows'
              : usageResult.balance !== null
                ? 'balance'
                : 'models-ping'),
        },
        usage: usageResult,
        poolInfo: usageResult.poolInfo,
        note: usageResult.note,
        credentialRef: credential.ref,
        endpoint: usageResult.endpoint ?? strategy.usageEndpoint,
        runningModel: runningModelPayload,
        fetchedAt: new Date().toISOString(),
        revision: REVISION,
      }
    }

    function sendJson(res, body) {
      const text = JSON.stringify(body)
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': String(Buffer.byteLength(text)),
      })
      res.end(text)
    }

    return inner.effect(() =>
      inner.webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405, { allow: 'GET' })
            res.end()
            return
          }
          const query = new URL(req.url ?? ROUTE_PATH, 'http://localhost').searchParams
          const force = query.get('refresh') === '1'
          let modelOverride
          const qProvider = query.get('provider')
          const qModel = query.get('model')
          const qEffort = query.get('reasoningEffort')
          if (typeof qProvider === 'string' && qProvider.length > 0 && typeof qModel === 'string' && qModel.length > 0) {
            modelOverride = {
              provider: qProvider,
              model: qModel,
              reasoningEffort: typeof qEffort === 'string' && qEffort.length > 0 ? qEffort : undefined,
            }
          } else {
            const sessionId = query.get('session')
            if (typeof sessionId === 'string' && sessionId.length > 0) {
              modelOverride = await resolveSessionModel(sessionId)
            }
          }
          const model = runningModel(modelOverride)
          const key = model === undefined ? 'none' : `${model.provider ?? ''}|${model.model ?? ''}${model.reasoningEffort ? `|${model.reasoningEffort}` : ''}`
          const cached = cache.get(key)
          if (force || cached === undefined || Date.now() - cached.at > CACHE_TTL_MS) {
            const body = await probe(model)
            if (cache.size > 50) {
              const oldestKey = cache.keys().next().value
              cache.delete(oldestKey)
            }
            cache.set(key, { at: Date.now(), body })
          }
          const entry = cache.get(key)
          sendJson(res, entry.body)
        },
      }),
    )
  })
}
