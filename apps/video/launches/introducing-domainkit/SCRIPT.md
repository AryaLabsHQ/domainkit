# Introducing DomainKit

A 60-second, 16:9 kinetic typography film. On-screen copy carries the story with the sound off.
One instrumental bed carries the motion. No narration, captions, speech, or voice generation.

| Time   | Beat     | On-screen copy and motion                                                                                                                                                                                                                                                                                                             |
| ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–9s   | Hook     | Generic DNS instructions page. Cursor selects and copies a CNAME target, switches to a DNS-provider tab, pastes and saves. **Copy. Paste. Wait.** Then **Custom domain setup stalls here.**                                                                                                                                           |
| 9–16s  | Reveal   | The approved DomainKit mark and wordmark. **Custom domains for your SaaS, without the DNS instructions.** Footer: **Open-source TypeScript library** and **domain-kit.dev**.                                                                                                                                                          |
| 16–23s | Connect  | **Connect the customer’s own Cloudflare or Vercel account.** Dialog: **Connect a DNS provider**, **Authorize DNS changes for example.com.**, **Continue with Cloudflare**, **Continue with Vercel**. The chosen account connects.                                                                                                     |
| 23–32s | Plan     | **See every record before anything changes.** Matching TXT is **Noop**, missing CNAME is **Create**, incompatible CNAME is **Conflict**. **Conflicts are surfaced, never resolved silently.** Apply stays blocked. The customer fixes the conflict at the provider and checks again: **Fixed at the provider. New plan, new digest.** |
| 32–41s | Approve  | The compatible plan has one Noop and two Creates. **Approve the exact plan.** A click changes the plan digest to approved digest. **Apply only what was approved.** The two missing records are added. **Keep a receipt.** The receipt carries the approved digest and the attempt’s counts.                                          |
| 41–47s | Verify   | **Checking public DNS…** Provider and public DNS have distinct columns. **Verified in public DNS.** appears only after the public-DNS cells are found. **3 of 3 records found in public DNS.**                                                                                                                                        |
| 47–55s | Boundary | **DomainKit runs in your app.** **Your app keeps credentials, persistence, identity, tenancy, callback routes, consent, and audit.** DomainKit sits inside the host frame; the customer’s own Cloudflare or Vercel account sits outside it.                                                                                           |
| 55–60s | CTA      | DomainKit mark and wordmark. **bun add domainkit** · **domain-kit.dev**. **Open source. MIT license.** Hold while the bed resolves.                                                                                                                                                                                                   |

These are illustrative product states,
not recorded customer results or a production timing claim. Conflicts never animate directly into
an apply: a compatible plan receives its own review and digest-bound approval. Matching records
are Noop, missing records Create, incompatible records Conflict. Provider writes are not atomic.
Cleanup, if shown in any derivative, needs separate approval bound to an apply receipt.

The host owns credentials, persistence, identity, tenancy, callback routes, consent, and audit
policy. The film makes no hosted-control-plane, universal-provider, TLS, or quantified speed claim.
Claims follow `.agents/marketing/truth.md`, `positioning.md`, and `voice.md`.

## Infographic stills

Each still uses the film’s React markup and paused GSAP scene system. Export at 1920×1080 and
1200×630, preserving the full canvas on Field Manual paper.

The film and stills live in `apps/docs/public/launch/`: `hero.mp4`, `hero-poster.jpg`, and
`{lifecycle,semantics,comparison,host-boundary}-{1920x1080,1200x630}.png`. The poster is the
settled reveal at 14 seconds, extracted from the film. The `social` scene exports `home-og.png`
at 1200×630 and `github-social-preview.png` at 1280×640. Both carry the approved mark and
wordmark, **Custom domains for your SaaS, without the DNS instructions.**, and **domain-kit.dev**.

| Still            | On-screen story                                                                                                                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle        | Connect → Discover zone → Plan → Approve digest → Apply → Receipt → Observe DNS → Clean up. Cleanup reads **Separately approved. Bound to the receipt.**                                                                                                                          |
| Plan semantics   | **Three outcomes for every record.** Matching is Noop and writes nothing; missing is Create after digest approval; incompatible is Conflict, surfaced rather than silently resolved.                                                                                              |
| Before and after | **Copy and paste, or approve once.** DNS instructions require provider switching and field-by-field copying; DomainKit’s flow connects the account, reviews the records, approves the plan, and verifies public DNS.                                                              |
| Host boundary    | **What your app keeps, and what DomainKit does.** Credentials, persistence, identity, tenancy, callback routes, consent, audit remain with the app. DomainKit plans exact changes, applies the approved digest, returns a receipt, and observes DNS. **Interfaces, not custody.** |

## Music production

Generate explicitly from `apps/video` with `bun run music --generate`. Bun loads the gitignored
`.env` symlink to the primary DomainKit checkout's user-supplied environment. Generation is never a
build step. An existing source is retained; an existing generation receipt blocks a second charge,
including after interruption. Do not remove receipts or media to retry automatically.

Endpoint: `elevenlabs/music/v2.5`. Request: `music_length_ms: 60000`,
`force_instrumental: true`, `output_format: mp3_48000_192`.
[Official schema](https://fal.ai/models/elevenlabs/music/v2.5/api) and
[pricing](https://fal.ai/models/elevenlabs/music/v2.5), checked 2026-10-22: $0.60 per output minute,
rounded up to the next minute. One request estimates $0.60; conservative boundary allowance $1.20,
below the authorized $5 total. Actual invoice cost is not returned by the generation response.

Exact prompt:

> Exactly 60 seconds of instrumental electronic music for DomainKit, an open-source developer tool launch film with kinetic typography. Precise, confident, warm, understated. 112 BPM, tight dry percussion, rounded analog bass, short plucked synth motifs, airy restrained chords, subtle tactile clicks. Start with an immediate clean pulse for 0-9 seconds; open into a memorable bright motif at 9 seconds; build an orderly connected groove from 16-32 seconds; a small deliberate breath at 32 seconds then a confident lift through 41 seconds; spacious clarity at 41-47 seconds; grounded restrained groove at 47-55 seconds; resolve with a clean warm final chord at 58 seconds and let it decay to silence by 60 seconds. Keep space for typography and visual transitions at 9, 16, 23, 32, 41, 47 and 55 seconds. No vocals, no speech, no narration, no chanting, no vocal chops, no cinematic trailer impacts, no huge drops, no recognizable melodies. Original instrumental only.

The shared source is `apps/video/media/introducing-domainkit/music/launch-bed.mp3` in the primary
checkout, resolved through Git's common directory. Its sibling `launch-bed.generation.json` retains
the exact input, request ID, estimated cost, unknown actual cost, measured duration, and download URL.

Generated request: `01a16258-2293-7501-8ef0-968c3d9afdc3`. Measured source duration: 60.024 seconds.
One request submitted; estimated cost $0.60, with $1.20 allowed for whole-minute billing at the
boundary. Actual billed cost remains unknown. Scoring trims the encoded source padding to 60 seconds.

`scoreMusic(duration, assets)` returns `assets/music.mp3`, or `undefined` when the source is missing.
The build omits audio in that case. Scoring first renders a separate 48 kHz stereo levelled WAV at
about -14 LUFS with a -1.5 dB true-peak target. A second pass adds smooth 2 dB dips at 9, 16, 23,
32, 41, 47, and 55 seconds, plus entrance and exit fades. There is no narration sidechain. The
levelled WAV is retained in build assets for inspection; source media is never deleted.
The MP3 pass leaves 0.3 dB of encoding headroom after the transition envelope.
