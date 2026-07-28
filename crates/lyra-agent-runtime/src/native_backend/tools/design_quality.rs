use super::*;
use glob::Pattern;
use regex::{Regex, RegexBuilder};
use std::collections::{BTreeMap, HashSet};
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const MAX_SOURCE_FILE_BYTES: u64 = 512 * 1024;
const DEFAULT_MAX_FILES: usize = 2_000;
const DEFAULT_MAX_FINDINGS: usize = 100;
const ALL_SURFACES: &[&str] = &["product_ui", "marketing", "docs", "editorial"];

#[derive(Clone, Copy)]
struct DesignQualityRule {
    id: &'static str,
    category: &'static str,
    title: &'static str,
    principle: &'static str,
    severity: &'static str,
    confidence: &'static str,
    surfaces: &'static [&'static str],
    source_patterns: &'static [&'static str],
    rendered_signals: &'static [&'static str],
    recommendation: &'static str,
    false_positive_checks: &'static [&'static str],
}

struct CompiledRule {
    rule: DesignQualityRule,
    patterns: Vec<Regex>,
}

static RULES: &[DesignQualityRule] = &[
    DesignQualityRule {
        id: "intent.generic_claims",
        category: "intent_copy",
        title: "Interchangeable product claims",
        principle: "Product copy should name a concrete capability, relationship, or consequence instead of generic excitement.",
        severity: "medium",
        confidence: "medium",
        surfaces: ALL_SURFACES,
        source_patterns: &[
            r"(?i)\b(unlock (?:the )?(?:power|potential)|next[- ]generation|game[- ]changer|revolutionary|seamless(?:ly)?|effortless(?:ly)?|supercharge|blazing fast)\b",
            r"(重新定义|赋能.{0,12}(?:未来|效率|创作)|释放.{0,10}潜力|下一代.{0,12}(?:平台|体验|工具)|一站式.{0,12}解决方案|无缝.{0,10}体验|极致.{0,10}体验)",
            r"(?i)\bnot (?:only|just)\b.{0,80}\bbut\b",
            r"(不只是|不仅仅是).{0,40}(更是|而是)",
        ],
        rendered_signals: &["page copy"],
        recommendation: "Replace the claim with specific nouns, real behavior, and a consequence the user can verify.",
        false_positive_checks: &[
            "The phrase may be a quotation or user-authored content.",
            "A brand slogan may be intentional when nearby copy supplies concrete evidence.",
        ],
    },
    DesignQualityRule {
        id: "intent.obvious_instructions",
        category: "intent_copy",
        title: "Explaining visible controls",
        principle: "Interfaces should not narrate interactions that are already clear from labels and structure.",
        severity: "low",
        confidence: "medium",
        surfaces: ALL_SURFACES,
        source_patterns: &[
            r"(?i)\b(click (?:here|the button)|use the (?:button|menu|control) (?:above|below)|you can (?:click|switch|type|select))\b",
            r"(点击这里|点击(?:上方|下方|这个)按钮|您可以(?:点击|切换|输入|选择)|你可以(?:点击|切换|输入|选择)|上面的.{0,16}(?:可以|用于))",
        ],
        rendered_signals: &["page copy"],
        recommendation: "Remove the narration or replace it with state, risk, result, or the next action.",
        false_positive_checks: &[
            "Onboarding, accessibility help, and unfamiliar high-risk workflows may need concise instruction.",
        ],
    },
    DesignQualityRule {
        id: "intent.unsourced_metrics",
        category: "intent_copy",
        title: "Unsourced marketing metrics",
        principle: "Numbers used as proof should be measured, attributable, and meaningful.",
        severity: "high",
        confidence: "medium",
        surfaces: &["marketing"],
        source_patterns: &[
            r"(?i)\b\d+(?:\.\d+)?[km]\+\s+(?:users|teams|developers|customers|downloads)\b",
            r"\b99\.9+%\b",
            r"(?i)\b24\s*/\s*7\b",
            r"\d+(?:万|亿)\+?.{0,8}(?:用户|团队|开发者|下载)",
            r#"(?is)data-(?:target|value)\s*=\s*["']\d+(?:\.\d+)?["'][\s\S]{0,180}(?:万\+?\s*(?:活跃)?用户|%\s*用户满意度|ms\s*平均响应|%\s*服务可用性)"#,
        ],
        rendered_signals: &["page copy"],
        recommendation: "Remove the number or add a real source, scope, date, and measurement method.",
        false_positive_checks: &[
            "The value may be real product data rendered from a trusted source.",
            "Operational availability statements may be contractual rather than decorative.",
        ],
    },
    DesignQualityRule {
        id: "intent.placeholder_or_dead_action",
        category: "intent_copy",
        title: "Placeholder content or dead actions",
        principle: "A commercial interface should not present fake controls, placeholder assets, or unfinished copy as complete.",
        severity: "high",
        confidence: "high",
        surfaces: ALL_SURFACES,
        source_patterns: &[
            r##"(?i)href\s*=\s*["']#["']"##,
            r"(?i)\b(lorem ipsum|placeholder image|coming soon content|todo: replace|replace me)\b",
            r"(占位图|占位内容|稍后替换|待补充内容|这里放)",
            r#"(?i)\balert\s*\(\s*['"](?:coming soon|todo|not implemented)"#,
        ],
        rendered_signals: &["links", "assets"],
        recommendation: "Connect the real action, clearly mark unavailable functionality, or remove the unfinished element.",
        false_positive_checks: &[
            "Hash links may be intentional for a real same-page anchor; verify the target exists.",
            "Examples and test fixtures may deliberately contain placeholder content.",
        ],
    },
    DesignQualityRule {
        id: "intent.prototype_residue",
        category: "intent_copy",
        title: "Prototype residue presented as product",
        principle: "A production-oriented interface should not present mock products, demo data, or prototype-only behavior as a finished experience.",
        severity: "high",
        confidence: "medium",
        surfaces: &["product_ui", "marketing"],
        source_patterns: &[
            r"(?i)\b(?:fictional|mock|placeholder)\s+(?:product|brand|customer|data)\b",
            r"(?i)\b(?:demo|prototype)\s+(?:only|site|landing page|data)\b",
            r"(虚构产品|虚构品牌|示例产品|样例产品|演示数据|原型数据|占位品牌)",
        ],
        rendered_signals: &["page copy", "actions", "data"],
        recommendation: "Use real product facts and working actions, clearly label an explicitly requested prototype, or remove the residue.",
        false_positive_checks: &[
            "The user may have explicitly requested a demo, prototype, mockup, or test fixture.",
            "Developer documentation may discuss prototype behavior without shipping it to users.",
        ],
    },
    DesignQualityRule {
        id: "color.unjustified_gradient_glow",
        category: "color_material",
        title: "Decorative gradient or glow",
        principle: "Gradients and glows should explain focus, depth, identity, or direction rather than fill empty space.",
        severity: "medium",
        confidence: "low",
        surfaces: ALL_SURFACES,
        source_patterns: &[
            r"(?i)(radial|conic)-gradient\s*\(",
            r"(?i)linear-gradient\s*\([^;\n]*(?:indigo|violet|purple|fuchsia|#6366f1|#8b5cf6|#a855f7)",
            r"(?i)(?:box|text)-shadow\s*:[^;\n]*(?:purple|violet|indigo|rgba?\(\s*(?:99,\s*102,\s*241|139,\s*92,\s*246|168,\s*85,\s*247))",
        ],
        rendered_signals: &["tokens.gradients", "tokens.shadow"],
        recommendation: "Use a flat surface or one justified accent; keep any effect attached to a specific element or spatial relationship.",
        false_positive_checks: &[
            "The gradient may be a real brand asset, data visualization, image treatment, or directional affordance.",
            "Judge combinations and repetition, not the mere existence of a gradient.",
        ],
    },
    DesignQualityRule {
        id: "color.gradient_text",
        category: "color_material",
        title: "Gradient-filled text",
        principle: "Text hierarchy should primarily come from language, size, weight, and position.",
        severity: "medium",
        confidence: "high",
        surfaces: ALL_SURFACES,
        source_patterns: &[
            r"(?i)(?:-webkit-)?background-clip\s*:\s*text",
            r"(?i)-webkit-text-fill-color\s*:\s*transparent",
            r"(?i)bg-clip-text.{0,80}text-transparent|text-transparent.{0,80}bg-clip-text",
        ],
        rendered_signals: &["heading styles"],
        recommendation: "Use a solid readable color and create emphasis with hierarchy rather than a fill effect.",
        false_positive_checks: &[
            "A logo or one deliberate brand wordmark may use custom text treatment.",
        ],
    },
    DesignQualityRule {
        id: "color.stock_semantic_rainbow",
        category: "color_material",
        title: "Framework-default semantic rainbow",
        principle: "Status colors should belong to one visual system and be used only when states truly differ.",
        severity: "medium",
        confidence: "low",
        surfaces: &["product_ui", "docs"],
        source_patterns: &[
            r"(?i)(?:bg|text|border)-(?:blue|indigo)-(?:50|100|500|600).{0,160}(?:bg|text|border)-(?:amber|yellow|green|emerald|red)-(?:50|100|500|600)",
            r"(?i)(?:info|success|warning|error).{0,80}(?:blue|green|amber|yellow|red)-(?:50|100|500|600)",
        ],
        rendered_signals: &["tokens.colors"],
        recommendation: "Start with neutral surfaces and use a restrained, product-specific state palette.",
        false_positive_checks: &[
            "Conventional red, yellow, and green may be appropriate for genuine risk and status.",
            "Verify whether the colors come from an established product token system.",
        ],
    },
    DesignQualityRule {
        id: "color.monochrome_status_surface",
        category: "color_material",
        title: "Single-hue status surface",
        principle: "A status should remain understandable through words and hierarchy before color.",
        severity: "low",
        confidence: "medium",
        surfaces: &["product_ui", "docs"],
        source_patterns: &[
            r"(?i)border-(?:red|amber|yellow|green|blue)-\d+.{0,100}text-(?:red|amber|yellow|green|blue)-\d+",
            r"(?i)(?:error|warning|success).{0,100}(?:bg|border|text)-(?:red|amber|yellow|green)-\d+",
        ],
        rendered_signals: &["component colors"],
        recommendation: "Keep the surface neutral, state the condition in text, and use at most one restrained accent.",
        false_positive_checks: &[
            "High-risk destructive confirmations may intentionally use stronger color.",
        ],
    },
    DesignQualityRule {
        id: "color.glass_overuse",
        category: "color_material",
        title: "Glass and blur overuse",
        principle: "Transparency should preserve readable layers and communicate material, not erase hierarchy.",
        severity: "medium",
        confidence: "medium",
        surfaces: ALL_SURFACES,
        source_patterns: &[
            r"(?i)backdrop-(?:filter|blur)|backdrop-filter\s*:",
            r"(?i)background(?:-color)?\s*:\s*(?:rgba|hsla)\([^;\n]*,\s*0\.(?:0[1-9]|1|2)\s*\)",
        ],
        rendered_signals: &["qualitySignals.backdropFilterCount"],
        recommendation: "Limit blur to a small number of material surfaces and keep inputs, menus, and dense content sufficiently solid.",
        false_positive_checks: &[
            "Native platform materials and a deliberately translucent product identity may be valid.",
            "The problem is repetition or lost hierarchy, not a single blur surface.",
        ],
    },
    DesignQualityRule {
        id: "typography.mixed_decorative_voice",
        category: "typography",
        title: "Decorative type voice without product reason",
        principle: "Typography should have a coherent voice appropriate to the product and reading context.",
        severity: "medium",
        confidence: "low",
        surfaces: &["product_ui", "marketing", "docs"],
        source_patterns: &[
            r"(?i)font-(?:serif|italic).{0,100}(?:text-[4-9]xl|font-(?:bold|black))",
            r"(?i)font-family\s*:[^;\n]*(?:playfair|cormorant|lora|dm serif|libre baskerville)",
            r"(?i)<(?:em|i)[^>]*(?:font-serif|font-family)",
        ],
        rendered_signals: &["tokens.fontFamilies"],
        recommendation: "Use one deliberate type voice; reserve editorial or expressive faces for contexts that genuinely need them.",
        false_positive_checks: &[
            "Editorial, publishing, cultural, and luxury contexts may intentionally use serif typography.",
            "A brand wordmark is not UI typography.",
        ],
    },
    DesignQualityRule {
        id: "typography.repeated_kicker",
        category: "typography",
        title: "Repeated heading kicker",
        principle: "Small labels above headings should add information rather than restate the section.",
        severity: "low",
        confidence: "medium",
        surfaces: &["marketing", "docs", "editorial"],
        source_patterns: &[
            r"(?i)\b(?:eyebrow|kicker|overline)\b",
            r"(?i)(?:uppercase|text-transform\s*:\s*uppercase).{0,100}(?:tracking-(?:wide|wider|widest)|letter-spacing\s*:\s*0\.[1-9]em)",
        ],
        rendered_signals: &["components.headings"],
        recommendation: "Delete labels that repeat the heading; keep category, date, or sequence labels only when they add meaning.",
        false_positive_checks: &[
            "A genuine category, date, chapter, or ordered sequence is useful metadata.",
        ],
    },
    DesignQualityRule {
        id: "typography.oversized_sentence",
        category: "typography",
        title: "Sentence-sized display headline",
        principle: "Display type should amplify the smallest phrase that carries the idea.",
        severity: "medium",
        confidence: "medium",
        surfaces: &["marketing", "editorial"],
        source_patterns: &[
            r"(?i)(?:text-[6-9]xl|font-size\s*:\s*(?:[5-9]\dpx|[4-9](?:\.\d+)?rem))",
            r"(?i)letter-spacing\s*:\s*-[0-9.]+(?:em|rem|px)",
        ],
        rendered_signals: &["components.headings"],
        recommendation: "Shorten the display phrase and move detail into normal-sized supporting copy.",
        false_positive_checks: &[
            "A short title, name, or expressive editorial cover can legitimately use display scale.",
        ],
    },
    DesignQualityRule {
        id: "typography.flat_hierarchy",
        category: "typography",
        title: "Flat type hierarchy",
        principle: "Important information should be visibly distinguishable through a small set of meaningful type steps.",
        severity: "medium",
        confidence: "medium",
        surfaces: ALL_SURFACES,
        source_patterns: &[r"(?i)<h[12][^>]*(?:text-(?:xs|sm|base|lg)|font-size\s*:\s*1[4-8]px)"],
        rendered_signals: &["components.headings", "tokens.fontSizes"],
        recommendation: "Merge near-duplicate sizes and create clear steps between primary, secondary, and supporting text.",
        false_positive_checks: &[
            "A deliberately quiet editorial layout may use spacing and position instead of large type differences.",
        ],
    },
    DesignQualityRule {
        id: "typography.decorative_monospace",
        category: "typography",
        title: "Monospace used as atmosphere",
        principle: "Monospace type should signal code, identifiers, or machine-readable values rather than generic technical mood.",
        severity: "low",
        confidence: "low",
        surfaces: ALL_SURFACES,
        source_patterns: &[
            r"(?i)\bfont-mono\b",
            r"(?i)font-family\s*:[^;\n]*(?:jetbrains mono|fira code|ibm plex mono|geist mono|monospace)",
            r"[╔╗╚╝║═▓▒░]",
        ],
        rendered_signals: &["tokens.fontFamilies"],
        recommendation: "Keep monospace for code and data; use the main text family for navigation, marketing, and body copy.",
        false_positive_checks: &[
            "Developer tools, terminals, code samples, and identifiers genuinely require monospace.",
        ],
    },
    DesignQualityRule {
        id: "components.pill_badge_spam",
        category: "components_assets",
        title: "Pill and badge repetition",
        principle: "Pills and badges should represent compact state or metadata, not decorate ordinary content.",
        severity: "medium",
        confidence: "medium",
        surfaces: ALL_SURFACES,
        source_patterns: &[
            r"(?i)rounded-full.{0,100}(?:badge|pill|chip|tag|bg-(?:indigo|purple|blue|green|amber|pink))",
            r"(?i)>\s*(?:new|beta|popular|hot|pro|coming soon|新品|热门|推荐|即将推出)\s*<",
        ],
        rendered_signals: &["components.buttons", "tokens.radius"],
        recommendation: "Keep badges for real status or metadata and let normal content use alignment and text hierarchy.",
        false_positive_checks: &[
            "Tabs, filters, avatars, switches, and genuine compact statuses may be pill-shaped.",
        ],
    },
    DesignQualityRule {
        id: "components.tinted_icon_tiles",
        category: "components_assets",
        title: "Tinted icon tile grid",
        principle: "Icons should improve recognition, not fill a template grid with decorative color blocks.",
        severity: "low",
        confidence: "low",
        surfaces: &["marketing", "product_ui"],
        source_patterns: &[
            r"(?i)rounded-(?:lg|xl|2xl).{0,100}bg-(?:indigo|purple|blue|green|amber|pink|red)-(?:50|100)",
            r"(?i)bg-(?:indigo|blue|green|amber|red|purple|pink)-\d+/(?:5|10|15|20).{0,120}text-(?:indigo|blue|green|amber|red|purple|pink)-",
        ],
        rendered_signals: &["components.cards"],
        recommendation: "Use a meaningful icon without a tinted tile, or replace the grid with specific labelled content.",
        false_positive_checks: &[
            "Real product identities, file types, providers, and risk states may need color.",
        ],
    },
    DesignQualityRule {
        id: "components.nested_surfaces",
        category: "components_assets",
        title: "Nested cards and redundant surfaces",
        principle: "One region should normally have one surface boundary; internal hierarchy can use spacing and hairlines.",
        severity: "medium",
        confidence: "medium",
        surfaces: ALL_SURFACES,
        source_patterns: &[
            r"(?i)<(?:Card|Panel|Box)[^>]*>\s*<(?:Card|Panel|Box)\b",
            r"(?i)(?:card|panel)[^{}\n]*\{[^}]{0,300}(?:card|panel)",
        ],
        rendered_signals: &["qualitySignals.nestedSurfaces"],
        recommendation: "Remove the redundant outer or inner surface and keep a single clear containment level.",
        false_positive_checks: &[
            "A modal, popover, inspector, or independently scrollable tool may need a separate surface.",
        ],
    },
    DesignQualityRule {
        id: "components.monolithic_page",
        category: "components_assets",
        title: "Large monolithic frontend artifact",
        principle: "A non-trivial production interface should keep content, styling, and behavior in maintainable ownership boundaries.",
        severity: "high",
        confidence: "high",
        surfaces: &["product_ui", "marketing"],
        source_patterns: &[r"(?i)<style(?:\s|>)"],
        rendered_signals: &["document structure", "component ownership"],
        recommendation: "Split a large mixed HTML/CSS/JS artifact into the existing project structure or a minimal set of focused modules.",
        false_positive_checks: &[
            "The user may have explicitly requested a single-file artifact.",
            "A small static document, email, exported report, or explicit demo may be intentionally self-contained.",
        ],
    },
    DesignQualityRule {
        id: "components.oversized_elevation",
        category: "components_assets",
        title: "Oversized shadow or radius",
        principle: "Elevation and corner geometry should map to a believable hierarchy and remain consistent.",
        severity: "medium",
        confidence: "medium",
        surfaces: ALL_SURFACES,
        source_patterns: &[
            r"(?i)(?:box-shadow|drop-shadow)[^;\n]*(?:\b[6-9]\dpx\b|\b\d{3,}px\b)",
            r"(?i)border-radius\s*:\s*(?:9999px|[3-9]\dpx|[3-9](?:\.\d+)?rem)",
            r"(?i)\bshadow-(?:xl|2xl)\b.{0,100}\bborder\b|\bborder\b.{0,100}\bshadow-(?:xl|2xl)\b",
        ],
        rendered_signals: &["tokens.radius", "tokens.shadow"],
        recommendation: "Use a small radius scale and tight neutral elevation; often a hairline is sufficient.",
        false_positive_checks: &[
            "Circular controls, avatars, full-bleed media, and large spatial overlays can justify stronger geometry.",
        ],
    },
    DesignQualityRule {
        id: "layout.template_card_grid",
        category: "layout_density",
        title: "Template-like feature grid",
        principle: "Page structure should follow the product story and task rather than a default three-card composition.",
        severity: "medium",
        confidence: "low",
        surfaces: &["marketing"],
        source_patterns: &[
            r"(?i)\bgrid-cols-3\b",
            r"(?i)\b(?:everything you need|why (?:choose|teams|you(?:'|’)ll love)|all the tools)\b",
            r"(为什么选择|您所需要的一切|你需要的一切|核心优势|功能亮点)",
        ],
        rendered_signals: &["components.cards", "sections"],
        recommendation: "Show the most important product relationship fully and let section structure follow real content.",
        false_positive_checks: &[
            "A comparison, catalogue, or repeated dataset may genuinely require a grid.",
        ],
    },
    DesignQualityRule {
        id: "layout.narrow_center_column",
        category: "layout_density",
        title: "Underused viewport",
        principle: "Content width and empty space should support reading and task structure rather than leave the interface stranded.",
        severity: "medium",
        confidence: "low",
        surfaces: &["product_ui", "marketing"],
        source_patterns: &[
            r"(?i)max-width\s*:\s*(?:6\d\d|7\d\d)px",
            r"(?i)\bmax-w-(?:2xl|3xl)\b",
        ],
        rendered_signals: &["sections", "viewport"],
        recommendation: "Use the available viewport for meaningful composition, or make the narrow measure clearly intentional for reading.",
        false_positive_checks: &[
            "Long-form reading, legal text, and forms often need a deliberately narrow measure.",
        ],
    },
    DesignQualityRule {
        id: "interaction.incomplete_states",
        category: "interaction_state",
        title: "Incomplete interaction states",
        principle: "Controls need coherent default, hover, focus, selected, disabled, loading, empty, error, and success behavior where applicable.",
        severity: "high",
        confidence: "low",
        surfaces: &["product_ui"],
        source_patterns: &[r"(?i):hover[^{}]*\{[^}]+\}", r"(?i)cursor\s*:\s*pointer"],
        rendered_signals: &["qualitySignals.controlStates"],
        recommendation: "Define the states required by the control's real lifecycle and keep hover, selection, and keyboard focus distinct.",
        false_positive_checks: &[
            "States may be supplied by a shared component or design-system stylesheet outside the scanned file.",
        ],
    },
    DesignQualityRule {
        id: "motion.indiscriminate_transition",
        category: "motion_performance",
        title: "Indiscriminate transition or hover motion",
        principle: "Motion should identify what changed and avoid animating unrelated properties.",
        severity: "medium",
        confidence: "high",
        surfaces: ALL_SURFACES,
        source_patterns: &[
            r"(?i)\btransition-all\b",
            r"(?i)transition\s*:\s*all\b",
            r"(?i)hover:(?:scale-|translate-y-)|animate-bounce",
            r"(?i)cubic-bezier\([^)]*,\s*1\.[2-9]",
        ],
        rendered_signals: &["qualitySignals.transitionAll"],
        recommendation: "Animate only the properties that communicate a state or spatial relationship, using restrained timing and easing.",
        false_positive_checks: &[
            "A focused interactive demonstration may intentionally use expressive motion.",
        ],
    },
    DesignQualityRule {
        id: "motion.persistent_effects",
        category: "motion_performance",
        title: "Persistent decorative effects",
        principle: "Continuously running animation, blur, and filters should earn their rendering cost.",
        severity: "medium",
        confidence: "medium",
        surfaces: ALL_SURFACES,
        source_patterns: &[
            r"(?i)animation-iteration-count\s*:\s*infinite",
            r"(?i)\banimate-(?:pulse|spin|ping)\b",
            r"(?i)will-change\s*:\s*(?:transform|filter|all)",
            r"(?i)filter\s*:[^;\n]*(?:blur|drop-shadow)",
        ],
        rendered_signals: &["tokens.animations", "qualitySignals.backdropFilterCount"],
        recommendation: "Stop effects when they are not visible or informative, and prefer static structure over ambient animation.",
        false_positive_checks: &[
            "Loading indicators, media, canvases, and intentional live visualizations may run continuously.",
        ],
    },
    DesignQualityRule {
        id: "motion.missing_reduced_motion",
        category: "motion_performance",
        title: "Motion without a reduced-motion path",
        principle: "Non-essential animation should have a usable reduced-motion alternative.",
        severity: "high",
        confidence: "medium",
        surfaces: ALL_SURFACES,
        source_patterns: &[r"(?i)animation\s*:|@keyframes|gsap\.|framer-motion|motion\."],
        rendered_signals: &["qualitySignals.reducedMotionSupported", "tokens.animations"],
        recommendation: "Add a prefers-reduced-motion path that removes or simplifies non-essential movement.",
        false_positive_checks: &[
            "The reduced-motion rule may live in a shared global stylesheet outside the scanned path.",
            "Essential progress feedback may remain animated in a reduced form.",
        ],
    },
    DesignQualityRule {
        id: "responsive.horizontal_overflow",
        category: "responsive_accessibility",
        title: "Viewport overflow or clipped content",
        principle: "Important content and controls should remain visible and stable across supported viewport sizes.",
        severity: "high",
        confidence: "high",
        surfaces: ALL_SURFACES,
        source_patterns: &[
            r"(?i)\bmin-width\s*:\s*(?:1[2-9]\d{2}|[2-9]\d{3,})px",
            r"(?i)\bwidth\s*:\s*100vw\b.{0,120}\bpadding\b",
            r"(?i)overflow-x\s*:\s*hidden",
        ],
        rendered_signals: &[
            "qualitySignals.horizontalOverflow",
            "qualitySignals.textClipping",
        ],
        recommendation: "Fix the responsible geometry, wrapping, or responsive composition instead of hiding the overflow.",
        false_positive_checks: &[
            "Carousels, code editors, data grids, and intentional horizontal scrollers may overflow within a bounded region.",
        ],
    },
    DesignQualityRule {
        id: "accessibility.unlabelled_control",
        category: "responsive_accessibility",
        title: "Interactive control without an accessible name",
        principle: "Every interactive control needs a stable, meaningful accessible name.",
        severity: "high",
        confidence: "high",
        surfaces: ALL_SURFACES,
        source_patterns: &[
            r"(?i)<button[^>]*>\s*(?:<svg\b[^>]*>.*?</svg>|<[^>]+/>)\s*</button>",
            r#"(?i)<(?:div|span)[^>]*(?:role\s*=\s*['"]button['"]|onClick\s*=)[^>]*>"#,
        ],
        rendered_signals: &["qualitySignals.unlabelledControls"],
        recommendation: "Use the native control and provide visible text or aria-label/aria-labelledby that names the action.",
        false_positive_checks: &[
            "A wrapper may receive its accessible name through a framework primitive not visible in the local line.",
        ],
    },
    DesignQualityRule {
        id: "accessibility.missing_alt",
        category: "responsive_accessibility",
        title: "Image without alternative text decision",
        principle: "Images need meaningful alternative text or an explicit empty alt when decorative.",
        severity: "high",
        confidence: "high",
        surfaces: ALL_SURFACES,
        source_patterns: &[r"(?i)<img\b"],
        rendered_signals: &["qualitySignals.missingAltImages"],
        recommendation: "Add concise meaningful alt text, or alt=\"\" when the image is purely decorative.",
        false_positive_checks: &[
            "A framework image wrapper may inject alt through props spread; inspect the component call.",
        ],
    },
    DesignQualityRule {
        id: "accessibility.low_contrast",
        category: "responsive_accessibility",
        title: "Low text contrast",
        principle: "Visual subtlety must not make essential text difficult to read.",
        severity: "high",
        confidence: "medium",
        surfaces: ALL_SURFACES,
        source_patterns: &[
            r"(?i)opacity\s*:\s*0\.[0-3]\b",
            r"(?i)\btext-(?:gray|slate|zinc|neutral)-(?:300|400)\b.{0,100}\bbg-(?:white|gray|slate|zinc|neutral)-(?:50|100)\b",
        ],
        rendered_signals: &["qualitySignals.lowContrastText"],
        recommendation: "Increase foreground/background contrast while preserving hierarchy through size and weight.",
        false_positive_checks: &[
            "Disabled and non-essential decorative text can be lower contrast, but must remain understandable where required.",
            "Image and gradient backgrounds require visual inspection because computed contrast may be unresolved.",
        ],
    },
    DesignQualityRule {
        id: "theme.inversion_only",
        category: "responsive_accessibility",
        title: "Theme implemented as simple inversion",
        principle: "Light and dark themes need independently calibrated surfaces, borders, contrast, and elevation.",
        severity: "medium",
        confidence: "low",
        surfaces: ALL_SURFACES,
        source_patterns: &[
            r"(?i)filter\s*:\s*invert\s*\(",
            r"(?i)mix-blend-mode\s*:\s*difference",
            r"(?i)prefers-color-scheme[^{}]*\{[^}]{0,300}(?:filter\s*:\s*invert|color\s*:\s*white[^}]*background\s*:\s*black)",
        ],
        rendered_signals: &["qualitySignals.theme"],
        recommendation: "Define semantic theme tokens and calibrate each surface and state in both themes.",
        false_positive_checks: &[
            "Media, icons, and isolated assets may legitimately invert for contrast.",
        ],
    },
];

