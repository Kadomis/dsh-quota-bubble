# Quota Bubble (`dsh-quota-bubble`)

> **Live allowance, balance, and usage monitoring with turn runway estimation for the DeepSeek Harness.**

<p align="center">
  <img src="./preview.png" alt="Quota Bubble in DeepSeek Harness - MiniMax and OpenCode Go" width="860" style="border-radius: 18px; box-shadow: 0 20px 50px rgba(0,0,0,0.5);" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-quota-bubble"><img src="https://img.shields.io/npm/v/dsh-quota-bubble?color=%238a5bff&label=npm%20package" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/DeepSeek%20Harness-%3E%3D0.2.1--rc.5-blueviolet" alt="Harness Compatibility" />
  <img src="https://img.shields.io/badge/DTCG%20Tokens-90%20Verified-success" alt="DTCG Token Governance" />
  <img src="https://img.shields.io/badge/Resource%20Footprint-Ultra--Low%200%20Leak-brightgreen" alt="Ultra-Low Resource Footprint" />
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License" /></a>
</p>

---

## Overview

When running LLMs in DeepSeek Harness, quota consumption is spread across separate billing dashboards and opaque rate-limit windows. **Quota Bubble** keeps your real allowance, remaining balance, and runway visible in the corner of your workspace—read directly from each provider's authoritative API, never guessed.

---

## Interface Showcase

<table align="center" width="100%">
  <tr>
    <td align="center" width="50%">
      <b>Dark Mode — MiniMax</b><br/><br/>
      <img src="./docs/preview-dark.png" alt="MiniMax Quota in Dark Mode" width="380" style="border-radius: 20px; box-shadow: 0 16px 40px rgba(0,0,0,0.6);" />
    </td>
    <td align="center" width="50%">
      <b>Light Mode — OpenCode Go</b><br/><br/>
      <img src="./docs/preview-light.png" alt="OpenCode Go Quota in Light Mode" width="380" style="border-radius: 20px; box-shadow: 0 16px 40px rgba(60,40,120,0.15);" />
    </td>
  </tr>
</table>

---

## Features

- **Direct Provider Telemetry:** Probes the running provider's usage and balance endpoints directly. If a provider does not expose a quota endpoint, the bubble indicates `NO API` instead of inventing numbers.
- **Session Turn Runway Estimation:** Tracks quota burn across conversation turns and estimates how many turns remain before exhaustion (`~X turns left`), with warning highlights when quota is critically low.
- **Live Countdown Clocks:** Rolling quota windows (5-hour, weekly, monthly) feature live second-accurate reset clocks that tick down in real time without polling the network.
- **4-Corner Draggable Docking:** Drag the bubble anywhere on screen with automatic magnetic corner snapping, or click the header corner icon to cycle between all four screen quadrants.
- **Compact Collapsed Pill:** Collapse the card into an unobtrusive pill showing every active quota window (`5h 100% · Wk 52%`).
- **Antigravity Multi-Account Switching:** When using Antigravity via `dsh-agy-link`, the bubble tracks all pooled Google accounts, skips exhausted or cooling accounts, and lets you rotate accounts with one click.
- **Native Theme Adaptation:** Automatically conforms to DeepSeek Harness light and dark themes with zero visual flicker.
- **Ultra-Low Resource Footprint:** 
  - Pauses all timers and network polling whenever the window or tab is hidden (`document.visibilityState === 'hidden'`).
  - Debounces LLM streaming responses to eliminate unnecessary re-fetches during active chat generation.
  - Strictly bounds in-memory caches (max 30 items) to prevent memory accumulation.
  - Uses CSS GPU layers (`contain: paint`, `will-change: transform, opacity`) to prevent layout reflows.

---

## Provider Coverage

The bubble automatically follows the running model and provider in DeepSeek Harness.

| Provider | Telemetry Tracked | Quota Windows |
|---|---|---|
| **MiniMax** | Allowance percentage (M Plan) or account balance (PAYG) | 5-Hour Rolling & Weekly Windows |
| **OpenCode Go** | Allowance percentage and plan capacity | 5-Hour Rolling, Weekly, Monthly |
| **DeepSeek** | Real-time account balance & granted funds | Account Balance (USD / CNY) |
| **OpenRouter** | Key usage, credit limits, and remaining credits | Key Usage & Credit Limit |
| **Moonshot AI** | Account balance and remaining credits | Account Balance |
| **Antigravity** | Account pool allowance (via `dsh-agy-link`) | 5-Hour, Weekly, and Argon Pool |
| **Groq / Mistral / Together** | Model inventory and connection availability | Endpoint Health Ping |
| **OpenAI / Cerebras** | Connection readiness and model availability | Endpoint Health Ping |

---

## Controls & Shortcuts

| Action | Description |
|---|---|
| **`Alt+Shift+B`** | Global keyboard shortcut to toggle the bubble (customizable in Plugin settings). |
| **Chevron Button (`∧`)** | Collapses the card into a pill; clicking the pill expands it. |
| **Quadrant Dock Button (`⊞`)** | Cycles docking corner between bottom-right, bottom-left, top-left, and top-right. |
| **Drag & Drop** | Drag the header or collapsed pill to reposition anywhere on screen. |
| **Refresh Button (`↺`)** | Probes the provider endpoint immediately. |
| **Account Switcher** | *(Antigravity only)* Cycles to the next eligible account in the pool. |
| **`Escape`** | Collapses the card when it holds focus. |

---

## Installation

### Via DeepSeek Harness Plugin Manager

```bash
plugin_manager install_bundle target="dsh-quota-bubble@0.1.1"
```

### Via npm

```bash
npm install dsh-quota-bubble
```

### Setup

Zero configuration is required. Once installed, Quota Bubble automatically reads your provider credentials from the Harness credential store or standard environment variables (`OPENCODE_GO_API_KEY`, `MINIMAX_API_KEY`, `DEEPSEEK_API_KEY`, etc.).

---

## Privacy & Security

- **Host-Isolated Credentials:** Provider API keys never leave the Host process; network probes execute on the backend seam and return sanitized metrics to the client.
- **Loopback Antigravity Communication:** Antigravity metrics are read over local loopback (`127.0.0.1`) without transmitting Google credentials, tokens, or cookies.
- **Zero External Telemetry:** The plugin collects no user tracking, analytics, or external telemetry.

---

## Verification

The plugin includes automated test suites covering design tokens, Antigravity pool routing, and session switching:

```bash
npm run check
```

---

## License

MIT © Syzygy
