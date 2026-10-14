export type EmailProviderId = "gmail" | "ses" | "resend";

export interface GroqDraftSettings {
  configured: boolean;
  keySource: "workspace" | "environment" | "unconfigured";
  hasWorkspaceKey: boolean;
  model: string;
  lastTestedAt: string | null;
  lastError: string | null;
}

export interface AiEmailDraft {
  subject: string;
  body: string;
  model: string;
}

export interface AiReplyDraft {
  body: string;
  model: string;
}

export interface EmailProviderCapabilities {
  sending: boolean;
  inboundSynchronization: boolean;
  webhooks: boolean;
  bounceReporting: boolean;
  deliveryEvents: boolean;
  openTracking: boolean;
  clickTracking: boolean;
}

export interface EmailProviderStatus {
  provider: EmailProviderId;
  name: string;
  connected: boolean;
  configured: boolean;
  active: boolean;
  eligibleForSending: boolean;
  source: "mailbox" | "workspace" | "environment";
  senderEmail: string;
  verifiedDomainStatus: string;
  missingConfiguration: string[];
  capabilities: EmailProviderCapabilities;
  default: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
  warning?: string;
  webhookUrl?: string;
  webhookEvents?: string[];
  sandbox?: boolean;
}

export interface EmailProviderSettings {
  defaultProvider: EmailProviderId;
  providers: EmailProviderStatus[];
  sendingPaused: boolean;
}

export interface EmailSuppression {
  email_address: string;
  reason: "hard_bounce" | "complaint" | "unsubscribe" | "manual";
  provider: EmailProviderId;
  source_event_id?: string | null;
  created_at: string;
}

export interface GmailConnection {
  connected: boolean;
  email?: string;
}

export interface OutreachMessage {
  id: string;
  contactId: string;
  opportunityId?: string;
  recipient: string;
  recipientName: string;
  subject: string;
  body: string;
  status: "sending" | "sent" | "accepted" | "delivered" | "bounced" | "complained" | "replied" | "failed";
  sentAt: string;
  repliedAt?: string;
  clickCount: number;
  gmailThreadUrl?: string;
  providerThreadId?: string;
  provider: EmailProviderId;
  senderAccount?: string;
  providerMessageId?: string;
  capabilities?: EmailProviderCapabilities;
}

export interface OutreachStats {
  sent: number;
  replies: number;
  replyRate: number;
  clicks: number;
  delivered: number;
  bounced: number;
  opened: number;
}

export interface OutreachThreadMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  sentAt: string;
  body: string;
  direction: "sent" | "received";
}

export interface OutreachThread {
  threadId: string | null;
  source: "gmail" | "crm";
  replyTargetId?: string;
  messages: OutreachThreadMessage[];
}

export interface CalendarMeeting {
  id: string;
  contactId?: string;
  title: string;
  attendeeName: string;
  attendeeEmail: string;
  startTime: string;
  endTime: string;
  location?: string;
  status: "booked" | "cancelled" | "rescheduled";
}

export interface CalendarIntegrationSettings {
  configured: boolean;
  webhookUrl: string;
}
