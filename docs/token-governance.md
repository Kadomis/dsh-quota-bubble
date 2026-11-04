# Token governance

Rules for what becomes a token, how new tokens are reviewed, and how changes
ship. The implementation is in `client.js`; the design-tool export is
`tokens.json`.

## What is a token versus a hardcoded value

A value must become a token when at least one of these is true:

1. it appears in two or more places, or
2. it carries meaning (text colour, surface, state, spacing rhythm), or
3. it must change by density, state or context, or
4. a consumer of the design system might reasonably want to change it.

A value stays hardcoded only when it is a one-off inside the decoration layer:
the gold ribbon SVG gradient stops, the official provider logo artwork, and the
logo plates' white background (brand artwork, not themeable UI colour).
Hardcoded values are reviewed as exceptions during code review and listed in
the README.

## Tiers and naming

`tier.category.entity.role.variant`

- **Primitive**: `primitive.color.neutral.900`, `primitive.space.3`,
  `primitive.radius.card`, `primitive.size.bar-height`. Raw values only; no
  component may read them directly.
- **Semantic**: `semantic.color.text.primary`, `semantic.color.state.error`,
  `semantic.space.component.card-padding`, `semantic.type.value`. Purpose
  names, no raw values.
- **Component**: `component.quotaBubble.meter.bar-height`,
  `component.quotaBubble.card.radius`. Component-scoped decisions that point at
  semantic/primitive tokens by alias.

Names describe purpose, never appearance: `text.primary`, not `text.dark`. The
DTCG export uses the same path names as the README tables, so a design variable
and a code token share one name.

## Review process for a new token

1. Propose it in the change description with the name, tier and the reason the
   existing tokens cannot express the decision.
2. Show every usage: component, state and theme where it appears.
3. Check the name against the convention above; a token named after a colour
   value is rejected.
4. Run the checks: `node scripts/check-tokens.mjs`, axe, measured contrast in
   both themes, and the spacing/typography audits.
5. Add it to `tokens.json`, the README token table (with intended use, example
   contexts and what it must not be used for) and the changelog.

A new token that duplicates an existing semantic decision is rejected; the
existing token should be used instead.

## Versioning and changelog

- Version numbers follow semver for the plugin and the token set.
- `tokens.json` carries the matching `version`.
- Patch: value correction that does not change intent (for example a contrast
  fix). Minor: new tokens, new density or theme values. Major (0.x: minor):
  renaming or removing a token, or changing its meaning.
- Every token change is called out under the version in `CHANGELOG.md` with the
  affected surfaces, so consumers can judge the visual impact.

## Design-tool sync

- Source of truth is the code; `tokens.json` is the generated-style DTCG
  artifact committed with it.
- `node scripts/check-tokens.mjs` fails when a colour in `tokens.json` is
  missing from the implementation or when a component alias does not resolve.
- Import `tokens.json` into the design tool (Tokens Studio / Figma variables
  DTCG import). Keep variable names identical to the JSON paths — the checker
  and the README tables assume a 1:1 mapping.
- After changing tokens in code, update `tokens.json` and run the checker before
  committing.
