import { useEffect, useMemo, useRef, useState } from "react";
import type { Contact, CrmData, Opportunity } from "../types";
import type { EmailProviderId, EmailProviderSettings, GmailConnection, OutreachMessage, OutreachStats, OutreachThread } from "../types/outreach";
import {
  beginGmailConnection,
  createAiReplyDraft,
  createAiOutreachDraft,
  disconnectGmail,
  getEmailProviderSettings,
  getGroqDraftSettings,
  getOutreachMessages,
  getOutreachStats,
  getOutreachThread,
  sendOutreachEmail,
  sendOutreachReply,
  syncOutreachReplies,
} from "../data/outreach";

type Props = { data: CrmData; senderName: string };
type OutreachConversation = { key: string; messages: OutreachMessage[]; latest: OutreachMessage; first: OutreachMessage };

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

function groupOutreachConversations(messages: OutreachMessage[]): OutreachConversation[] {
  const groups = new Map<string, OutreachMessage[]>();
  for (const message of messages) {
    const key = message.contactId || (message.providerThreadId
      ? `${message.provider}:${message.providerThreadId}`
      : message.id);
    const group = groups.get(key) || [];
    group.push(message);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const ordered = rows.slice().sort((a, b) => (a.sentAt || "").localeCompare(b.sentAt || ""));
    return { key, messages: ordered, first: ordered[0], latest: ordered[ordered.length - 1] };
  }).sort((a, b) => (b.latest.sentAt || "").localeCompare(a.latest.sentAt || ""));
}

