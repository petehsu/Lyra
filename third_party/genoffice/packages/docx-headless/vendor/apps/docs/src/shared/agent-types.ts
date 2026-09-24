/** Tool shapes the vendored docs executor types against. The Electron IPC module is not part of this package. */
export interface AgentToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface AgentToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  inputError?: string
  truncated?: boolean
}

export type CreateDocumentType = 'docx' | 'pdf' | 'md' | 'html'
