# Changelog

## [0.1.1] - 2026-11-07

### Added
- **Native Dark Mode & Theme Adaptation**: Added obsidian & dark-violet theme palette (`COLORS.dark`) with automatic detection via `data-ds-dark-theme`, `data-theme="dark"`, and system `prefers-color-scheme: dark` media queries, accompanied by real-time DOM mutation observers.
- **Draggable Positioning & Custom Dock Corners**: Support 4-corner docking (`bottom-right`, `bottom-left`, `top-right`, `top-left`) with persistence in `localStorage`, pointer drag gesture support on collapsed pill and card header, and an interactive dock-cycle button in the card header.
- **Low-Quota Threshold Warnings & Reset Notifications**: Integrated pulsing warning badges (`.ogq-warn-badge`) on collapsed pill and meters whenever an allowance drops to ≤15%, with reset countdown highlights.
- **Per-Session Activity & Token Tracker**: Display turn counts and token statistics in the card body for the active session, resolving metrics from session projections and event stores.
- **Expanded Provider Endpoint Probing**: Host probing (`host2.js`) expanded to support Groq, Together AI, Mistral, OpenAI, and Cerebras via model inventory health pings and credential verification.
- **Antigravity Fast-Account Switcher**: Real-time account pool status chip in the card showing active account email/ID, ready account count, and a one-click "Switch" button calling the `dsh-agy-link` pool rotation endpoint.
- **Ultra-Low Resource Footprint & Zero Memory Leaks**: Implemented document visibility lifecycle management (pausing countdown timers and background network polls while the window or tab is hidden), chat streaming fetch debouncing (`isSameModel`), deep equality checks (`isUsageEqual`) to eliminate redundant React tree re-renders, strictly bounded caches (max 30 items for session baselines and remote logos, max 20 for host models), explicit pointer capture release on drag, and CSS GPU layer isolation (`contain: paint`, `will-change: transform, opacity`).
- **Burn Rate & Runway Estimation ("Turns Remaining")**: Added intelligent quota runway estimation (`computeSessionRunway`) that tracks session quota delta against turns taken. Displays a dynamic badge (`~X turns left`) and tooltip (`Burn rate: ~Y%/turn`) in the session activity chip, with automatic warning highlight when runway drops to critical levels (≤5 turns or ≤15% quota remaining).
- **Live Second-Accurate Reset & Cooldown Timers**: Upgraded quota reset countdowns (`resetText`) to tick down live in real time (`in 14m 23s`, `in 45s`) when within one hour, self-scheduling local timer re-renders inside meters without requiring server polling. Also upgraded footer timestamp (`updatedText`) to update dynamically (`Just now` -> `15s ago`).
- **Concentric Caustic Arcs (Option A Recreation)**: Recreated the golden corner lines using precision-engineered concentric hairlines (`0.75px` to `1.2px`) with an ambient caustic underglow layer that echo the card's 38px rounded corner geometry. Anchored in the top-right quadrant with multi-stop linear alpha fade (`stop-opacity: 0 -> 0.38/0.50 -> 0.95/1.0 -> 0`), framing the header controls without intersecting provider title text and eliminating peripheral visual distractions.
- **Interactive Version Update Status**: Transformed the static version number into an interactive status badge that checks npm/GitHub releases. Displays a subtle green `up to date` badge when current, or an eye-catching `Update vX.X.X ↗` button linking to release notes when a newer version arrives, complete with live re-check actions in the card and Settings page.
- **Plugin Settings Console (`plugins.bundle.config`)**: Injected configuration card in DSH Plugins page allowing users to configure the global shortcut, pick presets (`Alt+Shift+B`, `Alt+Shift+Q`, `Alt+Shift+K`, `Ctrl+Shift+B`), record custom combinations, and choose default screen dock corners.
- **Safe Global Keyboard Shortcut**: Set default shortcut to `Alt+Shift+B` (Option+Shift+B on Mac, Alt+Shift+B on Windows/Linux) via `shortcuts.register` and custom event bus, preventing conflicts with macOS `Cmd+Q` quit accelerator.
- **Corner Cycle Icon Geometry Fix**: Scaled quadrant icon paths to 2.5-13.5px within a 16x16 viewport with 1.4px stroke width, eliminating edge cut-off artifacts.
- **Card Corner & Squircle Fix**: Removed experimental `corner-shape:superellipse(2)` and outer spread shadow that produced visible protruding artifacts in Chromium/Electron; styled with clean standard border radius and subtle border.
- **Dark Mode Ribbon Text Readability**: Added protective dark text shadow halo (`0 1px 4px rgba(15,10,30,0.95), 0 0 8px rgba(20,12,40,0.95)`), z-index layer 3, rich metallic gold tones, and 45% screen blend on the golden ribbon in dark mode, preserving luxury gold lines while ensuring maximum readability.
- Antigravity quota is read live from the `dsh-agy-link` plugin's pool instead
  of leaving the provider on `NO API`. The card shows the 5-hour and weekly
  windows for the running model's family — one weekly figure for Argon, which
  bills against a single pool — and the numbers only appear while that plugin
  is installed, its Antigravity provider is enabled, and it publishes a counter
  for the running model's family.
