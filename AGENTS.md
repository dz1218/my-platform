# Project conventions

- The frontend uses **Tailwind CSS v4 throughout the project**. This is an explicit user preference.
- Read `docs/design/frontend.md` before changing the visual system.
- Keep design tokens in `apps/web/src/app/theme.css`. Use semantic Tailwind utilities such as `bg-canvas`, `bg-panel`, `text-ink`, `text-muted`, and `bg-action`.
- Desktop uses the neutral dark `theme-graphite` palette (black, gray, and white; no warm white or brown accents). Preserve existing mobile styling while keeping it in the same token system.
- Prefer Tailwind utilities in JSX. Reusable component styles may use `@apply`; feature stylesheets must `@reference` the global Tailwind entry. Keep custom CSS for behavior such as complex media layouts, masks, animations, and browser autofill.
- Reuse existing shared components and styles. Keep colors out of individual components; use the shared scene tokens for dark surfaces.
- Preserve existing authentication and identity flows when making visual changes.

- Never use underlines for hover states anywhere in the UI. Use semantic text/background/border color changes and preserve visible keyboard focus instead.

# Frontend state management

- Prefer **Zustand** for client business state, form workflows, drafts, filters, selections and shared UI state. Shared business stores live under `packages/client-core/src`, grouped by business domain. Browser adapters and desktop interaction stores stay under `apps/web/src/stores`; mobile-only interaction stores live under `packages/mobile-web/src/stores`.
- Follow the LobeChat-inspired organization: typed initial state, actions, selectors and store composition; use slices for larger domains. Small stores may colocate these pieces. Change state through domain actions, and subscribe with selectors (`useShallow` for object/tuple results).
- Put validation, async workflows, concurrency guards, retries and cache updates in domain actions, not only setters. Use `subscribeWithSelector` for state-driven side effects; bind subscriptions in owner effects and clean up listeners, timers and animation frames. UI rendering still uses selector hooks.
- Create stores per mounted scope with `useStoreInstance`; never define mutable account/form/room stores as module singletons in Next.js. The root provider is keyed by account ID; conversation and room owners are keyed by their IDs. Context only injects store instances or lifecycle commands.
- React Query remains the source of truth for server data, and URL state stays in the router. Do not duplicate their caches in Zustand. React server actions retain `useActionState` / `useFormStatus`.
- Keep browser/SDK resources (DOM nodes, WebSocket/LiveKit objects, tracks, timers, abort controllers) in refs/effects with cleanup. Pure control presentation, measurements and animation state may use local React state; document new exceptions in `docs/design/frontend.md`.
- Persist only explicitly chosen harmless preferences. Never persist passwords, verification codes/tickets, room tokens or account drafts, and do not expose sensitive stores through devtools or window globals.

# Client package boundaries

- `apps/web` owns Next.js routes, server rendering/actions, authentication, React Query providers and browser/LiveKit resource lifecycles. Desktop and mobile views share each mounted business owner.
- `packages/mobile-web` owns the independent phone-web presentations and interactions. `packages/web-ui` holds shared browser presentation primitives. Neither package imports application aliases (`@/`), Next.js or files from `apps/web`; navigation, optimized images and server content are injected by the app.
- `packages/client-core` exports Zustand vanilla factories, domain actions/selectors and injected service contracts. Keep React helpers in its separate `/react` entry. Core must not depend on DOM globals, browser storage, WebSocket, LiveKit, Next.js or React Query's React bindings; use injected services and query-core types.
- `packages/shared` contains platform-neutral business types. Client packages must never import the database package or server-only code.
- Share store definitions, not account or room singletons. Future Taro clients create their own instances and platform adapters; the phone-web DOM UI is not a mini-program UI.
- Use package subpath exports rather than cross-package source paths. Run `pnpm check:client-boundaries` after changing package dependencies or imports. Tailwind v4 source scanning includes both UI packages; `apps/web/src/app/theme.css` remains the token source.