pub(crate) fn tool_design_quality(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> NativeToolResult {
    let action = value_string(input, "action").unwrap_or_else(|| "list_rules".to_string());
    let normalized_action = action.trim().to_ascii_lowercase();
    let result = match normalized_action.as_str() {
        "list" | "list_rules" | "rules" => list_rules(input),
        "read" | "read_rule" => read_rule(input),
        "audit_source" | "source" => audit_source(session_id, input),
        "audit_rendered" | "rendered" => {
            audit_rendered(session_id, turn_id, tool_call_id, input, dispatcher)
        }
        _ => Err(NativeToolFailure::new(
            "bad_action",
            format!("Unknown design quality action: {action}"),
            "Use list_rules, read_rule, audit_source, or audit_rendered.",
        )),
    };
    if let Ok(success) = &result {
        let mode = match normalized_action.as_str() {
            "audit_source" | "source" => Some("source"),
            "audit_rendered" | "rendered" => Some("rendered"),
            _ => None,
        };
        if let Some(mode) = mode {
            record_design_quality_audit(session_id, turn_id, mode, &success.raw);
        }
    }
    result
}

fn list_rules(input: &Value) -> NativeToolResult {
    let filters = filters(input);
    let entries = RULES
        .iter()
        .filter(|rule| filters.matches(rule))
        .map(rule_summary)
        .collect::<Vec<_>>();
    let mut content = format!("{} design quality rules:\n", entries.len());
    for rule in RULES.iter().filter(|rule| filters.matches(rule)) {
        let _ = writeln!(content, "- {} [{}]: {}", rule.id, rule.category, rule.title);
    }
    Ok(NativeToolSuccess {
        content,
        raw: json!({
            "kind": "design_quality_rule_catalog",
            "count": entries.len(),
            "rules": entries,
        }),
        recommended_next_action: Some(
            "Read a relevant rule or run audit_source/audit_rendered on the target interface."
                .to_string(),
        ),
    })
}

fn read_rule(input: &Value) -> NativeToolResult {
    let id = required_value_string(input, "ruleId")?;
    let rule = find_rule(&id).ok_or_else(|| {
        NativeToolFailure::new(
            "rule_not_found",
            format!("Unknown design quality rule: {id}"),
            "Call list_rules to inspect available rule ids.",
        )
    })?;
    Ok(NativeToolSuccess {
        content: format!(
            "{} [{}]\nPrinciple: {}\nRecommendation: {}\nFalse-positive checks:\n- {}",
            rule.title,
            rule.category,
            rule.principle,
            rule.recommendation,
            rule.false_positive_checks.join("\n- ")
        ),
        raw: json!({
            "kind": "design_quality_rule",
            "rule": rule_value(rule),
        }),
        recommended_next_action: Some(
            "Apply this rule as a contextual review lead, not an automatic violation.".to_string(),
        ),
    })
}

#[derive(Default)]
struct RuleFilters {
    categories: HashSet<String>,
    rule_ids: HashSet<String>,
}

impl RuleFilters {
    fn matches(&self, rule: &DesignQualityRule) -> bool {
        (self.categories.is_empty() || self.categories.contains(rule.category))
            && (self.rule_ids.is_empty() || self.rule_ids.contains(rule.id))
    }
}

fn filters(input: &Value) -> RuleFilters {
    RuleFilters {
        categories: string_array(input, "categories").into_iter().collect(),
        rule_ids: string_array(input, "ruleIds").into_iter().collect(),
    }
}

fn rule_summary(rule: &DesignQualityRule) -> Value {
    json!({
        "id": rule.id,
        "category": rule.category,
        "title": rule.title,
        "severity": rule.severity,
        "confidence": rule.confidence,
        "surfaces": rule.surfaces,
    })
}

fn rule_value(rule: &DesignQualityRule) -> Value {
    json!({
        "id": rule.id,
        "category": rule.category,
        "title": rule.title,
        "principle": rule.principle,
        "severity": rule.severity,
        "confidence": rule.confidence,
        "surfaces": rule.surfaces,
        "sourceSignals": rule.source_patterns,
        "renderedSignals": rule.rendered_signals,
        "recommendation": rule.recommendation,
        "falsePositiveChecks": rule.false_positive_checks,
    })
}

fn compiled_rules() -> &'static [CompiledRule] {
    static COMPILED: OnceLock<Vec<CompiledRule>> = OnceLock::new();
    COMPILED
        .get_or_init(|| {
            RULES
                .iter()
                .map(|rule| CompiledRule {
                    rule: *rule,
                    patterns: rule
                        .source_patterns
                        .iter()
                        .map(|pattern| {
                            RegexBuilder::new(pattern)
                                .unicode(true)
                                .build()
                                .unwrap_or_else(|error| {
                                    panic!("invalid design quality regex for {}: {error}", rule.id)
                                })
                        })
                        .collect(),
                })
                .collect()
        })
        .as_slice()
}

