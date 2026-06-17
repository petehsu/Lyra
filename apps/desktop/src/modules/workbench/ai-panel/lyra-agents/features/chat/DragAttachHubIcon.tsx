type DragAttachHubIconProps = {
  readonly size?: number;
  readonly className?: string;
};

export const DragAttachHubIcon = ({
  size = 52,
  className
}: DragAttachHubIconProps) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect
      x="8"
      y="7"
      width="24"
      height="30"
      rx="6"
      className="lyra-ai-panel-drag-attach-hub-back"
    />
    <rect
      x="11"
      y="10"
      width="24"
      height="30"
      rx="6"
      className="lyra-ai-panel-drag-attach-hub-mid"
    />
    <rect
      x="14"
      y="13"
      width="24"
      height="30"
      rx="6"
      className="lyra-ai-panel-drag-attach-hub-front"
    />
    <path
      d="M20 22h12M20 26h8"
      className="lyra-ai-panel-drag-attach-hub-line"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <rect
      x="28"
      y="20"
      width="6"
      height="6"
      rx="1.5"
      className="lyra-ai-panel-drag-attach-hub-thumb"
    />
    <path
      d="M29.5 24.5 31 23l1.5 1.5"
      className="lyra-ai-panel-drag-attach-hub-thumb-mark"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle
      cx="34"
      cy="34"
      r="9"
      className="lyra-ai-panel-drag-attach-hub-badge"
    />
    <path
      d="M34 30.5v7M30.5 34h7"
      className="lyra-ai-panel-drag-attach-hub-plus"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
  </svg>
);