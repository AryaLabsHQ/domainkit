# Launch film and infographics

`@domainkit/video` builds HTML compositions with HyperFrames 0.8.150. The launch lives in
`launches/introducing-domainkit`. Its tracked script describes the story and music prompt;
its generated HTML, assets, and compositions are ignored.

## Scene construction

- `src/scenes/markup.tsx` exports the scene catalog. React markup renders once with
  `renderToStaticMarkup`, using the Field Manual tokens from `apps/docs/theme.css` and Geist fonts.
  The docs registry is copy-distributed source and may be imported by relative path for real UI.
- `src/scenes/motion.ts` exports scene motions. Each receives a paused GSAP timeline and its root.
  Motion offsets start at the scene's own zero. Scene markup and motion stay together under
  `src/scenes/`; `data-a` attributes name animated elements.
- `src/cuts.ts` places shots in the 60-second hero and names the four infographic scenes.
  `scripts/build.ts` compiles Tailwind, bundles motion, copies fonts and the brand mark, and writes
  one sub-composition per shot. Each still uses the same scene system and render compositor.
- `scripts/media.ts` resolves generated music through Git's common directory into the primary
  checkout's ignored `apps/video/media/`. `apps/video/.env` links to the primary checkout's root
  `.env`. Keys stay out of source, logs, and renders.
- `scripts/music.ts` levels the bed to a separate file before applying gain dips and fades.
  `scripts/render.ts` masters the finished mix near -14 LUFS without re-encoding the picture.
  Missing music produces a silent film. Generation is an explicit command, never part of build.

## Rules

Every frame and on-screen string follows `.agents/marketing/truth.md`, then positioning and voice.
Plans show matching records as Noop, missing as Create, and incompatible as Conflict. A conflict
blocks apply. Approval binds to the exact reviewed digest; a receipt records completed work.
Public DNS verification uses public DNS evidence. Cleanup requires a separate approval bound to a
receipt. Credentials, persistence, identity, tenancy, callback routes, consent, and audit stay in
the host application.

All motion lives on GSAP timelines. CSS transitions, CSS animations, timers, wall clocks, and
randomness are forbidden. The build strips transition and animation declarations from compiled
CSS. The film contains kinetic type and instrumental music; no narration or captions.

Paint both the composition and page background with the theme background. Judge extracted MP4
frames, because HyperFrames snapshots composite differently. Use HyperFrames' managed headless
Chrome for checks and renders.

## Commands

Run from `apps/video`:

```sh
bun run build
bun run scene hook
bun run preview
bun run typecheck
bun run test
bun run hyperframes lint launches/introducing-domainkit
bun run hyperframes check launches/introducing-domainkit
bun run render
bun run stills
bun run frames
bun run copy:audit
```

`bun run render` writes `renders/hero.mp4` and the eight PNGs in `renders/stills/`.
`bun run music --generate` explicitly generates the bed with ElevenLabs Music on FAL, using the prompt in
`SCRIPT.md`. Paid generation is music only and stays below the approved $5 total budget.

Inspect each beat from the finished movie:

```sh
ffmpeg -ss 12 -i renders/hero.mp4 -frames:v 1 /tmp/domainkit-reveal.png
```

Source and final deliverables are tracked; `.build`, generated project assets, `.env`, and raw
music are ignored. Before committing, run root `bun run check` and `git diff --check`.
