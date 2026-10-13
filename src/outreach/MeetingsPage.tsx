import { useEffect, useState } from "react";
import { getCalendarIntegrationSettings, getCalendarMeetings, saveCalendarWebhookSecret } from "../data/outreach";
import type { CalendarIntegrationSettings, CalendarMeeting } from "../types/outreach";

function formatMeetingTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function CalendarIntegration() {
  const [settings, setSettings] = useState<CalendarIntegrationSettings | null>(null);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void getCalendarIntegrationSettings().then((next) => { if (alive) setSettings(next); }).catch((reason: unknown) => {
      if (alive) setError(reason instanceof Error ? reason.message : "Could not load Cal.com settings.");
    });
    return () => { alive = false; };
  }, []);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await saveCalendarWebhookSecret(secret);
      setSettings((current) => current ? { ...current, configured: true } : current);
      setSecret("");
      setNotice("Cal.com webhook secret saved securely.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not save the Cal.com webhook secret.");
    } finally {
      setBusy(false);
    }
  };

  return <section className="panel calendar-setup-card">
    <div className="section-heading"><div><h3>Cal.com connection</h3><p>Record real bookings, cancellations, and reschedules from your booking link.</p></div><span className={"calendar-connection-badge " + (settings?.configured ? "configured" : "")}>{settings?.configured ? "Webhook configured" : "Setup required"}</span></div>
    {error && <div className="outreach-message error-message" role="alert">{error}</div>}
    {notice && <div className="outreach-message success-message" role="status">{notice}</div>}
    {settings && <div className="calendar-setup-instructions">
      <ol>
        <li>In Cal.com, open <strong>Settings → Developer → Webhooks</strong> and create a webhook.</li>
        <li>Paste this subscriber URL and select <code>BOOKING_CREATED</code>, <code>BOOKING_CANCELLED</code>, and <code>BOOKING_RESCHEDULED</code>.</li>
        <li>Generate a unique secret of at least 32 characters, enter it below, and use the same secret in Cal.com.</li>
      </ol>
      <div className="calendar-webhook-url"><code>{settings.webhookUrl}</code><button type="button" className="button button-secondary" onClick={() => void navigator.clipboard.writeText(settings.webhookUrl).then(() => setNotice("Webhook URL copied.")).catch(() => setError("Could not copy the webhook URL; select and copy it manually."))}>Copy URL</button></div>
      <form className="calendar-secret-form" onSubmit={save}>
        <label className="field-label">Cal.com webhook signing secret<input className="form-input" type="password" minLength={32} value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={settings.configured ? "Enter a new secret to replace the saved one" : "Use the same secret you enter in Cal.com"} autoComplete="new-password" required /></label>
        <button className="button button-primary" disabled={busy || secret.trim().length < 32}>{busy ? "Saving…" : settings.configured ? "Update secret" : "Save secret"}</button>
      </form>
      <p className="field-help">The secret is encrypted in the API database. Booking notifications must reach the public HTTPS API URL for the meeting list to update.</p>
    </div>}
  </section>;
}

export default function MeetingsPage({ contacts }: { contacts: Array<{ id: string; firstName: string; lastName: string; email: string }> }) {
  const [meetings, setMeetings] = useState<CalendarMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const result = await getCalendarMeetings();
        if (alive) { setMeetings(result); setError(""); }
      } catch (reason: unknown) {
        if (alive) setError(reason instanceof Error ? reason.message : "Could not load booked meetings.");
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  const upcoming = meetings.filter((meeting) => meeting.status === "booked" && Date.parse(meeting.startTime) >= Date.now())
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  const history = meetings.filter((meeting) => !upcoming.includes(meeting))
    .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));

  return <div className="meetings-page">
    <div className="meetings-summary"><strong>{upcoming.length}</strong><span>upcoming booked {upcoming.length === 1 ? "meeting" : "meetings"}</span><small>Updated automatically when Cal.com sends a booking event.</small></div>
    <CalendarIntegration />
    {error && <div className="outreach-message error-message" role="alert">{error}</div>}
    <section className="panel calendar-bookings-panel">
      <div className="section-heading"><div><h3>Upcoming meetings</h3><p>Confirmed Cal.com bookings linked to CRM contacts when their email matches.</p></div></div>
      {loading ? <div className="outreach-empty">Loading meetings…</div> : upcoming.length ? <div className="calendar-meeting-list">
        {upcoming.map((meeting) => {
          const contact = contacts.find((item) => item.id === meeting.contactId);
          return <article className="calendar-meeting-row" key={meeting.id}>
            <span className="calendar-meeting-date"><strong>{formatMeetingTime(meeting.startTime)}</strong><small>until {formatMeetingTime(meeting.endTime)}</small></span>
            <span className="calendar-meeting-copy"><strong>{meeting.title}</strong><small>{contact ? `${contact.firstName} ${contact.lastName}`.trim() : meeting.attendeeName || "Guest"} · {meeting.attendeeEmail}</small>{meeting.location && (meeting.location.startsWith("https://") || meeting.location.startsWith("http://") ? <a href={meeting.location} target="_blank" rel="noreferrer">Join meeting ↗</a> : <small>{meeting.location}</small>)}</span>
            <span className="calendar-meeting-status">Booked</span>
          </article>;
        })}
      </div> : <div className="outreach-empty"><strong>No bookings received yet</strong><p>When someone books through your Cal.com link, the booking will appear here after the webhook is configured.</p></div>}
    </section>
    {history.length > 0 && <section className="panel calendar-bookings-panel"><div className="section-heading"><div><h3>Past and changed bookings</h3><p>Cancelled and rescheduled meetings remain in the history.</p></div></div><div className="calendar-meeting-list">{history.map((meeting) => <article className="calendar-meeting-row" key={meeting.id}><span className="calendar-meeting-date"><strong>{formatMeetingTime(meeting.startTime)}</strong></span><span className="calendar-meeting-copy"><strong>{meeting.title}</strong><small>{meeting.attendeeName || "Guest"} · {meeting.attendeeEmail}</small></span><span className={"calendar-meeting-status " + meeting.status}>{meeting.status}</span></article>)}</div></section>}
  </div>;
}
