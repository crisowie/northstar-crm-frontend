import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import type { Company, Contact } from "../types";
import { getVoiceCalls, saveVoiceOutcome, type VoiceCall } from "../data/voice";

const VoiceDialer = lazy(() => import("./VoiceDialer"));
const outcomes = ["No answer", "Busy", "Voicemail", "Connected — interested", "Connected — follow-up required", "Not interested", "Wrong number", "Other"];
const terminalStatuses = new Set(["ended", "failed", "cancelled"]);

function normalizePhone(value: string, country: "US" | "GB") {
  try {
    const parsed = parsePhoneNumberFromString(value.trim(), country as CountryCode);
    if (!parsed?.isValid() || (parsed.country !== "US" && parsed.country !== "GB")) return "";
    return parsed.number;
  } catch { return ""; }
}

function contactPhone(phone: string) {
  for (const country of ["US", "GB"] as const) {
    const normalized = normalizePhone(phone, country);
    if (normalized) return normalized;
  }
  return "";
}

function contactName(contact?: Contact) {
  return contact ? `${contact.firstName} ${contact.lastName}`.trim() : "";
}

function companyName(company?: Company) {
  return company?.name || "";
}

function companyPhone(company: Company) {
  const customPhone = Object.entries(company.customFields || {}).find(([key, value]) => /^phone$/i.test(key) && typeof value === "string")?.[1];
  return String((company as Company & { phone?: string }).phone || customPhone || "");
}

type LinkedRecord = { kind: "contact"; id: string; name: string } | { kind: "company"; id: string; name: string };

function formatTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatDuration(value: number | null) {
  if (value === null) return "—";
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export default function CallsPage({ contacts, companies, onOpenRecord }: { contacts: Contact[]; companies: Company[]; onOpenRecord: (kind: "contact" | "company", id: string) => void }) {
  const [country, setCountry] = useState<"US" | "GB">("US");
  const [number, setNumber] = useState("");
  const [recordLink, setRecordLink] = useState("auto");
  const [calls, setCalls] = useState<VoiceCall[]>([]);
  const [loadingCalls, setLoadingCalls] = useState(true);
  const [refreshError, setRefreshError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [dialer, setDialer] = useState<{ phone: string; country: "US" | "GB"; contactId?: string; companyId?: string; contactName: string } | null>(null);
  const [editingCallId, setEditingCallId] = useState("");
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [savingOutcome, setSavingOutcome] = useState(false);
  const [outcomeError, setOutcomeError] = useState("");

  const refreshCalls = useCallback(async () => {
    setLoadingCalls(true);
    setRefreshError("");
    try { setCalls((await getVoiceCalls()).calls); }
    catch (reason) { setRefreshError(reason instanceof Error ? reason.message : "Call history could not be loaded."); }
    finally { setLoadingCalls(false); }
  }, []);

  useEffect(() => {
    void refreshCalls();
    const refreshAfterOutcome = () => { void refreshCalls(); };
    window.addEventListener("northstar:voice-outcome", refreshAfterOutcome);
    return () => window.removeEventListener("northstar:voice-outcome", refreshAfterOutcome);
  }, [refreshCalls]);

  const normalizedNumber = normalizePhone(number, country);
  const matchedContact = useMemo(() => normalizedNumber
    ? contacts.find((contact) => !contact.archived && contact.phone && contactPhone(contact.phone) === normalizedNumber)
    : undefined, [contacts, normalizedNumber]);
  const matchedCompany = useMemo(() => normalizedNumber
    ? companies.find((company) => !company.archived && companyPhone(company) && contactPhone(companyPhone(company)) === normalizedNumber)
    : undefined, [companies, normalizedNumber]);
  const selectedLink = recordLink === "auto"
    ? matchedContact ? `contact:${matchedContact.id}` : matchedCompany ? `company:${matchedCompany.id}` : ""
    : recordLink;
  const linkedContactId = selectedLink.startsWith("contact:") ? selectedLink.slice("contact:".length) : undefined;
  const linkedCompanyId = selectedLink.startsWith("company:") ? selectedLink.slice("company:".length) : undefined;
  const selectedContact = linkedContactId ? contacts.find((contact) => contact.id === linkedContactId) : undefined;
  const selectedCompany = linkedCompanyId ? companies.find((company) => company.id === linkedCompanyId) : undefined;
  const selectedRecordName = contactName(selectedContact) || companyName(selectedCompany);

  const visibleCalls = useMemo(() => {
    const query = search.trim().toLowerCase();
    return calls.filter((call) => {
      const linkedContact = call.contactId ? contacts.find((contact) => contact.id === call.contactId) : undefined;
      const linkedCompany = call.companyId ? companies.find((company) => company.id === call.companyId) : undefined;
      const content = [call.destination, call.callerId, call.status, call.outcome, call.note, contactName(linkedContact), companyName(linkedCompany)].join(" ").toLowerCase();
      return (!query || content.includes(query)) && (statusFilter === "All statuses" || call.status === statusFilter);
    });
  }, [calls, contacts, companies, search, statusFilter]);

  const openDialer = (phone = normalizedNumber, dialCountry = country, link = selectedLink, linkedName = selectedRecordName) => {
    if (!phone) return;
    setDialer({ phone, country: dialCountry, contactId: link.startsWith("contact:") ? link.slice("contact:".length) : undefined, companyId: link.startsWith("company:") ? link.slice("company:".length) : undefined, contactName: linkedName || "New number" });
  };

  const appendDigit = (digit: string) => setNumber((current) => current + digit);
  const callBack = (call: VoiceCall) => {
    const linkedContact = call.contactId ? contacts.find((contact) => contact.id === call.contactId) : undefined;
    const linkedCompany = call.companyId ? companies.find((company) => company.id === call.companyId) : undefined;
    const link = linkedContact ? `contact:${linkedContact.id}` : linkedCompany ? `company:${linkedCompany.id}` : "";
    const linkedName = contactName(linkedContact) || companyName(linkedCompany);
    const dialCountry = call.destination.startsWith("+44") ? "GB" : "US";
    setNumber(call.destination);
    setCountry(dialCountry);
    setRecordLink(link || "");
    openDialer(call.destination, dialCountry, link, linkedName);
  };

  const editOutcome = (call: VoiceCall) => {
    setEditingCallId(call.id);
    setOutcome(call.outcome || "");
    setNote(call.note || "");
    setFollowUpDate(call.followUpDate || "");
    setOutcomeError("");
  };

  const submitOutcome = async (event: FormEvent, callId: string) => {
    event.preventDefault();
    if (!outcome) return;
    setSavingOutcome(true);
    setOutcomeError("");
    try {
      await saveVoiceOutcome(callId, { outcome, note, followUpDate });
      setEditingCallId("");
      window.dispatchEvent(new Event("northstar:voice-outcome"));
    } catch (reason) { setOutcomeError(reason instanceof Error ? reason.message : "Could not save the call outcome."); }
    finally { setSavingOutcome(false); }
  };

  const keyButtons = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0", "⌫"];

  return <div className="calls-page">
    <section className="panel call-dial-panel">
      <div className="calls-panel-heading"><div><span className="calls-kicker">TELNYX VOICE</span><h2>Dial a number</h2><p>Call a US or UK number using your workspace caller ID.</p></div><span className="calls-phone-icon" aria-hidden="true">☎</span></div>
      <div className="call-number-row">
        <label className="sr-only" htmlFor="call-country">Country code</label>
        <select id="call-country" value={country} onChange={(event) => setCountry(event.target.value as "US" | "GB")} aria-label="Default country">
          <option value="US">US +1</option><option value="GB">UK +44</option>
        </select>
        <label className="sr-only" htmlFor="call-number">Phone number</label>
        <input id="call-number" type="tel" inputMode="tel" autoComplete="tel" value={number} onChange={(event) => setNumber(event.target.value)} placeholder={country === "US" ? "(415) 555-0100" : "020 7946 0958"} />
        <button className="call-clear" type="button" aria-label="Clear phone number" onClick={() => setNumber("")}>Clear</button>
      </div>
      <p className={number ? normalizedNumber ? "call-number-hint valid" : "call-number-hint invalid" : "call-number-hint"}>
        {number ? normalizedNumber ? `Ready to call ${normalizedNumber}` : "Enter a valid US or UK phone number." : "Enter a number or use the keypad below."}
      </p>
      <div className="call-keypad" aria-label="Phone keypad">
        {keyButtons.map((key) => <button type="button" key={key} aria-label={key === "⌫" ? "Delete last digit" : key === "+" ? "Add plus sign" : `Add ${key}`} onClick={() => key === "⌫" ? setNumber((current) => current.slice(0, -1)) : appendDigit(key)}>{key}</button>)}
      </div>
      <label className="call-link-label">Link this call to a CRM record <span>Optional</span>
        <select value={recordLink} onChange={(event) => setRecordLink(event.target.value)}>
          <option value="auto">Automatically match by phone{selectedRecordName ? ` · ${selectedRecordName}` : ""}</option>
          <option value="">Leave unlinked</option>
          <optgroup label="Contacts">{contacts.filter((contact) => contact.phone && !contact.archived).map((contact) => <option value={`contact:${contact.id}`} key={`contact:${contact.id}`}>{contactName(contact)} · {contact.phone}</option>)}</optgroup>
          <optgroup label="Companies">{companies.filter((company) => companyPhone(company) && !company.archived).map((company) => <option value={`company:${company.id}`} key={`company:${company.id}`}>{companyName(company)} · {companyPhone(company)}</option>)}</optgroup>
        </select>
      </label>
      {recordLink === "auto" && selectedRecordName && <p className="call-contact-match">Matched to {selectedRecordName}. You can change this above.</p>}
      <button type="button" className="button button-primary call-start-button" disabled={!normalizedNumber} onClick={() => openDialer()}><span aria-hidden="true">☎</span> Continue to call</button>
      <p className="call-microphone-note">Your browser asks for microphone access when you start the call. Calls are not recorded.</p>
    </section>

    <section className="panel call-history-panel">
      <div className="call-history-title"><div><span className="calls-kicker">WORKSPACE</span><h2>Call history</h2><p>Recent calls across your workspace, including numbers not linked to CRM records.</p></div><button type="button" className="button button-secondary" onClick={() => void refreshCalls()} disabled={loadingCalls}>{loadingCalls ? "Refreshing…" : "Refresh"}</button></div>
      <div className="call-history-tools"><div className="table-search"><span aria-hidden="true">⌕</span><input aria-label="Search call history" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, number or outcome…" /></div><select aria-label="Filter calls by status" className="filter-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All statuses</option>{[...new Set(calls.map((call) => call.status))].map((status) => <option key={status}>{status}</option>)}</select><span className="call-history-count">{visibleCalls.length} {visibleCalls.length === 1 ? "call" : "calls"}</span></div>
      {refreshError && <div className="call-history-error" role="alert">{refreshError}</div>}
      <div className="call-history-scroll"><table className="call-history-table"><thead><tr><th>CRM RECORD / NUMBER</th><th>WHEN</th><th>DURATION</th><th>STATUS / OUTCOME</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
        {visibleCalls.map((call) => {
          const linked: LinkedRecord | undefined = call.contactId
            ? contacts.find((contact) => contact.id === call.contactId) && { kind: "contact", id: call.contactId, name: contactName(contacts.find((contact) => contact.id === call.contactId)) }
            : call.companyId ? companies.find((company) => company.id === call.companyId) && { kind: "company", id: call.companyId, name: companyName(companies.find((company) => company.id === call.companyId)) } : undefined;
          const canEditOutcome = terminalStatuses.has(call.status);
          return <FragmentCallRow key={call.id} call={call} linked={linked} canEditOutcome={canEditOutcome} editing={editingCallId === call.id} onOpenRecord={onOpenRecord} onCallBack={() => callBack(call)} onEdit={() => editOutcome(call)} onCancel={() => setEditingCallId("")} onSubmit={(event) => void submitOutcome(event, call.id)} outcome={outcome} setOutcome={setOutcome} note={note} setNote={setNote} followUpDate={followUpDate} setFollowUpDate={setFollowUpDate} saving={savingOutcome} error={editingCallId === call.id ? outcomeError : ""} />;
        })}
      </tbody></table></div>
      {!loadingCalls && visibleCalls.length === 0 && <div className="call-history-empty"><span aria-hidden="true">☎</span><strong>{search || statusFilter !== "All statuses" ? "No matching calls" : "No calls yet"}</strong><p>{search || statusFilter !== "All statuses" ? "Try another search or status filter." : "Calls you make from the dial pad or a contact or company profile will appear here."}</p></div>}
      {loadingCalls && !calls.length && <div className="call-history-loading">Loading call history…</div>}
    </section>

    {dialer && <Suspense fallback={<div className="voice-scrim"><div className="voice-dialog voice-loading">Loading calling tools…</div></div>}><VoiceDialer contactId={dialer.contactId} companyId={dialer.companyId} contactName={dialer.contactName} initialPhone={dialer.phone} initialCountry={dialer.country} showHistory={false} onClose={() => { setDialer(null); void refreshCalls(); }} /></Suspense>}
  </div>;
}

function FragmentCallRow({ call, linked, canEditOutcome, editing, onOpenRecord, onCallBack, onEdit, onCancel, onSubmit, outcome, setOutcome, note, setNote, followUpDate, setFollowUpDate, saving, error }: {
  call: VoiceCall; linked?: LinkedRecord; canEditOutcome: boolean; editing: boolean; onOpenRecord: (kind: "contact" | "company", id: string) => void; onCallBack: () => void; onEdit: () => void; onCancel: () => void; onSubmit: (event: FormEvent) => void;
  outcome: string; setOutcome: (value: string) => void; note: string; setNote: (value: string) => void; followUpDate: string; setFollowUpDate: (value: string) => void; saving: boolean; error: string;
}) {
  return <>
    <tr>
      <td><div className="call-history-contact">{linked ? <button type="button" className="call-contact-link" onClick={() => onOpenRecord(linked.kind, linked.id)}>{linked.name}</button> : <strong>Unlinked number</strong>}<span>{call.destination}</span></div></td>
      <td>{formatTime(call.answeredAt || call.startedAt || call.createdAt)}</td>
      <td>{formatDuration(call.durationSeconds)}</td>
      <td><div className="call-history-status"><span className={`voice-history-status status-${call.status}`}>{call.status}</span>{call.outcome && <small>{call.outcome}</small>}</div></td>
      <td><div className="call-history-actions"><button type="button" className="call-table-action" onClick={onCallBack}>Call back</button>{canEditOutcome && <button type="button" className="call-table-action" onClick={onEdit}>{call.outcome ? "Edit outcome" : "Add outcome"}</button>}</div></td>
    </tr>
    {editing && <tr className="call-outcome-row"><td colSpan={5}><form className="call-outcome-editor" onSubmit={onSubmit}>
      <div className="call-outcome-heading"><strong>{call.outcome ? "Edit call outcome" : "Record call outcome"}</strong><button type="button" aria-label="Close outcome editor" onClick={onCancel}>×</button></div>
      {error && <div className="call-history-error" role="alert">{error}</div>}
      <label>Outcome<select required value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="">Choose an outcome…</option>{outcomes.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Note <span>Optional</span><textarea rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a note about this call…" /></label>
      <label>Follow-up date <span>Optional</span><input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} /></label>
      {linked && <small>This outcome will also appear in {linked.name}’s {linked.kind} timeline.</small>}
      {!linked && followUpDate && <small>This call is unlinked, so the date will be saved in call history without creating a CRM follow-up task.</small>}
      <div className="call-outcome-actions"><button type="button" className="button button-secondary" onClick={onCancel}>Cancel</button><button type="submit" className="button button-primary" disabled={!outcome || saving}>{saving ? "Saving…" : "Save outcome"}</button></div>
    </form></td></tr>}
  </>;
}
