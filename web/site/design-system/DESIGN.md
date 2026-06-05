# Lyra Official Site — Style Reference
> A minimalist, high-end "Cyber-Premium" design tailored for next-generation Agent-native developers. Deep dark canvas, sharp contrasts, and glowing tech accents.

**Theme:** dark

Lyra's design system feels like a professional IDE blended with a futuristic command center. The interface relies on a deep void-like background (`#09090b`) layered with subtle matte surfaces (`#18181b`). Color is used extremely sparingly—only for glowing accents (Lyra Cyan/Amethyst) to denote AI activity or primary interactions. Typography is the anchor: an architectural sans-serif (Inter) pairs with a precise monospace (JetBrains Mono) to create a distinctly technical, yet highly polished editorial look.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Deep Void | `#09090b` | `--color-deep-void` | Base page background. Creates an infinite depth feel. |
| Matte Surface | `#18181b` | `--color-matte-surface` | Card surfaces, dropdowns, elevated containers. |
| Border Line | `#27272a` | `--color-border-line` | Hairline borders to define surfaces instead of heavy drop shadows. |
| Text Primary | `#fafafa` | `--color-text-primary` | Main headings and high-emphasis body text. |
| Text Muted | `#a1a1aa` | `--color-text-muted` | Secondary text, captions, inactive links. |
| Lyra Cyan | `#06b6d4` | `--color-lyra-cyan` | Primary accent for AI actions, active states, and hover effects. |
| AI Amethyst | `#a855f7` | `--color-ai-amethyst` | Secondary accent used in subtle gradients to represent AI/Magic. |

## Tokens — Typography

### Primary Sans: Inter
- **Role:** Interface, body text, nav links, and buttons.
- **Weights:** 400 (Body), 500 (Buttons/Links), 600 (Headings)
- **Token:** `--font-primary-sans`

### Monospace: JetBrains Mono
- **Role:** Terminal outputs, code snippets, decorative technical labels.
- **Weights:** 400
- **Token:** `--font-mono`

## Tokens — Spacing & Layout

**Base unit:** 8px

### Border Radius
- **Buttons:** 6px (Slightly sharper than typical consumer apps to feel more like a pro tool)
- **Cards/Containers:** 12px

### Layout
- **Page max-width:** 1280px
- **Section gap:** 120px (Generous whitespace to create an Awwwards-style breathing room)

## Imagery & Motion (GSAP)
- **No pure drop shadows:** Use hairline borders (`#27272a`) to separate elements.
- **Animations:** Elements should fade up and stagger in on scroll using GSAP ScrollTrigger. Motion should be smooth, hardware-accelerated (`transform: translateY`), and feel deliberate.
- **Aesthetics:** Minimalist. Content over chrome.

## Components

### Primary Glow Button
Charcoal background with a subtle 1px border. On hover, the border glows with a `--color-lyra-cyan` transition.

### Feature Card
`Matte Surface` background, 1px `Border Line`. 12px radius. Internal padding 32px. No shadow.
