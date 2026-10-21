import { apiRequest } from "./api";

export type VoiceReadiness = {
  configured: boolean;
  status: "ready" | "not_configured";
  message: string;
  missing: string[];
  callerIds: Partial<Record<"US" | "GB", string>>;
  supportedCountries: Array<"US" | "GB">;
  recordingEnabled: false;
};

export type VoiceCall = {
  id: string;
  contactId: string | null;
  companyId: string | null;
  destination: string;
  callerId: string;
  provider: "telnyx";
  status: "authorized" | "connecting" | "dialing" | "connected" | "ending" | "ended" | "failed" | "cancelled";
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  failureReason: string | null;
  outcome: string | null;
  note: string | null;
  followUpDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VoiceSession = { token: string; sessionId: string; expiresAt: string };
export type VoiceAuthorization = { id: string; destination: string; callerId: string; status: string };

export const getVoiceConfig = () => apiRequest<VoiceReadiness>("/voice/config");
export const getVoiceToken = () => apiRequest<VoiceSession>("/voice/token", { method: "POST" });
export const revokeVoiceSession = (sessionId: string) => apiRequest<{ revoked: boolean }>("/voice/session/end", { method: "POST", body: JSON.stringify({ sessionId }) });
export const authorizeVoiceCall = (body: { sessionId: string; contactId?: string; companyId?: string; destination: string; idempotencyKey: string }) =>
  apiRequest<VoiceAuthorization>("/voice/calls", { method: "POST", body: JSON.stringify(body) });
export const endVoiceCall = (id: string) => apiRequest<{ call: VoiceCall }>(`/voice/calls/${encodeURIComponent(id)}/end`, { method: "POST" });
export const getVoiceCall = (id: string) => apiRequest<{ call: VoiceCall }>(`/voice/calls/${encodeURIComponent(id)}`);
export const saveVoiceOutcome = (id: string, body: { outcome: string; note?: string; followUpDate?: string }) =>
  apiRequest<{ call: VoiceCall }>(`/voice/calls/${encodeURIComponent(id)}/outcome`, { method: "POST", body: JSON.stringify(body) });
export const getVoiceCalls = (contactId?: string, companyId?: string) => {
  const filter = contactId ? `contactId=${encodeURIComponent(contactId)}` : companyId ? `companyId=${encodeURIComponent(companyId)}` : "";
  return apiRequest<{ calls: VoiceCall[] }>(`/voice/calls${filter ? `?${filter}` : ""}`);
};