function cleanConversationBody(value: string) {
  const text = value
    .replace(/<br\s*\/?>|<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code: string) => {
      const point = code[0].toLowerCase() === "x" ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10);
      return Number.isInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    });
  const lines: string[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(?:On .{1,240}\bwrote:\s*|[-_]{2,}\s*Original Message\s*[-_]{2,}|Begin forwarded message:)\s*$/i.test(line) || /^\s*>/.test(line)) break;
    lines.push(line);
  }
  return lines.join("\n").replace(/<([^<>\n]+)>/g, "$1").replace(/[<>]/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

export default function OutreachPage({ data, senderName }: Props) {
  const [connection, setConnection] = useState<GmailConnection | null>(null);
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
  const [selectedThread, setSelectedThread] = useState<OutreachMessage | null>(null);
  const [showAllOutreach, setShowAllOutreach] = useState(false);
  const [outreachSearch, setOutreachSearch] = useState("");
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiBrief, setAiBrief] = useState("");
  const backgroundSyncInFlight = useRef(false);

  const contactedContactIds = useMemo(() => new Set(messages
    .filter((message) => message.status !== "failed" || Boolean(message.sentAt))
    .map((message) => message.contactId)), [messages]);
  const availableContacts = useMemo(
    () => data.contacts.filter((item) => !item.archived && item.email && !contactedContactIds.has(item.id)),
    [data.contacts, contactedContactIds],
  );
  const contact = availableContacts.find((item) => item.id === contactId);
  const company = data.companies.find((item) => item.id === contact?.companyId)?.name || "";
  const opportunity = data.opportunities.find((item) => item.id === opportunityId);
  const preview = interpolate(body, contact, company, opportunity?.title || "", senderName);
  const previewSubject = interpolate(subject, contact, company, opportunity?.title || "", senderName);
  const selectedProvider = providerOverride || providerSettings?.defaultProvider || "gmail";
  const selectedProviderStatus = providerSettings?.providers.find((item) => item.provider === selectedProvider);
  const canCompose = Boolean(providerSettings?.providers.some((item) => item.eligibleForSending));
  const conversations = useMemo(() => groupOutreachConversations(messages), [messages]);
  const allOutreachConversations = conversations.filter(({ messages: threadMessages }) => {
    const search = outreachSearch.trim().toLowerCase();
    return !search || threadMessages.some((message) =>
      [message.recipientName, message.recipient, message.subject, message.status, message.provider]
        .some((value) => (value || "").toLowerCase().includes(search)));
  });
  const renderOutreachTable = (rows: OutreachConversation[]) => <div className="outreach-table-wrap"><table className="outreach-table"><thead><tr><th>RECIPIENT</th><th>CONVERSATION</th><th>PROVIDER</th><th>STATUS</th><th>LAST MESSAGE</th><th>CLICKS</th><th /></tr></thead><tbody>{rows.map(({ key, messages: threadMessages, latest, first }) => {
    const clicks = threadMessages.reduce((total, item) => total + item.clickCount, 0);
    const gmailUrl = threadMessages.find((item) => item.gmailThreadUrl)?.gmailThreadUrl;
    const opportunityTitle = first.opportunityId ? data.opportunities.find((item) => item.id === first.opportunityId)?.title : undefined;
    const status = threadMessages.some((item) => item.status === "replied") ? "replied" : latest.status;
    const repliedAt = threadMessages.map((item) => item.repliedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
    return <tr key={key}><td><strong>{latest.recipientName}</strong><small>{latest.recipient}</small></td><td><button className="outreach-subject-button" onClick={() => setSelectedThread(latest)}>{first.subject || "(No subject)"}</button><small>{threadMessages.length} {threadMessages.length === 1 ? "sent email" : "sent emails"}{opportunityTitle ? ` · ${opportunityTitle}` : " · Open chat"}</small></td><td><strong>{latest.provider === "ses" ? "Amazon SES" : latest.provider === "resend" ? "Resend" : "Gmail"}</strong><small>{latest.senderAccount || "Sender not recorded"}</small></td><td><span className={"outreach-status " + status}>{status === "replied" ? "Replied" : status === "failed" ? "Failed" : status === "sending" ? "Sending" : status === "accepted" ? "Accepted" : status === "delivered" ? "Delivered" : status === "bounced" ? "Bounced" : status === "complained" ? "Complaint" : "Sent"}</span>{repliedAt && <small>{formatDate(repliedAt)}</small>}</td><td>{latest.sentAt ? formatDate(latest.sentAt) : "—"}</td><td>{clicks}</td><td>{gmailUrl && <a className="outreach-open-link" href={gmailUrl} target="_blank" rel="noreferrer">Open in Gmail ↗</a>}</td></tr>;
  })}</tbody></table></div>;

  const applyProviderSettings = (settings: EmailProviderSettings) => {
    const gmail = settings.providers.find((item) => item.provider === "gmail");
    setConnection({ connected: Boolean(gmail?.connected), ...(gmail?.senderEmail ? { email: gmail.senderEmail } : {}) });
    setProviderSettings(settings);
  };

  const refresh = async () => {
    setError("");
    const [nextMessages, nextStats, nextProviders] = await Promise.all([
      getOutreachMessages(), getOutreachStats(), getEmailProviderSettings(),
    ]);
    setMessages(nextMessages);
    setStats(nextStats);
    applyProviderSettings(nextProviders);
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
      const [nextMessages, nextStats, nextProviders] = await Promise.all([
        getOutreachMessages(), getOutreachStats(), getEmailProviderSettings(),
      ]);
      if (!alive) return;
      setMessages(nextMessages);
      setStats(nextStats);
      applyProviderSettings(nextProviders);
      const gmail = nextProviders.providers.find((item) => item.provider === "gmail");
      if (gmail?.connected) {
        backgroundSyncInFlight.current = true;
        void syncOutreachReplies().then(async (result) => {
          if (!alive || (result.replies === 0 && !result.correlatedReplies)) return;
          const [updatedMessages, updatedStats] = await Promise.all([getOutreachMessages(), getOutreachStats()]);
          if (alive) { setMessages(updatedMessages); setStats(updatedStats); }
        }).catch(() => undefined).finally(() => { backgroundSyncInFlight.current = false; });
      }
    };
    void load().catch((reason: unknown) => {
      if (alive) setError(reason instanceof Error ? reason.message : "Could not load outreach data.");
    }).finally(() => { if (alive) setLoading(false); });
    const timer = window.setInterval(async () => {
      if (!alive || document.visibilityState !== "visible" || backgroundSyncInFlight.current) return;
      backgroundSyncInFlight.current = true;
      try {
        const [nextMessages, nextStats, nextProviders] = await Promise.all([
          getOutreachMessages(), getOutreachStats(), getEmailProviderSettings(),
        ]);
        if (!alive) return;
        setMessages(nextMessages);
        setStats(nextStats);
        applyProviderSettings(nextProviders);
        const gmail = nextProviders.providers.find((item) => item.provider === "gmail");
        if (!gmail?.connected) return;
        const result = await syncOutreachReplies();
        if (alive && (result.replies > 0 || (result.correlatedReplies || 0) > 0)) {
          const [updatedMessages, updatedStats] = await Promise.all([getOutreachMessages(), getOutreachStats()]);
          setMessages(updatedMessages);
          setStats(updatedStats);
        }
      } catch { /* The manual sync action displays recoverable mailbox errors. */ }
      finally { backgroundSyncInFlight.current = false; }
    }, 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let alive = true;
    void getGroqDraftSettings().then((settings) => {
      if (alive) setAiConfigured(settings.configured);
    }).catch(() => {
      if (alive) setAiConfigured(false);
    });
    return () => { alive = false; };
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
    setContactId(availableContacts[0]?.id || "");
    setOpportunityId("");
    setSubject("A proposal for {{company}}");
    setBody(starterBody);
    setProviderOverride("");
    setRecipientOptedIn(false);
    setAiBrief("");
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

  const draftWithAi = async () => {
    if (!contactId || !contact) {
      setError("Choose a contact before drafting with AI.");
      return;
    }
    setAiBusy(true);
    setError("");
    setNotice("");
    try {
      const draft = await createAiOutreachDraft({
        contactId,
        opportunityId: opportunityId || undefined,
        language: contact.preferredLanguage || "English",
        brief: aiBrief.trim() || undefined,
        senderName,
      });
      setSubject(draft.subject);
      setBody(draft.body);
      setNotice(`Draft created with ${draft.model}. Review and edit it before sending.`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not generate an AI email draft.");
    } finally {
      setAiBusy(false);
    }
  };

  return <div className="outreach-page">
    {showAllOutreach ? <section className="panel outreach-all-panel">
      <div className="outreach-all-heading">
        <div><span className="outreach-kicker">OUTREACH HISTORY</span><h2>Conversations</h2><p>{conversations.length} conversations · {messages.length} sent emails tracked</p></div>
        <div className="outreach-list-actions">
          <button className="button button-secondary" onClick={() => setShowAllOutreach(false)}>← Recent outreach</button>
          {connection?.connected && <button className="button button-secondary" disabled={busy} onClick={syncReplies}>{busy ? "Checking…" : "Sync replies"}</button>}
          <button className="button button-primary" disabled={!canCompose || loading || !availableContacts.length} onClick={openComposer}>Compose email</button>
        </div>
      </div>
      {error && <div className="outreach-message error-message" role="alert">{error}</div>}
      {notice && <div className="outreach-message success-message" role="status">{notice}</div>}
      <label className="outreach-all-search"><span>Search all outreach</span><input value={outreachSearch} onChange={(event) => setOutreachSearch(event.target.value)} placeholder="Search prospect, email, subject, status or provider" /></label>
      {loading ? <div className="outreach-empty">Loading conversations…</div> : allOutreachConversations.length ? renderOutreachTable(allOutreachConversations) : <div className="outreach-empty"><strong>{messages.length ? "No matching conversations" : "No conversations yet"}</strong><p>{messages.length ? "Try another search." : "Messages sent to prospects will appear here."}</p></div>}
    </section> : <>
    <section className="outreach-intro panel">
      <div><span className="outreach-kicker">PERSONALIZED OUTREACH</span><h2>Start a conversation that moves work forward.</h2><p>Send a tailored email, keep the conversation beside the prospect, and see replies and tracked-link clicks in one place.</p></div>
      <div className="gmail-connect-card">
        <span className={"gmail-mark " + (connection?.connected ? "connected" : "")}>G</span>
        <div className="gmail-connect-copy"><strong>{connection === null ? "Checking Gmail…" : connection.connected ? connection.email : "Connect Gmail"}</strong><small>{connection === null ? "Checking your connected mailbox" : connection.connected ? "Connected for sending and reply checks" : "Authorize your work mailbox to get started"}</small></div>
        {connection?.connected ? <button className="button button-secondary" disabled={busy} onClick={disconnect}>Disconnect</button> : <button className="button button-primary" disabled={busy || connection === null} onClick={connect}>{connection === null ? "Checking…" : busy ? "Connecting…" : "Connect Gmail"}</button>}
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
    <div className="outreach-list-heading"><div><h3>Recent conversations</h3><p>Messages and replies stay together in each conversation</p></div><div className="outreach-list-actions"><button className="button button-secondary" onClick={() => setShowAllOutreach(true)}>View all</button>{connection?.connected && <button className="button button-secondary" disabled={busy} onClick={syncReplies}>{busy ? "Checking…" : "Sync replies"}</button>}<button className="button button-primary" disabled={!canCompose || loading || !availableContacts.length} onClick={openComposer}>Compose email</button></div></div>
      {loading ? <div className="outreach-empty">Loading conversations…</div> : conversations.length ? renderOutreachTable(conversations.slice(0, 8)) : <div className="outreach-empty"><span className="outreach-empty-icon">↗</span><strong>{canCompose ? "No conversations yet" : "Configure an email provider"}</strong><p>{canCompose ? "Choose a contact and write a short, relevant message to get started." : "Connect Gmail, or activate a verified API provider in Email Providers settings."}</p>{canCompose && availableContacts.length > 0 && <button className="button button-primary" onClick={openComposer}>Compose your first email</button>}</div>}
    </section>
    </>}

    {selectedThread && <OutreachThreadDialog message={selectedThread} senderName={senderName} onReplySent={(sentReply) => setMessages((current) => [sentReply, ...current.filter((item) => item.id !== sentReply.id)])} onClose={() => setSelectedThread(null)} />}
    {showComposer && <div className="outreach-modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setShowComposer(false); }}><section className="outreach-composer" role="dialog" aria-modal="true" aria-labelledby="outreach-compose-title">
      <header><div><span className="outreach-kicker">NEW MESSAGE</span><h2 id="outreach-compose-title">Compose personalized email</h2></div><button className="icon-button" aria-label="Close" disabled={busy} onClick={() => setShowComposer(false)}>×</button></header>
      <form onSubmit={send}>
        <div className="outreach-compose-fields">
          <label>Send through<select value={providerOverride} onChange={(event) => setProviderOverride(event.target.value as EmailProviderId | "")}><option value="">Default · {providerSettings?.providers.find((item) => item.provider === providerSettings.defaultProvider)?.name || "Gmail"}</option>{providerSettings?.providers.filter((item) => item.eligibleForSending).map((item) => <option key={item.provider} value={item.provider}>{item.name}</option>)}</select></label>
          <label>New contact (not previously contacted)<select required value={contactId} onChange={(event) => setContactId(event.target.value)}><option value="">Choose a new contact</option>{availableContacts.map((item) => <option key={item.id} value={item.id}>{item.firstName} {item.lastName} · {item.email}</option>)}</select>{!availableContacts.length && <small className="field-help">All eligible contacts already have an outreach conversation. Continue existing chats from Recent conversations.</small>}</label>
          <label>Related opportunity <span className="optional-label">Optional</span><select value={opportunityId} onChange={(event) => setOpportunityId(event.target.value)}><option value="">No opportunity selected</option>{data.opportunities.filter((item) => !item.archived && (!contact || !contact.companyId || item.companyId === contact.companyId)).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label>Subject<input required value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
          <div className="merge-field-note"><strong>Personalize with fields</strong><span>{"{{firstName}}"} · {"{{company}}"} · {"{{opportunity}}"} · {"{{senderName}}"}</span></div>
          <label>Instructions for AI <span className="optional-label">Optional</span><textarea rows={2} value={aiBrief} onChange={(event) => setAiBrief(event.target.value)} placeholder="What should this email focus on?" /></label>
          <div className="ai-draft-actions"><button className="button button-secondary" type="button" disabled={!aiConfigured || aiBusy || busy || !contact} onClick={() => void draftWithAi()}>{aiBusy ? "Drafting…" : "Draft with AI"}</button>{!aiConfigured && <small>Set up Groq in Settings → AI email drafting.</small>}</div>
          <label>Message<textarea required rows={10} value={body} onChange={(event) => setBody(event.target.value)} /></label>
          {selectedProvider === "resend" && <label className="resend-optin-check"><input type="checkbox" checked={recipientOptedIn} onChange={(event) => setRecipientOptedIn(event.target.checked)} /><span>I confirm this recipient explicitly opted in to receive email from us. Resend cannot be used for unsolicited cold outreach.</span></label>}
          <div className="tracked-link-note">Links are wrapped by the CRM to record clicks. {selectedProvider === "gmail" ? "Reply sync reads Gmail metadata; full message content is fetched only when you open a conversation." : connection?.connected ? `Replies sent to ${connection.email} can be matched by sender, recipient, subject, and time headers; this may be ambiguous.` : "Inbox replies require a separately connected Gmail mailbox. This delivery provider does not sync an inbox."}</div>
        </div>
        <aside className="email-preview"><span className="outreach-kicker">PREVIEW</span><div className="preview-recipient">To: {contact ? `${contact.firstName} ${contact.lastName} <${contact.email}>` : "Choose a contact"}</div><h3>{previewSubject || "No subject"}</h3><p>{preview || "Your message preview will appear here."}</p></aside>
        <footer><span>{selectedProviderStatus?.senderEmail ? `Sending from ${selectedProviderStatus.senderEmail} via ${selectedProviderStatus.name}` : `${selectedProviderStatus?.name || "Provider"} needs configuration`}</span><button className="button button-secondary" type="button" disabled={busy} onClick={() => setShowComposer(false)}>Cancel</button><button className="button button-primary" disabled={busy || !selectedProviderStatus?.eligibleForSending || !contact?.email || (selectedProvider === "resend" && !recipientOptedIn)}>{busy ? "Sending…" : "Send email"}</button></footer>
      </form>
    </section></div>}
  </div>;
}

export function OutreachThreadDialog({ message, senderName = "", onReplySent, onClose }: { message: OutreachMessage; senderName?: string; onReplySent?: (message: OutreachMessage) => void; onClose: () => void }) {
  const [thread, setThread] = useState<OutreachThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [aiReplyBusy, setAiReplyBusy] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  useEffect(() => {
    let alive = true;
    void getOutreachThread(message.id).then((result) => {
      if (alive) setThread(result);
    }).catch((reason: unknown) => {
      if (alive) setError(reason instanceof Error ? reason.message : "Could not load this conversation.");
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [message.id]);
  useEffect(() => {
    let alive = true;
    void getGroqDraftSettings().then((settings) => {
      if (alive) setAiConfigured(settings.configured);
    }).catch((reason: unknown) => {
      if (alive) setError(reason instanceof Error ? reason.message : "Could not check AI reply settings.");
    });
    return () => { alive = false; };
  }, []);

  const orderedMessages = thread?.messages.slice().sort((a, b) => {
    const aTime = Date.parse(a.sentAt);
    const bTime = Date.parse(b.sentAt);
    return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
  }) || [];
  const canReply = ["sent", "accepted", "delivered", "replied"].includes(message.status);

  const draftReplyWithAi = async () => {
    if (aiReplyBusy || sendingReply || !aiConfigured) return;
    setAiReplyBusy(true);
    setError("");
    try {
      const draft = await createAiReplyDraft(message.id, { senderName });
      setReplyBody(draft.body);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not draft an AI reply.");
    } finally {
      setAiReplyBusy(false);
    }
  };

  const submitReply = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = replyBody.trim();
    if (!body || sendingReply) return;
    setSendingReply(true);
    setError("");
    try {
      const sent = await sendOutreachReply(thread?.replyTargetId || message.id, {
        body,
        senderName,
        idempotencyKey: window.crypto.randomUUID(),
      });
      const newThreadMessage = {
        id: sent.providerMessageId || sent.id,
        from: sent.senderAccount || "",
        to: sent.recipient,
        subject: sent.subject,
        sentAt: sent.sentAt,
        body: sent.body,
        direction: "sent" as const,
      };
      setThread((current) => current ? { ...current, messages: [...current.messages, newThreadMessage] } : current);
      setReplyBody("");
      onReplySent?.(sent);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not send your reply.");
    } finally {
      setSendingReply(false);
    }
  };

  return <div className="outreach-modal-scrim thread-modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="outreach-thread-dialog" role="dialog" aria-modal="true" aria-labelledby="outreach-thread-title">
      <header><h2 id="outreach-thread-title">{message.subject || "Conversation"}</h2><button className="icon-button" aria-label="Close conversation" onClick={onClose}>×</button></header>
      {loading && <div className="outreach-empty">Loading conversation…</div>}
      {error && <div className="outreach-message error-message" role="alert">{error}</div>}
      {!loading && thread && <div className="outreach-thread-messages">
        {orderedMessages.map((item) => <article className={"outreach-thread-message " + item.direction} key={item.id}>
          <div className="outreach-thread-bubble"><span>{cleanConversationBody(item.body) || " "}</span><time>{item.sentAt ? formatDate(item.sentAt) : ""}</time></div>
        </article>)}
      </div>}
      {canReply && <form className="outreach-thread-reply" onSubmit={submitReply}>
        <button className="button button-secondary outreach-ai-reply" type="button" disabled={loading || sendingReply || aiReplyBusy || !aiConfigured} onClick={() => void draftReplyWithAi()}>{aiReplyBusy ? "Drafting…" : "✦ AI"}</button>
        <textarea value={replyBody} onChange={(event) => setReplyBody(event.target.value)} rows={2} maxLength={40000} placeholder={`Reply to ${message.recipientName || message.recipient}…`} aria-label="Write a reply" disabled={sendingReply} />
        <button className="button button-primary" type="submit" disabled={sendingReply || !replyBody.trim()}>{sendingReply ? "Sending…" : "Send"}</button>
      </form>}
      {!aiConfigured && canReply && <small className="outreach-ai-hint">Configure Groq in Settings → AI email drafting to draft chat replies.</small>}
    </section>
  </div>;
}

export function OutreachConversationsDialog({ title, messages, senderName = "", onClose }: { title: string; messages: OutreachMessage[]; senderName?: string; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<OutreachMessage | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const conversations = groupOutreachConversations(messages);
  const visibleConversations = conversations.filter(({ messages: threadMessages }) =>
    !normalizedQuery || threadMessages.some((message) =>
      [message.subject, message.recipientName, message.recipient].some((value) => (value || "").toLowerCase().includes(normalizedQuery))));

  return <>
    <div className="outreach-modal-scrim conversation-hub-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="outreach-conversation-hub" role="dialog" aria-modal="true" aria-labelledby="outreach-conversation-hub-title">
        <header><div><span className="outreach-kicker">EMAIL HISTORY</span><h2 id="outreach-conversation-hub-title">Conversations with {title}</h2><p>{conversations.length} {conversations.length === 1 ? "conversation" : "conversations"} · {messages.length} messages</p></div><button className="icon-button" aria-label="Close all conversations" onClick={onClose}>×</button></header>
        <label className="conversation-hub-search"><span>Search conversations</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subject or recipient" /></label>
        <div className="conversation-hub-list">
          {visibleConversations.map(({ key, messages: threadMessages, latest, first }) => <button className="conversation-hub-row" key={key} onClick={() => setSelectedMessage(latest)}>
            <span className="conversation-hub-copy"><strong>{first.subject || "(No subject)"}</strong><small>{threadMessages.length} {threadMessages.length === 1 ? "sent email" : "sent emails"} · {latest.recipientName} · {latest.recipient}</small></span>
            <span className="conversation-hub-meta"><strong className={"outreach-status " + latest.status}>{latest.status}</strong><small>{latest.sentAt ? formatDate(latest.sentAt) : "Date unavailable"}</small></span>
          </button>)}
          {!visibleConversations.length && <div className="outreach-empty"><strong>{conversations.length ? "No matching conversations" : "No emails yet"}</strong><p>{conversations.length ? "Try another search." : "Emails sent to this record will appear here."}</p></div>}
        </div>
        <footer><button className="button button-primary" onClick={onClose}>Done</button></footer>
      </section>
    </div>
    {selectedMessage && <OutreachThreadDialog message={selectedMessage} senderName={senderName} onClose={() => setSelectedMessage(null)} />}
  </>;
}

function Metric({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  return <article className="panel outreach-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}
