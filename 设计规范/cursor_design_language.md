# Cursor

**Warm ivory software studio.**

Cursor's design language evokes a functional, precise studio environment, blending the tactile feel of physical tools with the clean, digital interface of modern software. A foundation of warm, off-white backgrounds (`#f7f7f4`) and subtle, multi-layered shadows create a sense of depth and hierarchy, mimicking stacked, floating interface elements. Typography is highly refined, utilizing custom mono and gothic fonts with precise letter-spacing and stylistic alternates that convey technical sophistication.

<https://cursor.com>

## Color Palette

### Accent

| Name | Hex | Usage |
|---|---:|---|
| Onyx Outline | `#f54e00` | Outlined action button borders and link text — a vibrant orange indicating interactive elements without a solid fill. |
| Chartreuse Alert | `#4ade80` | supporting accents, small interactive text snippets — a vivid green for positive or noteworthy cues, often within code examples. |
| Goldenrod Accent | `#c08532` | Accent for specific interactive states or icons, often found in button backgrounds for 'Build' actions. |
| Forest Green Action | `#34785c` | Specific button backgrounds/borders like 'View PR' — a moderate green for distinct, yet secondary actions. |

### Neutrals

| Name | Hex | Usage |
|---|---:|---|
| Deep Shadow | `#141414` | Deepest text variant — for maximum contrast on headlines or critical information. |
| Inkwell | `#262510` | Primary text, strong borders, navigation text — grounds the lighter surfaces with significant contrast. |
| Muted Stone | `#7a7974` | Secondary text, subtle borders, icon fills — a mid-tone gray for less prominent information or structural lines. |
| Highlight Beige | `#cdcdc9` | Subtle card backgrounds on nested elements, faint border color — a light neutral for separation with low visual weight. |
| Pebble Gray | `#e6e5e0` | Hover states on neutral buttons, subtle card backgrounds — visually lighter than Canvas Parchment, indicating elevation. |
| Canvas Parchment | `#f7f7f4` | Page backgrounds, card backgrounds, neutral button backgrounds — provides a soft, warm foundation. |

## Typography

### Type Scale

**Minor Third (1.2) from 15px base**

| Token | Size | Weight | Line Height | Preview |
|---|---:|---:|---:|---|
| display | 72px | 400 | 1.1 | The quick brown fox jumps |
| heading-lg | 36px | 400 | 1.2 | The quick brown fox jumps |
| heading | 26px | 400 | 1.25 | The quick brown fox jumps |
| heading-sm | 22px | 400 | 1.3 | The quick brown fox jumps |
| 16px | 16px | 400 | 1.5 | The quick brown fox jumps |
| body-lg | 14px | 400 | 1.5 | The quick brown fox jumps |
| 13px | 13px | 400 | 1.55 | The quick brown fox jumps |
| 12px | 12px | 400 | 1.67 | The quick brown fox jumps |
| 11px | 11px | 400 | 1.27 | The quick brown fox jumps |
| caption | 10px | 600 | 1.1 | The quick brown fox jumps |
| 6px | 6px | 500 | 1 | The quick brown fox jumps |

### Fonts

#### CursorGothic

| Property | Value |
|---|---|
| Category | Code |
| Weight | 400 |
| Sizes | 13–72px · 7 values |
| Line height | 1–1.5 · 7 values |
| Letter spacing | -0.45–0.18 · 6 values |
| Fallback | system-ui |

Primary UI text for headlines, navigation items, and larger body copy. The custom font with precise letter-spacing and stylistic alternates (`"ss09"`, `"ss08"`, `"tnum"`) creates a technically sophisticated, almost code-like feel.

#### berkeleyMono

| Property | Value |
|---|---|
| Category | Code |
| Weight | 400, 500 |
| Sizes | 12px, 13px |
| Line height | 1.21–1.67 · 5 values |
| Fallback | monospace |

Code snippets, input text, and small descriptive body copy. The monospaced nature reinforces the developer tool identity.

#### Lato

| Property | Value |
|---|---|
| Category | Secondary |
| Weight | 400, 600 |
| Sizes | 10px, 12px, 14px, 16px |
| Line height | 1.10, 1.27, 1.33, 1.50 |
| Letter spacing | 0.06 |
| Fallback | sans-serif |

Secondary and utility text across various components like buttons, links, and small informational sections. Its geometric sans-serif quality adds versatility.

#### EB Garamond

| Property | Value |
|---|---|
| Category | Typeface |
| Weight | 400, 500 |
| Sizes | 16px |
| Line height | 1, 1.5 |

EB Garamond — detected in extracted data but not described by AI.

#### -apple-system

| Property | Value |
|---|---|
| Category | Typeface |
| Weight | 400 |
| Sizes | 16px |
| Line height | 1.5 |

-apple-system — detected in extracted data but not described by AI.

## Spacing & Shape

### Spacing

| Purpose | Value |
|---|---:|
| Density | compact |
| Max width | 1300px |
| Section gap | 43px |
| Card padding | 12px |
| Element gap | 8px |

### Border Radius

| Element | Value |
|---|---:|
| cards | 4px |
| buttons | 4px |
| general | 4px |
| prominent | 8px |

## Elevation

### Elevated Content Card

## Guidelines

### Do

- Use CursorGothic for all headings and primary UI text, applying precise letter-spacing values (e.g., `-0.45px` at `72px`, `-0.08px` at `22px`).
- Elevate content with the multi-layered shadow token: `rgba(0, 0, 0, 0.14) 0px 28px 70px 0px, rgba(0, 0, 0, 0.1) 0px 14px 32px 0px, oklab(0.263084 -0.00230259 0.0124794 / 0.1) 0px 0px 0px 1px`.
- Apply Canvas Parchment (`#f7f7f4`) as the primary background for all major page sections and UI elements.
- Reserve Onyx Outline (`#f54e00`) exclusively for outlined interactive elements or prominent link text to signal primary action.
- Use `4px` border-radius for most general rounded elements like cards and buttons, with `8px` radius for more visually distinct components.
- Maintain a compact information density with an `8px` element gap between related UI elements.
- Ensure input fields use a transparent background with Muted Stone (`#7a7974`) for borders, prioritizing readability of the input over strong visual containment.

### Don't

- Do not use solid background colors for primary call-to-action buttons; prefer bordered actions with Onyx Outline (`#f54e00`).
- Avoid arbitrary shadow values; adhere strictly to the defined multi-layered shadow for all elevated cards and elements.
- Never use purely achromatic grays for primary text or borders; always use Inkwell (`#26251e`) or Muted Stone (`#7a7974`).
- Do not introduce new font families or weights beyond CursorGothic (`400`), Lato (`400`, `600`), and berkeleyMono (`400`, `500`).
- Do not use the vivid accent color Onyx Outline (`#f54e00`) as a background fill for any component.
- Avoid large, uncontained background images; all visuals should appear within component bounds or as subtle, textural overlays.
- Do not vary letter-spacing for standard body text or inputs; only apply the specified letter-spacing values for CursorGothic headlines.
