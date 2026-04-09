/** Risk level from the sandbox evaluation */
export type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';

/** Decision the user can make */
export type ApprovalDecision = 'allow_once' | 'allow_always' | 'deny';

/** Request to approve a command execution */
export interface CommandApprovalRequest {
  /** Unique ID for this approval request */
  id: string;
  /** Agent session identifier */
  sessionId: string;
  /** Agent turn identifier */
  turnId: string;
  /** Pending tool call identifier */
  toolCallId: string;
  /** Tool name, e.g. "terminal.exec" */
  toolName: string;
  /** Localized label, e.g. "终端执行" */
  toolLabel: string;
  /** The command to execute */
  command: string;
  /** Working directory */
  cwd?: string;
  /** Risk level determined by sandbox */
  riskLevel: RiskLevel;
  /** Human-readable risk description */
  riskDescription: string;
  /** Terminal mode, if applicable */
  mode?: "command" | "shell";
  /** Interactive classification, if available */
  interactiveCategory?: string;
  /** Whether this command has been seen before */
  isRepeat: boolean;
  /** Previous decision if this is a repeat command */
  previousDecision?: ApprovalDecision;
}

/** Response from the approval bar */
export interface CommandApprovalResponse {
  requestId: string;
  decision: ApprovalDecision;
  /** Timestamp when the decision was made */
  timestamp: number;
}

/** State of the approval bar */
export interface CommandApprovalBarState {
  /** Current pending request, null if none */
  pendingRequest: CommandApprovalRequest | null;
  /** Whether the bar is visible */
  isVisible: boolean;
  /** Whether the user has expanded details */
  isExpanded: boolean;
}
