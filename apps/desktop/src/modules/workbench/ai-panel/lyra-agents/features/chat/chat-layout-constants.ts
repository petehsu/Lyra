// Layout constants for the virtualized chat list. Values mirror agents.scss tokens.

/** Flex gap between `.lyra-agents-chat-message-slot` siblings (`--lyra-unit-24`). */
export const CHAT_MESSAGE_GAP_PX = 24;

/** `.lyra-agents-chat-inner` vertical padding. */
export const CHAT_INNER_PADDING_TOP_PX = 24;
export const CHAT_INNER_PADDING_BOTTOM_PX = 32;

/** Neutral placeholder until ResizeObserver measures a slot. */
export const CHAT_MESSAGE_FALLBACK_HEIGHT_PX = 80;

/** Extra rows rendered above/below the viewport window. */
export const CHAT_VIRTUAL_OVERSCAN = 3;

/** Canvas font shorthand aligned with rendered agent message body text. */
export const CHAT_PLAIN_TEXT_FONT = '15px "Geist Sans", system-ui, sans-serif';
export const CHAT_PLAIN_TEXT_LINE_HEIGHT_PX = 22;
export const CHAT_PLAIN_TEXT_VERTICAL_PADDING_PX = 48;