fn audit_source(session_id: &str, input: &Value) -> NativeToolResult {
    let requested_path = value_string(input, "path").unwrap_or_else(|| ".".to_string());
    let workspace_path = resolve_workspace_path(session_id, &requested_path, false)?;
    if workspace_path.outside_workspace {
        return Err(NativeToolFailure::new(
            "outside_workspace",
            "Design source audit only reads files inside the active workspace.",
            "Retry with a workspace-relative path.",
        ));
    }
    let max_files = value_usize(input, "maxFiles", DEFAULT_MAX_FILES, 10_000);
    let max_findings = value_usize(input, "maxFindings", DEFAULT_MAX_FINDINGS, 1_000);
    let include = compile_globs(input, "includeGlobs")?;
    let exclude = compile_globs(input, "excludeGlobs")?;
    let filters = filters(input);
    let surface_kind = surface_kind(input);
    let mut files = Vec::new();
    let mut collection_truncated = false;
    collect_source_files(
        &workspace_path.absolute,
        &workspace_path.root,
        &include,
        &exclude,
        max_files,
        &mut files,
        &mut collection_truncated,
    );

    let mut findings = Vec::new();
    let mut scanned_files = 0_usize;
    let mut skipped_large = 0_usize;
    let mut skipped_unreadable = 0_usize;
    for path in &files {
        let text = match read_source_file(path) {
            SourceFileRead::Text(text) => text,
            SourceFileRead::TooLarge => {
                skipped_large += 1;
                continue;
            }
            SourceFileRead::Unreadable => {
                skipped_unreadable += 1;
                continue;
            }
        };
        scanned_files += 1;
        let relative = path
            .strip_prefix(&workspace_path.root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        scan_source_text(
            &relative,
            &text,
            &filters,
            &surface_kind,
            max_findings,
            &mut findings,
        );
        if findings.len() >= max_findings {
            collection_truncated = true;
            break;
        }
    }

    let scope = json!({
        "path": workspace_path.relative,
        "surfaceKind": surface_kind,
        "maxFiles": max_files,
        "maxFindings": max_findings,
        "activeDesignSystem": active_design_summary(session_id),
    });
    Ok(quality_report(
        "source",
        scope,
        scanned_files,
        findings,
        collection_truncated,
        json!({
            "filesCollected": files.len(),
            "skippedLargeFiles": skipped_large,
            "skippedUnreadableFiles": skipped_unreadable,
        }),
        Vec::new(),
        false,
    ))
}

enum SourceFileRead {
    Text(String),
    TooLarge,
    Unreadable,
}

fn read_source_file(path: &Path) -> SourceFileRead {
    let Ok(metadata) = fs::metadata(path) else {
        return SourceFileRead::Unreadable;
    };
    if metadata.len() > MAX_SOURCE_FILE_BYTES {
        return SourceFileRead::TooLarge;
    }
    match fs::read_to_string(path) {
        Ok(text) => SourceFileRead::Text(text),
        Err(_) => SourceFileRead::Unreadable,
    }
}

fn scan_source_text(
    path: &str,
    text: &str,
    filters: &RuleFilters,
    surface_kind: &str,
    max_findings: usize,
    findings: &mut Vec<Value>,
) {
    let lines = text.lines().collect::<Vec<_>>();
    let mut emitted = HashSet::<(&'static str, usize)>::new();
    scan_document_level_source_rules(
        path,
        text,
        &lines,
        filters,
        surface_kind,
        max_findings,
        findings,
        &mut emitted,
    );
    if findings.len() >= max_findings {
        return;
    }
    for (index, line) in lines.iter().enumerate() {
        if line.len() > 4_000 {
            continue;
        }
        let window = lines[index..lines.len().min(index + 3)].join("\n");
        for compiled in compiled_rules() {
            if compiled.patterns.is_empty()
                || !filters.matches(&compiled.rule)
                || !surface_applies(&compiled.rule, surface_kind)
            {
                continue;
            }
            if let Some(offset) = source_rule_match_offset(compiled, &window) {
                let matched_index = (index
                    + window[..offset]
                        .bytes()
                        .filter(|byte| *byte == b'\n')
                        .count())
                .min(lines.len().saturating_sub(1));
                if !emitted.insert((compiled.rule.id, matched_index)) {
                    continue;
                }
                findings.push(finding(
                    &compiled.rule,
                    adjusted_confidence(&compiled.rule, surface_kind),
                    json!({
                        "path": path,
                        "line": matched_index + 1,
                        "excerpt": compact(lines[matched_index], 220),
                    }),
                ));
                if findings.len() >= max_findings {
                    return;
                }
            }
        }
    }
}

fn scan_document_level_source_rules(
    path: &str,
    text: &str,
    lines: &[&str],
    filters: &RuleFilters,
    surface_kind: &str,
    max_findings: usize,
    findings: &mut Vec<Value>,
    emitted: &mut HashSet<(&'static str, usize)>,
) {
    let Some(rule) = find_rule("components.monolithic_page") else {
        return;
    };
    if findings.len() >= max_findings
        || !filters.matches(rule)
        || !surface_applies(rule, surface_kind)
        || lines.len() < 400
        || !text.to_ascii_lowercase().contains("<style")
        || !text.to_ascii_lowercase().contains("<script")
        || text.to_ascii_lowercase().matches("<section").count() < 3
    {
        return;
    }
    let line = lines
        .iter()
        .position(|line| line.to_ascii_lowercase().contains("<style"))
        .unwrap_or_default();
    emitted.insert((rule.id, line));
    findings.push(finding(
        rule,
        adjusted_confidence(rule, surface_kind),
        json!({
            "path": path,
            "line": line + 1,
            "excerpt": format!("{} lines with inline <style>, <script>, and multiple page sections", lines.len()),
        }),
    ));
}

fn source_rule_match_offset(compiled: &CompiledRule, window: &str) -> Option<usize> {
    let first_match = compiled
        .patterns
        .iter()
        .filter_map(|pattern| pattern.find(window).map(|matched| matched.start()))
        .min()?;
    match compiled.rule.id {
        "components.monolithic_page" => None,
        "accessibility.missing_alt" => {
            static ALT_ATTRIBUTE: OnceLock<Regex> = OnceLock::new();
            let lower = window.to_ascii_lowercase();
            let mut cursor = 0;
            while let Some(relative_start) = lower[cursor..].find("<img") {
                let start = cursor + relative_start;
                let end = lower[start..]
                    .find('>')
                    .map(|relative_end| start + relative_end + 1)
                    .unwrap_or(lower.len());
                let tag = &window[start..end];
                if !ALT_ATTRIBUTE
                    .get_or_init(|| Regex::new(r"(?i)\balt\s*=").expect("alt regex"))
                    .is_match(tag)
                {
                    return Some(start);
                }
                cursor = end;
            }
            None
        }
        "interaction.incomplete_states" => {
            let lower = window.to_ascii_lowercase();
            ((lower.contains(":hover")
                && !lower.contains(":focus")
                && !lower.contains(":disabled"))
                || lower.contains("cursor: pointer")
                || lower.contains("cursor:pointer"))
            .then_some(first_match)
        }
        _ => Some(first_match),
    }
}

fn collect_source_files(
    current: &Path,
    workspace_root: &Path,
    include: &[Pattern],
    exclude: &[Pattern],
    max_files: usize,
    files: &mut Vec<PathBuf>,
    truncated: &mut bool,
) {
    if files.len() >= max_files {
        *truncated = true;
        return;
    }
    if current.is_file() {
        if source_file_allowed(current, workspace_root, include, exclude) {
            files.push(current.to_path_buf());
        }
        return;
    }
    let Ok(entries) = fs::read_dir(current) else {
        return;
    };
    let mut entries = entries.flatten().collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            if should_skip_directory(&path) {
                continue;
            }
            collect_source_files(
                &path,
                workspace_root,
                include,
                exclude,
                max_files,
                files,
                truncated,
            );
        } else if file_type.is_file()
            && source_file_allowed(&path, workspace_root, include, exclude)
        {
            files.push(path);
        }
        if files.len() >= max_files {
            *truncated = true;
            break;
        }
    }
}

fn source_file_allowed(
    path: &Path,
    workspace_root: &Path,
    include: &[Pattern],
    exclude: &[Pattern],
) -> bool {
    let relative = path.strip_prefix(workspace_root).unwrap_or(path);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if file_name.contains(".min.")
        || matches!(
            file_name.as_str(),
            "package-lock.json" | "pnpm-lock.yaml" | "yarn.lock" | "bun.lock" | "bun.lockb"
        )
    {
        return false;
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(
        extension.as_str(),
        "html"
            | "htm"
            | "css"
            | "scss"
            | "sass"
            | "less"
            | "tsx"
            | "jsx"
            | "ts"
            | "js"
            | "mjs"
            | "cjs"
            | "vue"
            | "svelte"
            | "astro"
            | "md"
            | "mdx"
    ) {
        return false;
    }
    (include.is_empty() || include.iter().any(|pattern| pattern.matches_path(relative)))
        && !exclude.iter().any(|pattern| pattern.matches_path(relative))
}

fn should_skip_directory(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    matches!(
        name,
        "node_modules"
            | ".git"
            | "dist"
            | "build"
            | "out"
            | ".next"
            | ".astro"
            | ".output"
            | ".svelte-kit"
            | ".nuxt"
            | "coverage"
            | "vendor"
            | ".cache"
            | ".vercel"
            | ".turbo"
            | "target"
    )
}

fn compile_globs(input: &Value, key: &str) -> Result<Vec<Pattern>, NativeToolFailure> {
    string_array(input, key)
        .into_iter()
        .map(|value| {
            Pattern::new(&value).map_err(|error| {
                NativeToolFailure::new(
                    "bad_glob",
                    format!("Invalid {key} pattern `{value}`: {error}"),
                    "Retry with valid workspace-relative glob patterns.",
                )
            })
        })
        .collect()
}

fn audit_rendered(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> NativeToolResult {
    let dispatcher = dispatcher.ok_or_else(|| {
        NativeToolFailure::new(
            "browser_host_unavailable",
            "Rendered design audit requires the Workbench Browser host capability.",
            "Open or enable the Workbench Browser, then rerun audit_rendered.",
        )
    })?;
    let extracted = tool_design_extract_reference(turn_id, tool_call_id, input, Some(dispatcher))?;
    let report = extracted
        .raw
        .get("report")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let filters = filters(input);
    let surface_kind = surface_kind(input);
    let max_findings = value_usize(input, "maxFindings", DEFAULT_MAX_FINDINGS, 1_000);
    let mut findings = Vec::new();

    rendered_token_findings(
        &report,
        &filters,
        &surface_kind,
        max_findings,
        &mut findings,
    );
    rendered_component_findings(
        &report,
        &filters,
        &surface_kind,
        max_findings,
        &mut findings,
    );
    rendered_quality_signal_findings(
        &report,
        &filters,
        &surface_kind,
        max_findings,
        &mut findings,
    );
    let truncated = findings.len() >= max_findings;

    let source_status = report
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("degraded");
    let degraded = source_status != "ok";
    let scanned = report
        .pointer("/document/sampledElementCount")
        .and_then(Value::as_u64)
        .or_else(|| {
            report
                .pointer("/document/visibleElementCount")
                .and_then(Value::as_u64)
        })
        .unwrap_or(0) as usize;
    let unverified = rendered_unverified_checks(&report);
    let scope = json!({
        "url": extracted.raw.get("finalUrl").cloned().unwrap_or(Value::Null),
        "targetSelector": value_string(input, "targetSelector"),
        "surfaceKind": surface_kind,
        "viewport": report.get("viewport").cloned().unwrap_or(Value::Null),
        "activeDesignSystem": active_design_summary(session_id),
    });
    let mut result = quality_report(
        "rendered",
        scope,
        scanned,
        findings,
        truncated,
        json!({
            "sourceReportStatus": source_status,
            "sourceWarnings": report.get("warnings").cloned().unwrap_or_else(|| json!([])),
            "screenshotArtifactRef": extracted.raw.get("screenshotArtifactRef").cloned().unwrap_or(Value::Null),
        }),
        unverified,
        degraded,
    );
    result.raw["designReferenceReport"] = extracted.raw;
    Ok(result)
}

fn rendered_token_findings(
    report: &Value,
    filters: &RuleFilters,
    surface_kind: &str,
    max_findings: usize,
    findings: &mut Vec<Value>,
) {
    let gradients = token_entries(report, "gradients");
    let gradient_count = gradients
        .iter()
        .filter_map(|entry| entry.get("count").and_then(Value::as_u64))
        .sum::<u64>();
    push_rendered_if(
        gradient_count >= 3 || gradients.len() >= 2,
        "color.unjustified_gradient_glow",
        filters,
        surface_kind,
        findings,
        max_findings,
        json!({ "gradients": gradients }),
    );

    let radii = token_entries(report, "radius");
    let oversized_radius = radii.iter().any(|entry| {
        entry
            .get("value")
            .and_then(Value::as_str)
            .is_some_and(|value| max_px(value) >= 32.0 || value.contains("999"))
    });
    let shadows = token_entries(report, "shadow");
    let oversized_shadow = shadows.iter().any(|entry| {
        entry
            .get("value")
            .and_then(Value::as_str)
            .is_some_and(|value| max_px(value) >= 64.0)
    });
    push_rendered_if(
        oversized_radius || oversized_shadow,
        "components.oversized_elevation",
        filters,
        surface_kind,
        findings,
        max_findings,
        json!({ "radius": radii, "shadow": shadows }),
    );

    let headings = report
        .pointer("/components/headings")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let body_size = token_entries(report, "fontSizes")
        .first()
        .and_then(|entry| entry.get("value"))
        .and_then(Value::as_str)
        .map(max_px)
        .unwrap_or(16.0);
    let heading_sizes = headings
        .iter()
        .filter_map(|heading| {
            heading
                .pointer("/style/fontSize")
                .and_then(Value::as_str)
                .map(max_px)
        })
        .collect::<Vec<_>>();
    let max_heading = heading_sizes.iter().copied().fold(0.0_f64, f64::max);
    push_rendered_if(
        headings.len() >= 2 && max_heading > 0.0 && max_heading < body_size * 1.25,
        "typography.flat_hierarchy",
        filters,
        surface_kind,
        findings,
        max_findings,
        json!({
            "bodySize": body_size,
            "headingSizes": heading_sizes,
            "headings": headings.iter().take(6).cloned().collect::<Vec<_>>(),
        }),
    );

    if let Some(heading) = headings.iter().find(|heading| {
        let text = heading.get("text").and_then(Value::as_str).unwrap_or("");
        let font_size = heading
            .pointer("/style/fontSize")
            .and_then(Value::as_str)
            .map(max_px)
            .unwrap_or(0.0);
        font_size >= 48.0
            && (text.split_whitespace().count() >= 10
                || text
                    .chars()
                    .filter(|character| !character.is_whitespace())
                    .count()
                    >= 36)
    }) {
        push_rendered(
            "typography.oversized_sentence",
            filters,
            surface_kind,
            findings,
            max_findings,
            heading.clone(),
        );
    }
}

fn rendered_component_findings(
    report: &Value,
    filters: &RuleFilters,
    surface_kind: &str,
    max_findings: usize,
    findings: &mut Vec<Value>,
) {
    let buttons = report
        .pointer("/components/buttons")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let pill_buttons = buttons
        .iter()
        .filter(|button| {
            let radius = button
                .pointer("/style/borderRadius/topLeft")
                .and_then(Value::as_str)
                .map(max_px)
                .unwrap_or(0.0);
            let height = button
                .pointer("/bounds/height")
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            radius >= 999.0 || (height > 0.0 && radius >= height / 2.0)
        })
        .take(8)
        .cloned()
        .collect::<Vec<_>>();
    push_rendered_if(
        pill_buttons.len() >= 3,
        "components.pill_badge_spam",
        filters,
        surface_kind,
        findings,
        max_findings,
        json!({ "pillButtons": pill_buttons }),
    );

    let viewport_width = report
        .pointer("/viewport/width")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let narrow_main = report
        .get("sections")
        .and_then(Value::as_array)
        .and_then(|sections| {
            sections.iter().find(|section| {
                section.get("tag").and_then(Value::as_str) == Some("main")
                    && viewport_width >= 1_000.0
                    && section
                        .pointer("/bounds/width")
                        .and_then(Value::as_f64)
                        .is_some_and(|width| width / viewport_width < 0.58)
            })
        })
        .cloned();
    if let Some(main) = narrow_main {
        push_rendered(
            "layout.narrow_center_column",
            filters,
            surface_kind,
            findings,
            max_findings,
            main,
        );
    }
}

fn rendered_quality_signal_findings(
    report: &Value,
    filters: &RuleFilters,
    surface_kind: &str,
    max_findings: usize,
    findings: &mut Vec<Value>,
) {
    let signals = report.get("qualitySignals").unwrap_or(&Value::Null);
    let backdrop_count = signals
        .get("backdropFilterCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    push_rendered_if(
        backdrop_count > 2,
        "color.glass_overuse",
        filters,
        surface_kind,
        findings,
        max_findings,
        json!({ "backdropFilterCount": backdrop_count }),
    );

    for (rule_id, key) in [
        ("components.nested_surfaces", "nestedSurfaces"),
        ("responsive.horizontal_overflow", "horizontalOverflow"),
        ("responsive.horizontal_overflow", "textClipping"),
        ("accessibility.unlabelled_control", "unlabelledControls"),
        ("accessibility.missing_alt", "missingAltImages"),
        ("accessibility.low_contrast", "lowContrastText"),
        ("motion.indiscriminate_transition", "transitionAll"),
    ] {
        let evidence = signals
            .get(key)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if !evidence.is_empty() {
            push_rendered(
                rule_id,
                filters,
                surface_kind,
                findings,
                max_findings,
                json!({
                    "signal": key,
                    "samples": evidence.into_iter().take(8).collect::<Vec<_>>(),
                }),
            );
        }
    }

    let animations = token_entries(report, "animations")
        .into_iter()
        .filter(|entry| {
            entry
                .get("value")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.starts_with("none "))
        })
        .collect::<Vec<_>>();
    let reduced_motion = signals
        .get("reducedMotionSupported")
        .and_then(Value::as_bool);
    push_rendered_if(
        !animations.is_empty() && reduced_motion == Some(false),
        "motion.missing_reduced_motion",
        filters,
        surface_kind,
        findings,
        max_findings,
        json!({
            "animations": animations,
            "reducedMotionSupported": reduced_motion,
        }),
    );
}

#[allow(clippy::too_many_arguments)]
fn push_rendered_if(
    condition: bool,
    rule_id: &str,
    filters: &RuleFilters,
    surface_kind: &str,
    findings: &mut Vec<Value>,
    max_findings: usize,
    evidence: Value,
) {
    if condition {
        push_rendered(
            rule_id,
            filters,
            surface_kind,
            findings,
            max_findings,
            evidence,
        );
    }
}

fn push_rendered(
    rule_id: &str,
    filters: &RuleFilters,
    surface_kind: &str,
    findings: &mut Vec<Value>,
    max_findings: usize,
    evidence: Value,
) {
    if findings.len() >= max_findings {
        return;
    }
    let Some(rule) = find_rule(rule_id) else {
        return;
    };
    if filters.matches(rule) && surface_applies(rule, surface_kind) {
        findings.push(finding(
            rule,
            adjusted_confidence(rule, surface_kind),
            evidence,
        ));
    }
}

fn rendered_unverified_checks(report: &Value) -> Vec<Value> {
    let mut checks = vec![
        json!({
            "ruleId": "interaction.incomplete_states",
            "reason": "A static rendered snapshot cannot exercise every hover, focus, loading, error, success, and destructive state."
        }),
        json!({
            "ruleId": "theme.inversion_only",
            "reason": "Audit light and dark themes separately; one snapshot cannot prove cross-theme consistency."
        }),
    ];
    let unresolved_contrast = report
        .pointer("/qualitySignals/unresolvedContrastCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    if unresolved_contrast > 0 {
        checks.push(json!({
            "ruleId": "accessibility.low_contrast",
            "reason": format!("{unresolved_contrast} visible text samples use transparent, image, or gradient backgrounds and require visual inspection.")
        }));
    }
    checks
}

fn quality_report(
    mode: &str,
    scope: Value,
    scanned: usize,
    findings: Vec<Value>,
    truncated: bool,
    details: Value,
    unverified_checks: Vec<Value>,
    degraded: bool,
) -> NativeToolSuccess {
    let mut by_category = BTreeMap::<String, usize>::new();
    let mut by_severity = BTreeMap::<String, usize>::new();
    for finding in &findings {
        if let Some(category) = finding.get("category").and_then(Value::as_str) {
            *by_category.entry(category.to_string()).or_default() += 1;
        }
        if let Some(severity) = finding.get("severity").and_then(Value::as_str) {
            *by_severity.entry(severity.to_string()).or_default() += 1;
        }
    }
    let blocking_findings = findings
        .iter()
        .filter(|finding| {
            finding.get("severity").and_then(Value::as_str) == Some("high")
                && finding.get("confidence").and_then(Value::as_str) == Some("high")
        })
        .cloned()
        .collect::<Vec<_>>();
    let status = if degraded {
        "degraded"
    } else if findings.is_empty() {
        "clean"
    } else {
        "findings"
    };
    let summary = json!({
        "scanned": scanned,
        "findingsByCategory": by_category,
        "findingsBySeverity": by_severity,
        "blockingFindings": blocking_findings.len(),
        "truncated": truncated,
    });
    let mut content = format!(
        "DesignQualityReport: {status}\nMode: {mode}\nScanned: {scanned}\nFindings: {}\nBlocking high/high findings: {}\n",
        findings.len(),
        blocking_findings.len(),
    );
    let mut listed_blockers = HashSet::new();
    for finding in &blocking_findings {
        let rule_id = finding
            .get("ruleId")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        if listed_blockers.insert(rule_id) {
            let _ = writeln!(content, "- BLOCKER {rule_id}");
        }
    }
    for finding in findings.iter().take(24) {
        let _ = writeln!(
            content,
            "- [{} / {}] {}: {}",
            finding
                .get("severity")
                .and_then(Value::as_str)
                .unwrap_or("low"),
            finding
                .get("confidence")
                .and_then(Value::as_str)
                .unwrap_or("low"),
            finding
                .get("ruleId")
                .and_then(Value::as_str)
                .unwrap_or("unknown"),
            finding
                .get("recommendation")
                .and_then(Value::as_str)
                .unwrap_or_default()
        );
    }
    if truncated {
        content.push_str("- Report truncated at the configured limit.\n");
    }
    NativeToolSuccess {
        content,
        raw: json!({
            "kind": "design_quality_report",
            "mode": mode,
            "status": status,
            "scope": scope,
            "summary": summary,
            "findings": findings,
            "blockingFindings": blocking_findings,
            "unverifiedChecks": unverified_checks,
            "details": details,
        }),
        recommended_next_action: Some(
            "Inspect every finding in context, record which findings are fixed or intentionally retained, then verify the actual interface visually."
                .to_string(),
        ),
    }
}

fn finding(rule: &DesignQualityRule, confidence: &str, evidence: Value) -> Value {
    let evidence_key = evidence
        .get("path")
        .and_then(Value::as_str)
        .or_else(|| evidence.get("selector").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| {
            serde_json::to_string(&evidence).unwrap_or_else(|_| rule.id.to_string())
        });
    let line = evidence.get("line").and_then(Value::as_u64).unwrap_or(0);
    let id = format!(
        "dq-{}-{:x}",
        rule.id.replace('.', "-"),
        stable_hash(&format!("{evidence_key}:{line}"))
    );
    json!({
        "id": id,
        "ruleId": rule.id,
        "category": rule.category,
        "severity": rule.severity,
        "confidence": confidence,
        "evidence": evidence,
        "rationale": rule.principle,
        "recommendation": rule.recommendation,
        "falsePositiveChecks": rule.false_positive_checks,
        "needsHumanReview": true,
    })
}

fn find_rule(id: &str) -> Option<&'static DesignQualityRule> {
    RULES
        .iter()
        .find(|rule| rule.id.eq_ignore_ascii_case(id.trim()))
}

fn surface_kind(input: &Value) -> String {
    match value_string(input, "surfaceKind")
        .unwrap_or_else(|| "auto".to_string())
        .to_ascii_lowercase()
        .as_str()
    {
        "product_ui" => "product_ui",
        "marketing" => "marketing",
        "docs" => "docs",
        "editorial" => "editorial",
        _ => "auto",
    }
    .to_string()
}

fn surface_applies(rule: &DesignQualityRule, surface_kind: &str) -> bool {
    surface_kind == "auto" || rule.surfaces.contains(&surface_kind)
}

fn adjusted_confidence<'a>(rule: &'a DesignQualityRule, surface_kind: &str) -> &'a str {
    if surface_kind == "editorial"
        && matches!(
            rule.id,
            "typography.mixed_decorative_voice"
                | "typography.repeated_kicker"
                | "typography.oversized_sentence"
                | "typography.decorative_monospace"
        )
    {
        "low"
    } else if surface_kind == "docs" && rule.id == "typography.decorative_monospace" {
        "low"
    } else {
        rule.confidence
    }
}

fn active_design_summary(session_id: &str) -> Value {
    active_design_context(session_id)
        .map(|context| {
            json!({
                "brand": context.get("brand").cloned().unwrap_or(Value::Null),
                "documentHash": context.get("documentHash").cloned().unwrap_or(Value::Null),
            })
        })
        .unwrap_or(Value::Null)
}

fn string_array(input: &Value, key: &str) -> Vec<String> {
    input
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

fn token_entries(report: &Value, key: &str) -> Vec<Value> {
    report
        .get("tokens")
        .and_then(|tokens| tokens.get(key))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn max_px(value: &str) -> f64 {
    static NUMBER: OnceLock<Regex> = OnceLock::new();
    NUMBER
        .get_or_init(|| Regex::new(r"-?\d+(?:\.\d+)?").expect("number regex"))
        .find_iter(value)
        .filter_map(|capture| capture.as_str().parse::<f64>().ok())
        .map(f64::abs)
        .fold(0.0, f64::max)
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn compact(value: &str, max_chars: usize) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= max_chars {
        normalized
    } else {
        format!(
            "{}…",
            normalized
                .chars()
                .take(max_chars.saturating_sub(1))
                .collect::<String>()
        )
    }
}

#[cfg(test)]
mod tests;
