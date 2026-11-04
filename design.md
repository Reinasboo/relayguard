# DESIGN.md — Anti-Slop Visual Identity & Rules
> Goal: Output must feel crafted by a human designer who shipped product, never default LLM
output.
> Anti-slop is a filter, not a style guide. Direction stays yours. Sterile results mean direction was
missing.
## Overview / Brand Direction - Commit to one clear aesthetic in one sentence (e.g. “Warm off-white surface, near-black text,
single terracotta accent”). - Match audience and product job-to-be-done. Dark mode is a deliberate choice, never the
default. - One focal point and one accent per screen. ≤3 active hues total. - Aim for ~80% proven patterns + ~20% distinctive choice (one bold type move, one color
decision, one memorable micro-interaction, one product-specific detail). - If a competitor’s logo could swap in without redesign, the hero fails the swap test.
## Colors - Define a named palette with exact values and roles (primary text, secondary, single accent,
surface, elevated, border). - One accent color, used sparingly (CTAs, links, one highlight). Cap visible accent uses
(professionals commonly limit to ≤2–3 per viewport). - Surfaces have clear hierarchy: background → elevated card → border separator. - **Hard bans (textbook AI tells):** - Default Tailwind indigo/violet/purple accents: exactly #6366f1, #4f46e5, #4338ca, #3730a3,
#8b5cf6, #7c3aed, #a855f7. - Two-stop “trust” gradients on heroes or text (purple→blue, indigo→pink, blue→cyan, etc.). - Gradient text (background-clip: text). - Neon/outer glows, colored left-border accents on cards, rainbow or mesh background blobs. - Pure #000000 (prefer off-black / zinc-950 / charcoal). - Prefer solid fills. If a gradient is required, it must be monochromatic, subtle, and
purpose-stated.
## Typography - Intentional typefaces only. Name them and why. - Prefer distinctive pairings over defaults: grotesk for product UI (Geist, Söhne, IBM Plex Sans,
Satoshi, etc.), serif for editorial where justified, one display face for heroes if needed. - **Avoid as defaults:** Inter, Roboto, Arial, system-ui, Space Grotesk (over-used in “tech”
contexts), Fraunces / Instrument Serif when they become the new average. - Consistent type ramp (example professionals use: 14 / 16 / 20 / 28 / 40). Stick to it. - Body ≥16px, readable line length ~60–75 characters (or max ~65ch). - Weight contrast deliberate: two weights max in marketing sections (regular body, semibold
headings/labels).
- No gradient text, no all-caps eyebrow labels above every heading, no numbered 01/02/03
markers without real sequence.
## Layout & Spacing - Break the default “Hero → three identical feature cards → Pricing → FAQ → CTA” skeleton.
Introduce at least one unconventional section. - Feature sections must vary (bento, side-by-side with real screenshot, short list, etc.). Identical
card grids are a tell. - Whitespace is earned: pick a density target and hold it. Avoid dead space that only “looks
expensive.” - Consistent spacing scale (multiples of 4/8 px common). Cards separated by space /
background shift / subtle elevation — never flat gray 1px border + wide soft shadow together,
never colored left strip. - Mobile designed, not shrunk: stack order matters; primary CTA visible without excessive scroll. - Real content and real states required (empty, error, loading). No lorem / “Feature
one/two/three” / placeholder people.
## Components & Icons - Limit variants: one button style, one card style, one input style. - Full interactive states (hover, focus-visible, active, loading, disabled) — never hover-only. - Icons: 1.6–1.8 px monoline SVG with currentColor, consistent weight/size. Never raw emojis
(
🚀

✨

⚡

�
�

�
�

�
�
 etc.) as feature icons or in headings/buttons. - No glassmorphism / frosted panels as default, no dramatic floating shadows, no pill buttons
everywhere, no animated underlines or morphing focus by default. - Borders and shadows pick a lane (hairline border *or* soft defined shadow ≤8 px blur).
## Motion - One motion concept per page maximum. - Short durations (marketing micro-interactions 150–300 ms). Nothing over ~600 ms without
narrative purpose. - Respect prefers-reduced-motion. Disable non-essential animation. - No infinite loops, bouncing/elastic easing, hover-scale images, or scattered micro-animations
without purpose. - High-impact moments only (one well-orchestrated staggered reveal beats many random
effects).
## Copy & Content Honesty - Write like a human with a real product. Headline must state the actual job-to-be-done. - **Forbidden:** invented metrics (“10× faster”, “99.9% uptime”, “3× more productive”), fake
testimonials, fake names, vanity stats, generic CTAs (“Get Started”, “Unlock your potential”,
“Supercharge”). - No filler. If no real data, show no claim. Use labelled placeholders only when necessary. - Avoid symmetrical vague startup language (“leverage”, “streamline”, “experience”).
## Do’s and Don’ts (compiled from professional bans)
**Do** - Load this DESIGN.md (or explicit brand guidance) before any UI work. - Run pre-ship checks: squint test (hierarchy at 50% zoom), swap test, font naming test, accent
count, motion-off test, mobile CTA visibility, “remove all gradients and generic SaaS patterns”
re-prompt. - Prefer real product screenshots and real content over decorative geometry. - Keep one signature element the design is remembered for.

**Don’t** - Ship without direction (label as “draft without direction”). - Default to dark tech aesthetic, purple gradients, Inter, three-card grids, emoji icons, left-border
cards, or fabricated proof. - Use more than ~12 raw hex values outside tokens (token drift). - Add novelty for its own sake or produce a component demo instead of a product interface.

## Tokens (YAML example structure — replace with your values)
```yaml
name: YourProduct
colors:
  primary: "#1A1C1E"      # deep ink text
  secondary: "#6C7278"    # captions, borders
  accent: "#B8422E"       # single intentional accent
  surface: "#F7F5F2"      # warm off-white
  elevated: "#FFFFFF"
typography:
  display:
    fontFamily: "YourDisplay"
    fontSize: 3rem
  body:
    fontFamily: "YourBody"
    fontSize: 1rem
    lineHeight: 1.6
rounded:
  sm: 4px
  md: 8px
spacing:
  sm: 8px
  md: 16px
  lg: 24px
```

## RelayGuard implementation direction

A quiet charcoal payment workspace, with clear settlement records and lime reserved for the next action. Dark surfaces reduce visual competition in a transaction-heavy workspace; the reviewer uses the same identity. Manrope provides open, readable numerals and compact product labels.

Palette: canvas #181a19, surface #202321, raised #282c29, border #3b413c, text #f0f2ed, secondary #b1b9b1, accent #b7f566, warning #e2bc7d, danger #eea39a. Status colors describe actual states.

Type: 14px metadata, 16px body and inputs, 20px section headings, 28px mobile page titles, 40px desktop titles. Spacing: 4, 8, 12, 16, 24, 32, 48, 64px. Radii: 4 and 8px. No decorative orbit illustrations, gradients, glow, repeating uppercase eyebrows, or numbered cards outside real setup sequences.

Ownership: experience.css contains shared tokens and primitives; styles.css contains workspace components; review.css contains reviewer components. Neither page imports the other page stylesheet. Changes must be inspected at 320, 390, 768, 1024 and 1440px with populated, empty, error and pending states.
