import { useEffect, useMemo, useState } from "react";
import type { Contact, CrmData, Opportunity } from "../types";
import type { EmailProviderId, EmailProviderSettings, GmailConnection, OutreachMessage, OutreachStats } from "../types/outreach";
import {
  beginGmailConnection,
  disconnectGmail,
  getEmailProviderSettings,
  getGmailConnection,
  getOutreachMessages,
  getOutreachStats,
  sendOutreachEmail,
  syncOutreachReplies,
} from "../data/outreach";

type Props = { data: CrmData; senderName: string };

const emptyStats: OutreachStats = { sent: 0, replies: 0, replyRate: 0, clicks: 0, delivered: 0, bounced: 0, opened: 0 };
const starterBody = "Hi {{firstName}},\n\nI’m reaching out about {{opportunity}}. Based on {{company}}’s work, I think we could help with the next step.\n\nWould you be open to a short conversation this week?\n\nBest,\n{{senderName}}";

function interpolate(text: string, contact: Contact | undefined, company: string, opportunity: string, senderName: string) {
  const values: Record<string, string> = {
    firstName: contact?.firstName || "there",
    lastName: contact?.lastName || "",
    fullName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : "there",
    company: company || "your team",
    opportunity: opportunity || "a potential project",
    senderName,
  };
  return text.replace(/\{\{\s*(firstName|lastName|fullName|company|opportunity|senderName)\s*\}\}/g, (_match, key: string) => values[key]);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export default function OutreachPage({ data, senderName }: Props) {
  const [connection, setConnection] = useState<GmailConnection>({ connected: false });
  const [providerSettings, setProviderSettings] = useState<EmailProviderSettings | null>(null);
  const [messages, setMessages] = useState<OutreachMessage[]>([]);
  const [stats, setStats] = useState<OutreachStats>(emptyStats);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const [contactId, setContactId] = useState("");
  const [opportunityId, setOpportunityId] = useState("");
  const [subject, setSubject] = useState("A proposal for {{company}}");
  const [body, setBody] = useState(starterBody);
  const [providerOverride, setProviderOverride] = useState<EmailProviderId | "">("");
  const [recipientOptedIn, setRecipientOptedIn] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => window.crypto.randomUUID());

  const contacts = useMemo(() => data.contacts.filter((contact) => !contact.archived && contact.email), [data.contacts]);
  const contact = contacts.find((item) => item.id === contactId);
  const company = data.companies.find((item) => item.id === contact?.companyId)?.name || "";
  const opportunity = data.opportunities.find((item) => item.id === opportunityId);
  const preview = interpolate(body, contact, company, opportunity?.title || "", senderName);
  const previewSubject = interpolate(subject, contact, company, opportunity?.title || "", senderName);
  const selectedProvider = providerOverride || providerSettings?.defaultProvider || "gmail";
  const selectedProviderStatus = providerSettings?.providers.find((item) => item.provider === selectedProvider);
  const canCompose = Boolean(providerSettings?.providers.some((item) => item.eligibleForSending));

  const refresh = async () => {
    setError("");
    const [nextConnection, nextMessages, nextStats, nextProviders] = await Promise.all([
      getGmailConnection(), getOutreachMessages(), getOutreachStats(), getEmailProviderSettings(),
    ]);
    setConnection(nextConnection);
    setMessages(nextMessages);
    setStats(nextStats);
    setProviderSettings(nextProviders);
  };

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("gmail") === "connected") {
      setNotice("Gmail connected. You can now send personalized outreach.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("gmail") === "error") {
      setError("Gmail could not be connected. Check the API configuration and try again.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    const load = async () => {
      const nextConnection = await getGmailConnection();
      if (nextConnection.connected) await syncOutreachReplies().catch(() => undefined);
      const [nextMessages, nextStats, nextProviders] = await Promise.all([getOutreachMessages(), getOutreachStats(), getEmailProviderSettings()]);
      if (!alive) return;
      setConnection(nextConnection);
      setMessages(nextMessages);
      setStats(nextStats);
      setProviderSettings(nextProviders);
    };
    void load().catch((reason: unknown) => {
      if (alive) setError(reason instanceof Error ? reason.message : "Could not load outreach data.");
    }).finally(() => { if (alive) setLoading(false); });
    const timer = window.setInterval(async () => {
      if (!alive || document.visibilityState !== "visible") return;
      try {
        const status = await getGmailConnection();
        if (status.connected) await syncOutreachReplies();
        const [nextMessages, nextStats, nextProviders] = await Promise.all([getOutreachMessages(), getOutreachStats(), getEmailProviderSettings()]);
        if (alive) { setConnection(status); setMessages(nextMessages); setStats(nextStats); setProviderSettings(nextProviders); }
      } catch { /* The manual sync action displays recoverable mailbox errors. */ }
    }, 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await beginGmailConnection();
      window.location.assign(result.authorizationUrl);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not start Gmail authorization.");
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError("");
    try {
      await disconnectGmail();
      setConnection({ connected: false });
      void getEmailProviderSettings().then(setProviderSettings).catch(() => undefined);
      setNotice("Gmail has been disconnected.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not disconnect Gmail.");
    } finally { setBusy(false); }
  };

  const syncReplies = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await syncOutreachReplies();
      await refresh();
      setNotice(result.replies ? `${result.replies} new repl${result.replies === 1 ? "y" : "ies"} found${result.correlatedReplies ? `, including ${result.correlatedReplies} matched from other providers` : ""}.` : "Gmail is up to date. No new replies.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not check Gmail for replies.");
    } finally { setBusy(false); }
  };

  const openComposer = () => {
    setContactId(contacts[0]?.id || "");
    setOpportunityId("");
    setSubject("A proposal for {{company}}");
    setBody(starterBody);
    setProviderOverride("");
    setRecipientOptedIn(false);
    setIdempotencyKey(window.crypto.randomUUID());
    setShowComposer(true);
  };

  const send = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!contactId || !contact?.email || !subject.trim() || !body.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const sentMessage = await sendOutreachEmail({ contactId, opportunityId: opportunityId || undefined, subject, body, senderName, provider: selectedProvider, idempotencyKey, recipientOptedIn });
      setMessages((current) => [sentMessage, ...current]);
      setStats((current) => ({ ...current, sent: current.sent + 1, replyRate: current.sent + 1 ? Math.round(current.replies / (current.sent + 1) * 1000) / 10 : 0 }));
      setShowComposer(false);
      setNotice(`${selectedProviderStatus?.name || "Email provider"} accepted the message for ${contact.firstName} ${contact.lastName}`.trim());
      void refresh().catch(() => undefined);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "The email could not be sent.");
    } finally { setBusy(false); }
  };

  return <div className="outreach-page">
    <section className="outreach-intro panel">
      <div><span className="outreach-kicker">PERSONALIZED OUTREACH</span><h2>Start a conversation that moves work forward.</h2><p>Send a tailored email, keep the conversation beside the prospect, and see replies and tracked-link clicks in one place.</p></div>
      <div className="gmail-connect-card">
        <span className={"gmail-mark " + (connection.connected ? "connected" : "")}>G</span>
        <div className="gmail-connect-copy"><strong>{connection.connected ? connection.email : "Connect Gmail"}</strong><small>{connection.connected ? "Connected for sending and reply checks" : "Authorize your work mailbox to get started"}</small></div>
        {connection.connected ? <button className="button button-secondary" disabled={busy} onClick={disconnect}>Disconnect</button> : <button className="button button-primary" disabled={busy} onClick={connect}>{busy ? "Connecting…" : "Connect Gmail"}</button>}
      </div>
    </section>

    {error && <div className="outreach-message error-message" role="alert">{error}</div>}
    {notice && <div className="outreach-message success-message" role="status">{notice}</div>}

    <div className="outreach-metrics">
      <Metric label="Emails sent" value={stats.sent} detail="Accepted by a selected provider" />
      <Metric label="Delivery confirmations" value={stats.delivered} detail="Confirmed by SES or Resend" />
      <Metric label="Replies" value={stats.replies} detail="Gmail mailbox replies" />
      <Metric label="Reply rate" value={`${stats.replyRate}%`} detail="Replies divided by sent emails" />
      <Metric label="Link clicks" value={stats.clicks} detail="Clicks through CRM tracked links" />
      <Metric label="Open estimates" value={stats.opened} detail="Image-load events where supported" />
      <Metric label="Bounces" value={stats.bounced} detail="Provider-reported bounced emails" />
    </div>

    <section className="panel outreach-list-panel">
      <div className="outreach-list-heading"><div><h3>Recent outreach</h3><p>Messages, provider events, and engagement linked to contacts</p></div><div className="outreach-list-actions">{connection.connected && <button className="button button-secondary" disabled={busy} onClick={syncReplies}>{busy ? "Checking…" : "Sync replies"}</button>}<button className="button button-primary" disabled={!canCompose} onClick={openComposer}>Compose email</button></div></div>
      {loading ? <div className="outreach-empty">Loading outreach…</div> : messages.length ? <div className="outreach-table-wrap"><table className="outreach-table"><thead><tr><th>RECIPIENT</th><th>SUBJECT</th><th>PROVIDER</th><th>STATUS</th><th>SENT</th><th>CLICKS</th><th /></tr></thead><tbody>{messages.map((message) => <tr key={message.id}><td><strong>{message.recipientName}</strong><small>{message.recipient}</small></td><td><strong>{message.subject}</strong><small>{message.opportunityId ? data.opportunities.find((item) => item.id === message.opportunityId)?.title || "Opportunity" : "Email outreach"}</small></td><td><strong>{message.provider === "ses" ? "Amazon SES" : message.provider === "resend" ? "Resend" : "Gmail"}</strong><small>{message.senderAccount || "Sender not recorded"}</small></td><td><span className={"outreach-status " + message.status}>{message.status === "replied" ? "Replied" : message.status === "failed" ? "Failed" : message.status === "sending" ? "Sending" : message.status === "accepted" ? "Accepted" : message.status === "delivered" ? "Delivered" : message.status === "bounced" ? "Bounced" : message.status === "complained" ? "Complaint" : "Sent"}</span>{message.repliedAt && <small>{formatDate(message.repliedAt)}</small>}</td><td>{message.sentAt ? formatDate(message.sentAt) : "—"}</td><td>{message.clickCount}</td><td>{message.gmailThreadUrl && <a className="outreach-open-link" href={message.gmailThreadUrl} target="_blank" rel="noreferrer">Open thread ↗</a>}</td></tr>)}</tbody></table></div> : <div className="outreach-empty"><span className="outreach-empty-icon">↗</span><strong>{canCompose ? "No outreach sent yet" : "Configure an email provider"}</strong><p>{canCompose ? "Choose a contact and write a short, relevant message to get started." : "Connect Gmail, or activate a verified API provider in Email Providers settings."}</p>{canCompose && <button className="button button-primary" onClick={openComposer}>Compose your first email</button>}</div>}
    </section>

    {showComposer && <div className="outreach-modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setShowComposer(false); }}><section className="outreach-composer" role="dialog" aria-modal="true" aria-labelledby="outreach-compose-title">
      <header><div><span className="outreach-kicker">NEW MESSAGE</span><h2 id="outreach-compose-title">Compose personalized email</h2></div><button className="icon-button" aria-label="Close" disabled={busy} onClick={() => setShowComposer(false)}>×</button></header>
      <form onSubmit={send}>
        <div className="outreach-compose-fields">
          <label>Send through<select value={providerOverride} onChange={(event) => setProviderOverride(event.target.value as EmailProviderId | "")}><option value="">Default · {providerSettings?.providers.find((item) => item.provider === providerSettings.defaultProvider)?.name || "Gmail"}</option>{providerSettings?.providers.filter((item) => item.eligibleForSending).map((item) => <option key={item.provider} value={item.provider}>{item.name}</option>)}</select></label>
          <label>Contact<select required value={contactId} onChange={(event) => setContactId(event.target.value)}><option value="">Choose a contact</option>{contacts.map((item) => <option key={item.id} value={item.id}>{item.firstName} {item.lastName} · {item.email}</option>)}</select></label>
          <label>Related opportunity <span className="optional-label">Optional</span><select value={opportunityId} onChange={(event) => setOpportunityId(event.target.value)}><option value="">No opportunity selected</option>{data.opportunities.filter((item) => !item.archived && (!contact || !contact.companyId || item.companyId === contact.companyId)).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label>Subject<input required value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
          <div className="merge-field-note"><strong>Personalize with fields</strong><span>{"{{firstName}}"} · {"{{company}}"} · {"{{opportunity}}"} · {"{{senderName}}"}</span></div>
          <label>Message<textarea required rows={10} value={body} onChange={(event) => setBody(event.target.value)} /></label>
          {selectedProvider === "resend" && <label className="resend-optin-check"><input type="checkbox" checked={recipientOptedIn} onChange={(event) => setRecipientOptedIn(event.target.checked)} /><span>I confirm this recipient explicitly opted in to receive email from us. Resend cannot be used for unsolicited cold outreach.</span></label>}
          <div className="tracked-link-note">Links are wrapped by the CRM to record clicks. {selectedProvider === "gmail" ? "Replies are synchronized from Gmail metadata; message bodies are not downloaded." : connection.connected ? `Replies sent to ${connection.email} can be matched by sender, recipient, subject, and time headers; this may be ambiguous.` : "Inbox replies require a separately connected Gmail mailbox. This delivery provider does not sync an inbox."}</div>
        </div>
        <aside className="email-preview"><span className="outreach-kicker">PREVIEW</span><div className="preview-recipient">To: {contact ? `${contact.firstName} ${contact.lastName} <${contact.email}>` : "Choose a contact"}</div><h3>{previewSubject || "No subject"}</h3><p>{preview || "Your message preview will appear here."}</p></aside>
        <footer><span>{selectedProviderStatus?.senderEmail ? `Sending from ${selectedProviderStatus.senderEmail} via ${selectedProviderStatus.name}` : `${selectedProviderStatus?.name || "Provider"} needs configuration`}</span><button className="button button-secondary" type="button" disabled={busy} onClick={() => setShowComposer(false)}>Cancel</button><button className="button button-primary" disabled={busy || !selectedProviderStatus?.eligibleForSending || !contact?.email || (selectedProvider === "resend" && !recipientOptedIn)}>{busy ? "Sending…" : "Send email"}</button></footer>
      </form>
    </section></div>}
  </div>;
}

function Metric({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  return <article className="panel outreach-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}
