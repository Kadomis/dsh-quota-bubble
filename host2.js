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
const REVISION = 2

const BRAND_LABELS = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI Codex',
  google: 'Google',
  'google-vertex': 'Google Vertex',
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

export function apply(ctx) {
  ctx.inject(['webServer', 'credentials', 'agentDefaultModel', 'llm'], (inner) => {
    let cache
    let catalogCache
    const modelsCache = new Map()
    function runningModel() {
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
        return { body: await response.json() }
      } catch (error) {
        return { failure: error?.name === 'AbortError' ? 'timeout' : 'network' }
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

    async function probeUsage(strategy, key) {
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

    async function probe() {
      const model = runningModel()
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

      const usageResult = await probeUsage(strategy, credential.key)
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
          usageSource: usageResult.balance === null ? 'windows' : 'balance',
        },
        usage: usageResult,
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
          const model = runningModel()
          const key = model === undefined ? 'none' : `${model.provider ?? ''}|${model.model ?? ''}`
          if (force || cache === undefined || cache.key !== key || Date.now() - cache.at > CACHE_TTL_MS) {
            const body = await probe()
            cache = { key, at: Date.now(), body }
          }
          sendJson(res, cache.body)
        },
      }),
    )
  })
}
