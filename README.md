# Quota Bubble

> Live allowance, balance and usage for the model you are running in the DeepSeek Harness — read straight from the provider, never estimated.

![Quota Bubble](https://raw.githubusercontent.com/Kadomis/dsh-quota-bubble/main/preview.png)

`MIT licensed` · `DeepSeek Harness 0.2.1-rc.5+` · `follows every provider`

## Why it exists

Cloud model usage is scattered across dashboards, invoices and environment variables. Quota Bubble keeps the one number you actually need — how much room you have left — in the corner of the panel you are already working in.

## What you get

- **A living readout, not a snapshot.** The card follows the running model and provider and refreshes itself as the numbers move.
- **Provider truth only.** Allowances, balances and limits are probed from the provider's own endpoint. If a probe is unavailable, the card says `NO API` instead of inventing a figure.
- **Built for a glance.** Allowance bars show the window, the percentage and the reset countdown; collapse it to a pill that still carries every window.
- **Quietly polished.** A light glass squircle, official provider and model marks, and motion that respects `prefers-reduced-motion`.

## Install

```text
plugin_manager install_bundle target="dsh-quota-bubble@0.1.0"
```

Requires **DeepSeek Harness 0.2.1-rc.5** or newer. No setup inside the plugin: as soon as your credentials are available to the Harness, the bubble starts reading.

## Provider coverage

The bubble follows the entire Harness provider catalog automatically. Where an endpoint is wired, numbers are live; where it is not wired yet, the card still tracks the provider and model but shows `NO API`.

### Live now

| Provider | What the card reads |
|---|---|
| OpenCode Go | 5-hour, weekly and monthly allowance |
| MiniMax — M Plan key (`sk-cp-…`) | 5-hour and weekly allowance |
| MiniMax — pay-as-you-go key (`sk-api-…`) | Account balance |
| DeepSeek | Account balance |
| OpenRouter | Key limit, usage and remaining credits |
| Moonshot | Account balance |

### Known APIs, not wired yet

These providers expose usage or balance endpoints that the bubble does not connect to yet. Until then the card shows `NO API` while continuing to follow the provider and model correctly:

Anthropic · OpenAI · OpenAI Codex · Google · Google Vertex · xAI · Mistral · Groq · Cerebras · NVIDIA · Together AI · Fireworks · Baseten · Hugging Face · Meta · Qwen Token Plan (Global, CN, Individual) · Kimi for Coding · Z.AI (Global, CN) · Xiaomi MiMo token plans · GitHub Copilot · Amazon Bedrock · Azure OpenAI · Vercel AI Gateway · Cloudflare AI Gateway · Cloudflare Workers AI · Ant Ling · Radius · OpenCode Zen

## Controls

| Action | What it does |
|---|---|
| Chevron | Collapses the card into a pill; the pill expands it again |
| Refresh | Probes the provider immediately |
| `Escape` | Collapses the card while it has keyboard focus |

## Credentials and privacy

Keys never leave the Host process — they are resolved through the Harness credential seam or the provider's environment variable (`OPENCODE_GO_API_KEY`, `MINIMAX_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, `MOONSHOT_API_KEY`, and so on).

The only outside request the browser may make is the footer model logo, fetched from the pinned LobeHub icon CDN and cached locally; if it is blocked, the plugin falls back to the logos it ships with.

## License

MIT © Syzygy
