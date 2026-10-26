import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import type { Company, Contact } from "../types";
import { getSmsConfig, getSmsMessages, sendSmsMessage, type SmsMessage, type SmsReadiness } from "../data/sms";

const maxCharacters = 1600;

function normalizeNumber(value: string) {
  for (const country of ["US", "GB"] as const) {
    try {
      const parsed = parsePhoneNumberFromString(value.trim(), country as CountryCode);
      if (parsed?.isValid() && !parsed.ext && (parsed.country === "US" || parsed.country === "GB")) return parsed.number;
    } catch {
      return "";
    }
  }
  return "";
}

function contactName(contact?: Contact) {
  return contact ? `${contact.firstName} ${contact.lastName}`.trim() : "Unknown contact";
}

function companyName(company?: Company) {
  return company?.name || "Unknown company";
}

function companyPhone(company: Company) {
  return String((company as Company & { phone?: string }).phone || Object.entries(company.customFields || {}).find(([key, value]) => /^phone$/i.test(key) && typeof value === "string")?.[1] || "");
}

type SmsTarget = { kind: "contact" | "company"; id: string };

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusLabel(status: SmsMessage["status"]) {
  if (status === "failed") return "Failed";
  return status.replaceAll("_", " ");
}

export default function SmsPage({ contacts, companies, initialTarget, onOpenRecord }: {
  contacts: Contact[];
  companies: Company[];
  initialTarget: SmsTarget | null;
  onOpenRecord: (kind: "contact" | "company", id: string) => void;
}) {
  const [config, setConfig] = useState<SmsReadiness | null>(null);
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [target, setTarget] = useState<SmsTarget | null>(initialTarget);
  const [text, setText] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => window.crypto.randomUUID());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [sendError, setSendError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");

  const activeContacts = useMemo(() => contacts.filter((contact) => !contact.archived), [contacts]);
  const activeCompanies = useMemo(() => companies.filter((company) => !company.archived), [companies]);
  const selectedContact = target?.kind === "contact" ? activeContacts.find((contact) => contact.id === target.id) : undefined;
  const selectedCompany = target?.kind === "company" ? activeCompanies.find((company) => company.id === target.id) : undefined;
  const selectedName = contactName(selectedContact) !== "Unknown contact" ? contactName(selectedContact) : companyName(selectedCompany);
  const selectedNumber = selectedContact ? normalizeNumber(selectedContact.phone) : selectedCompany ? normalizeNumber(companyPhone(selectedCompany)) : "";

  useEffect(() => {
    if (initialTarget) setTarget(initialTarget);
  }, [initialTarget]);

  const refresh = useCallback(async () => {
    setLoadError("");
    try {
      const [readiness, result] = await Promise.all([getSmsConfig(), getSmsMessages()]);
      setConfig(readiness);
      setMessages(result.messages);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "SMS configuration and history could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const visibleMessages = useMemo(() => {
    const query = search.trim().toLowerCase();
    return messages.filter((message) => {
      const contact = message.contactId ? contacts.find((item) => item.id === message.contactId) : undefined;
      const company = message.companyId ? companies.find((item) => item.id === message.companyId) : undefined;
      return !query || [contactName(contact), companyName(company), message.destination, message.body, message.status]
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [companies, contacts, messages, search]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if ((!selectedContact && !selectedCompany) || !selectedNumber || !text.trim() || !consentConfirmed || sending || !config?.configured) return;
    setSending(true);
    setSendError("");
    setNotice("");
    try {
      const result = await sendSmsMessage({
        ...(selectedContact ? { contactId: selectedContact.id } : selectedCompany ? { companyId: selectedCompany.id } : {}),
        text,
        consentConfirmed: true,
        idempotencyKey,
      });
      setMessages((current) => [result.message, ...current.filter((message) => message.id !== result.message.id)]);
      setText("");
      setConsentConfirmed(false);
      setIdempotencyKey(window.crypto.randomUUID());
      setNotice(result.duplicate
        ? "This send request was already processed; no second message was sent."
        : "SMS accepted by Telnyx and added to message history.");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "The SMS could not be sent.");
      await refresh();
    } finally {
      setSending(false);
    }
  };

  const retry = (message: SmsMessage) => {
    if (message.contactId) setTarget({ kind: "contact", id: message.contactId });
    else if (message.companyId) setTarget({ kind: "company", id: message.companyId });
    setText(message.body);
    setConsentConfirmed(false);
    setIdempotencyKey(window.crypto.randomUUID());
    setSendError("");
    setNotice("Review the failed message, confirm current consent, and send it as a new request.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return <div className="sms-page">
    <section className="panel sms-compose-panel">
      <div className="sms-panel-heading">
        <div><span className="calls-kicker">TELNYX SMS</span><h2>Send a text</h2><p>Send one message to a contact or company in your CRM.</p></div>
        <span className="sms-heading-icon" aria-hidden="true">SMS</span>
      </div>

      {!config && !loadError && <div className="call-history-loading">Checking SMS configuration…</div>}
      {config && !config.configured && <div className="sms-config-warning" role="status">
        <strong>SMS is not configured</strong>
        <p>{config.message}</p>
        {config.missing.length > 0 && <small>Missing or invalid: {config.missing.join(", ")}</small>}
      </div>}
      {config?.configured && <div className="sms-sender"><span>Sending from</span><strong>{config.senderNumber}</strong></div>}
      {loadError && <div className="call-history-error" role="alert">{loadError}</div>}
      {sendError && <div className="call-history-error" role="alert">{sendError}</div>}
      {notice && <div className="sms-notice" role="status">{notice}</div>}

      <form className="sms-compose-form" onSubmit={(event) => void submit(event)}>
        <label className="field-label" htmlFor="sms-record">Contact or company
          <select id="sms-record" className="form-input" value={target ? `${target.kind}:${target.id}` : ""} onChange={(event) => {
            const [kind, ...idParts] = event.target.value.split(":");
            const id = idParts.join(":");
            setTarget((kind === "contact" || kind === "company") && id ? { kind, id } : null);
            setSendError("");
            setNotice("");
          }}>
            <option value="">Select a contact or company</option>
            <optgroup label="Contacts">
              {activeContacts.map((contact) => <option key={contact.id} value={`contact:${contact.id}`}>{contactName(contact)} · {normalizeNumber(contact.phone) || "Invalid US/UK number"}</option>)}
            </optgroup>
            <optgroup label="Companies">
              {activeCompanies.map((company) => <option key={company.id} value={`company:${company.id}`}>{companyName(company)} · {normalizeNumber(companyPhone(company)) || "Invalid US/UK number"}</option>)}
            </optgroup>
          </select>
        </label>
        {target && selectedName !== "Unknown contact" && selectedName !== "Unknown company" && <div className="sms-recipient-preview"><span>{target.kind === "contact" ? "Contact" : "Company"} · {selectedName}</span><strong>{selectedNumber || "Invalid US/UK number"}</strong><button type="button" onClick={() => onOpenRecord(target.kind, target.id)}>View record</button></div>}
        <label className="field-label" htmlFor="sms-body">Message
          <textarea id="sms-body" className="form-input sms-body-input" value={text} maxLength={maxCharacters} onChange={(event) => { setText(event.target.value); setSendError(""); setNotice(""); }} placeholder="Write your message…" />
        </label>
        <div className="sms-composer-footer"><span>{text.length} / {maxCharacters} characters</span><span>Long messages may be split into multiple SMS segments.</span></div>
        <label className="sms-consent-check"><input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} /><span>I confirm this contact has explicitly consented to receive SMS messages.</span></label>
        <p className="sms-compliance-note">Send only relevant, expected messages. Follow applicable messaging laws and include your organization identity and opt-out instructions where required. This page sends outbound messages only; it does not record consent or sync inbound STOP replies.</p>
        <button className="button button-primary sms-send-button" type="submit" disabled={!config?.configured || (!selectedContact && !selectedCompany) || !selectedNumber || !text.trim() || !consentConfirmed || sending}>
          {sending ? "Sending…" : "Send SMS"}
        </button>
      </form>
    </section>

    <section className="panel sms-history-panel">
      <div className="call-history-title"><div><span className="calls-kicker">WORKSPACE</span><h2>SMS history</h2><p>Recent outbound messages and Telnyx acceptance status.</p></div><button type="button" className="button button-secondary" onClick={() => { setLoading(true); void refresh(); }} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div>
      <div className="call-history-tools"><div className="table-search"><span aria-hidden="true">⌕</span><input aria-label="Search SMS history" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search contact, number or message…" /></div><span className="call-history-count">{visibleMessages.length} {visibleMessages.length === 1 ? "message" : "messages"}</span></div>
      <div className="sms-history-list">
        {visibleMessages.map((message) => {
          const contact = message.contactId ? contacts.find((item) => item.id === message.contactId) : undefined;
          const company = message.companyId ? companies.find((item) => item.id === message.companyId) : undefined;
          const recordTarget = message.contactId
            ? { kind: "contact" as const, id: message.contactId }
            : message.companyId ? { kind: "company" as const, id: message.companyId } : null;
          return <article className="sms-history-row" key={message.id}>
            <div className="sms-history-contact"><strong>{contact ? contactName(contact) : companyName(company)}</strong><span>{message.destination}</span></div>
            <p>{message.body}</p>
            <div className="sms-history-meta"><span className={`sms-status status-${message.status}`}>{statusLabel(message.status)}</span><time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time></div>
            {message.failureReason && <p className="sms-failure-reason">{message.failureReason}</p>}
            <div className="sms-history-actions">
              {recordTarget && <button type="button" onClick={() => onOpenRecord(recordTarget.kind, recordTarget.id)}>View record</button>}
              {message.status === "failed" && <button type="button" onClick={() => retry(message)}>Review & retry</button>}
            </div>
          </article>;
        })}
        {!loading && visibleMessages.length === 0 && <div className="call-history-empty"><span aria-hidden="true">SMS</span><strong>{search ? "No matching messages" : "No SMS yet"}</strong><p>{search ? "Try another search." : "Messages sent from this page will appear here."}</p></div>}
        {loading && messages.length === 0 && <div className="call-history-loading">Loading SMS history…</div>}
      </div>
    </section>
  </div>;
}
