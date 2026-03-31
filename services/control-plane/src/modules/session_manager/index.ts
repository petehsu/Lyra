export type SessionInfo = {
  readonly id: string;
  readonly createdAtIso: string;
};

export const openSession = (id: string): SessionInfo => ({
  id,
  createdAtIso: new Date().toISOString()
});
