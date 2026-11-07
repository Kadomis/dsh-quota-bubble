# Contributing

Thanks for helping with `dsh-quota-bubble`. Keep changes small and keep the card usable for everyone.

## Accessibility checklist (required for every pull request)

Target: **WCAG 2.2 AA**.

- [ ] Every interactive element is a native `<button>` (or has an equivalent role) with an accessible name.
- [ ] A visible focus indicator exists: 2 px `#4b3b8f` outline, at least 2 px offset; focus moves with any state change (collapse → pill, expand → collapse button).
- [ ] Keyboard paths work: `Tab` reaches every control, `Enter`/`Space` activate, `Escape` collapses from inside the card.
- [ ] Text contrast is at least **4.5:1** and focus/UI contrast at least **3:1**, measured on rendered pixels (gradients and glass surfaces cannot be trusted to token maths).
- [ ] ARIA is preserved: `region` label, `progressbar` name plus `aria-valuenow`/`aria-valuetext`, `aria-expanded`/`aria-controls` on collapse and expand, `aria-busy` on refresh, `role="status"` announcement on model change.
- [ ] Decorative visuals stay `aria-hidden`; only one labelled provider image per card.
- [ ] `prefers-reduced-motion: reduce` disables the burst/blow animation and the meter/pulse motion.
- [ ] No text below **10 px**; keep the type tokens in `TYPE`.
- [ ] No raw colours or spacing literals in components: use the semantic/component tokens, and add a new token through the process in [docs/token-governance.md](docs/token-governance.md).
- [ ] Run `node scripts/check-tokens.mjs` and keep `tokens.json` in sync; record token changes in `CHANGELOG.md`.
- [ ] Any new card variant must resolve `component.quotaBubble.base` tokens (surface, rim, shadow, radius, padding) so the base style stays single.
- [ ] State is never communicated by colour alone — the pill always carries a word (`LIVE`, `OFFLINE`, `NO API`), percentages carry the word "left", errors are written out.

## Verifying

- Run `npm run check` (`check-tokens.mjs`, `check-antigravity.mjs`, `check-session-switching.mjs`) to verify token parity, Antigravity pool failover rules, and session switching resolution.
- Run the card with the Harness, then run axe-core against the card element and the collapsed pill with the WCAG 2.2 AA tags (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice`). Zero violations expected.
- Re-measure contrast for any changed text colour by sampling the rendered screenshot; record the ratio in the table in the README.
- Walk the keyboard table in the README and confirm focus moves as described.
- Check the accessibility tree exposes the region, both buttons, three progress bars and the live status.

## Commits

Keep messages in the imperative mood. Do not commit generated screenshots or the local `.live` bundle.

## Card review

- One base card style only; new card variants reuse `component.quotaBubble.base`.
- Padding comes from the base-4 scale and density tokens.
- Verify the card at 320, 375, 768, 1728 and 2560 px widths: no page overflow, no clipped text, width `min(280px, 100vw − 32px)`.
- Keep the reading order: identity → allowances → model/last refresh (primary action last) → credit.
