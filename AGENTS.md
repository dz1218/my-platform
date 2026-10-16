# Project conventions

- The frontend uses **Tailwind CSS v4 throughout the project**. This is an explicit user preference.
- Read `docs/design/frontend.md` before changing the visual system.
- Keep design tokens in `apps/web/src/app/theme.css`. Use semantic Tailwind utilities such as `bg-canvas`, `bg-panel`, `text-ink`, `text-muted`, and `bg-action`.
- Desktop uses the neutral dark `theme-graphite` palette (black, gray, and white; no warm white or brown accents). Preserve existing mobile styling while keeping it in the same token system.
- Prefer Tailwind utilities in JSX. Reusable component styles may use `@apply`; feature stylesheets must `@reference` the global Tailwind entry. Keep custom CSS for behavior such as complex media layouts, masks, animations, and browser autofill.
- Reuse existing shared components and styles. Keep colors out of individual components; use the shared scene tokens for dark surfaces.
- Preserve existing authentication and identity flows when making visual changes.

- Never use underlines for hover states anywhere in the UI. Use semantic text/background/border color changes and preserve visible keyboard focus instead.
