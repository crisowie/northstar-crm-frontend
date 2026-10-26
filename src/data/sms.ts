import { apiRequest } from "./api";

export type SmsReadiness = {
  configured: boolean;
  status: "ready" | "not_configured";
  message: string;
  missing: string[];
  senderNumber: string | null;
};

export type SmsMessage = {
  id: string;
  contactId: string | null;
  companyId: string | null;
  destination: string;
  senderNumber: string;
  body: string;
  providerMessageId: string | null;
  status: "sending" | "queued" | "sent" | "delivered" | "sending_failed" | "delivery_failed" | "delivery_unconfirmed" | "failed";
  failureReason: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const getSmsConfig = () => apiRequest<SmsReadiness>("/sms/config");
export const getSmsMessages = () => apiRequest<{ messages: SmsMessage[] }>("/sms/messages");
export const sendSmsMessage = (body: { contactId?: string; companyId?: string; text: string; consentConfirmed: true; idempotencyKey: string }) =>
  apiRequest<{ message: SmsMessage; duplicate: boolean }>("/sms/messages", {
    method: "POST",
    body: JSON.stringify(body),
  });
