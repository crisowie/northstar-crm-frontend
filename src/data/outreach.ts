import { apiRequest } from "./api";
import type { AiEmailDraft, AiReplyDraft, CalendarIntegrationSettings, CalendarMeeting, EmailProviderId, EmailProviderSettings, EmailSuppression, GmailConnection, GroqDraftSettings, OutreachMessage, OutreachStats, OutreachThread } from "../types/outreach";

export function getGmailConnection() {
  return apiRequest<GmailConnection>("/outreach/gmail/status");
}

export function beginGmailConnection() {
  return apiRequest<{ authorizationUrl: string }>("/outreach/gmail/connect", { method: "POST" });
}

export function disconnectGmail() {
  return apiRequest<{ disconnected: boolean }>("/outreach/gmail/disconnect", { method: "POST" });
}

export function getOutreachMessages() {
  return apiRequest<OutreachMessage[]>("/outreach/messages");
}

export function getOutreachStats() {
  return apiRequest<OutreachStats>("/outreach/stats");
}

export function getOutreachThread(messageId: string) {
  return apiRequest<OutreachThread>(`/outreach/messages/${encodeURIComponent(messageId)}/thread`);
}

export function getCalendarMeetings() {
  return apiRequest<CalendarMeeting[]>("/outreach/calendar/bookings");
}

export function getCalendarIntegrationSettings() {
  return apiRequest<CalendarIntegrationSettings>("/outreach/calendar/settings");
}

export function saveCalendarWebhookSecret(secret: string) {
  return apiRequest<{ configured: boolean }>("/outreach/calendar/settings", {
    method: "PATCH",
    body: JSON.stringify({ secret }),
  });
}

type OutreachSyncResult = { checked: number; replies: number; correlatedReplies?: number };
let replySyncInFlight: Promise<OutreachSyncResult> | null = null;

export function syncOutreachReplies(): Promise<OutreachSyncResult> {
  if (!replySyncInFlight) {
    replySyncInFlight = apiRequest<OutreachSyncResult>("/outreach/sync", { method: "POST" })
      .finally(() => { replySyncInFlight = null; });
  }
  return replySyncInFlight;
}

export function getEmailProviderSettings() {
  return apiRequest<EmailProviderSettings>("/outreach/providers");
}

export function updateEmailProvider(provider: EmailProviderId, configuration: Record<string, unknown>) {
  return apiRequest<EmailProviderSettings>(`/outreach/providers/${provider}`, {
    method: "PATCH",
    body: JSON.stringify(configuration),
  });
}

export function testEmailProvider(provider: EmailProviderId) {
  return apiRequest<{ result: { senderEmail: string; verifiedDomainStatus?: string; sandbox?: boolean }; settings: EmailProviderSettings }>(`/outreach/providers/${provider}/test`, { method: "POST" });
}

export function setDefaultEmailProvider(provider: EmailProviderId) {
  return apiRequest<EmailProviderSettings>("/outreach/providers/default", {
    method: "POST",
    body: JSON.stringify({ provider }),
  });
}

export function setEmailSendingPaused(paused: boolean) {
  return apiRequest<EmailProviderSettings>("/outreach/providers/sending", {
    method: "PATCH",
    body: JSON.stringify({ paused }),
  });
}

export function getEmailSuppressions() {
  return apiRequest<EmailSuppression[]>("/outreach/suppressions");
}

export function removeEmailSuppression(email: string) {
  return apiRequest<{ removed: boolean }>(`/outreach/suppressions/${encodeURIComponent(email)}`, { method: "DELETE" });
}

export function sendOutreachEmail(input: {
  contactId: string;
  opportunityId?: string;
  subject: string;
  body: string;
  senderName: string;
  provider: EmailProviderId;
  idempotencyKey: string;
  recipientOptedIn?: boolean;
}) {
  return apiRequest<OutreachMessage>("/outreach/messages", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function sendOutreachReply(messageId: string, input: { body: string; senderName: string; idempotencyKey: string }) {
  return apiRequest<OutreachMessage>(`/outreach/messages/${encodeURIComponent(messageId)}/reply`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createAiReplyDraft(messageId: string, input: { instructions?: string; senderName: string }) {
  return apiRequest<AiReplyDraft>(`/outreach/messages/${encodeURIComponent(messageId)}/ai-reply`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getGroqDraftSettings() {
  return apiRequest<GroqDraftSettings>("/outreach/ai/settings");
}

export function updateGroqDraftSettings(input: { apiKey?: string; model: string; clearWorkspaceKey?: boolean }) {
  return apiRequest<GroqDraftSettings>("/outreach/ai/settings", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function testGroqDraftSettings() {
  return apiRequest<{ settings: GroqDraftSettings; result: { model: string } }>("/outreach/ai/settings/test", { method: "POST" });
}

export function createAiOutreachDraft(input: {
  contactId: string;
  opportunityId?: string;
  language: string;
  brief?: string;
  senderName: string;
}) {
  return apiRequest<AiEmailDraft>("/outreach/ai/draft", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
