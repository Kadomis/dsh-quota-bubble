# Changelog

## [Unreleased]

### Fixed
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