- `scripts/check-antigravity.mjs`, a check that runs the Antigravity branch
  against a stubbed pool and holds it to the family rules, the account the
  sibling plugin would pick, and the colour bands it shows.
- `scripts/check-session-switching.mjs`, automated tests verifying session
  switching resolution across host and client, query parameter overrides, and
  independent provider cache keys.

### Fixed
- Safe Cordis service resolution: `client.js` now accesses optional services (`uiSession`, `sessions`, `modelDirectories`) via `ctx.reflect.get(name, false)` fallback instead of direct property access on `ctx`, preventing Cordis's `cannot get property without inject` proxy exception and ensuring reliable component loading and live subscriptions.
- Fixed session switching detection: the client now captures Cordis context,
  tracks the active session via `uiSession` and `sessions.list` subscriptions,
  resolves session-specific models from `modelDirectories` and projection faces,
  passes target session/provider/model parameters to the host route, and uses
  `AbortController` to cleanly cancel superseded in-flight requests.
- Fixed host route model probe: the host now accepts `?session=`, `?provider=`,
  `?model=`, and `?reasoningEffort=` query parameters, resolves session models
  through `sessionController.resolveAgent`, and maintains independent cache entries
  per provider/model/reasoningEffort key to prevent cross-session clobbering.
- The Antigravity card no longer shows a spent account's counters as if they
  were a live allowance. When every account is cooling down, signed out, or out
  of quota — the state the sibling plugin refuses a request in — the card says
  that no account can serve the model instead.
- The status pill now reads **no data** when the endpoint was read and holds
  nothing, and keeps **no api** for a provider that has no usage endpoint. The
  two states used to share the word "no api", which told someone reading the
  card that the provider exposes no endpoint when it had just answered.
- A usage endpoint that answers with something that is not JSON now reports
  `unexpected-response` instead of `network`. This applies to every provider:
  a malformed body is an unexpected answer, not an unreachable host.
- The card now reads "Usage endpoint returned an unexpected answer." instead of
  repeating the failure code back to the reader.
- The collapsed pill now shows every allowance window instead of just the
  monthly figure: `5h 98% · Wk 91% · M 96%`, each tinted by its state, with the
  full breakdown exposed in the accessible name. Providers without windows keep
  the single balance headline.

### Changed
- Card width raised from 300 px to **310 px** (`semantic.space.layout-card-width`);
  the responsive clamp is `min(310px, 100vw − 32px)`, so a 320 px viewport still
  renders 288 px.

### Removed
- The residual 2 px gold ring (a spread shadow, not a border), the 1 px white
  top highlight and the backdrop-filter edge fringe; the card surface is now
  opaque so its transition to the page background is a clean squircle edge. The card surface now ends at the squircle
  edge (38 px, `superellipse(2)`); the rim wrapper, its gradient and the
  `rim`/`rimGradient` tokens were removed.

### Fixed
- The gold rim now follows the squircle: the rim is the wrapper's own
  `corner-shape: superellipse(2)` background (radius 40 px) with the card surface
  inset by the 2 px band, instead of a gradient border painted on a circular
  border-box corner. Band thickness is uniform around the continuous corners.

### Changed
- Apple-style squircle corners: `corner-shape: superellipse(2)` with a 38 px
  radius, giving continuous-curvature corners instead of circular arcs.
  Browsers without `corner-shape` keep the rounded-corner fallback.
- Removed the glow ring behind the card; the surface now relies on its gold rim
  and layered elevation shadow only.

## [0.1.0] - 2026-11-04

Initial public release.

- Floating quota bubble for the DeepSeek Harness, pinned to the bottom-right of the panel.
- Follows the running model/provider automatically.
- Live probes: OpenCode Go allowance, MiniMax M Plan allowance or balance, DeepSeek balance, OpenRouter credits, Moonshot balance.
- Provider-reported values only; providers without a usage API show `NO API` instead of an estimate.
- Collapsible pill, refresh action, provider/model logos, light-only glass card.
