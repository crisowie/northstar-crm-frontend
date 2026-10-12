import { useEffect, useMemo, useState } from "react";
import {
  beginGmailConnection,
  disconnectGmail,
  getEmailSuppressions,
  getEmailProviderSettings,
  removeEmailSuppression,
  setEmailSendingPaused,
  setDefaultEmailProvider,
  testEmailProvider,
  updateEmailProvider,
} from "../data/outreach";
import type { EmailProviderId, EmailProviderSettings, EmailProviderStatus, EmailSuppression } from "../types/outreach";

type ProviderForm = { senderEmail: string; region: string; configurationSet: string; accessKeyId: string; secretAccessKey: string; apiKey: string; webhookSecret: string };
const emptyForm: ProviderForm = { senderEmail: "", region: "", configurationSet: "", accessKeyId: "", secretAccessKey: "", apiKey: "", webhookSecret: "" };
const dateLabel = (value: string | null) => value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "No successful operation yet";

export default function EmailProvidersSettings() {
  const [settings, setSettings] = useState<EmailProviderSettings | null>(null);
  const [suppressions, setSuppressions] = useState<EmailSuppression[]>([]);
  const [forms, setForms] = useState<Record<"ses" | "resend", ProviderForm>>({ ses: { ...emptyForm }, resend: { ...emptyForm } });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    const [nextSettings, nextSuppressions] = await Promise.all([getEmailProviderSettings(), getEmailSuppressions()]);
    setSettings(nextSettings);
    setSuppressions(nextSuppressions);
  };
  useEffect(() => {
    let alive = true;
    void Promise.all([getEmailProviderSettings(), getEmailSuppressions()]).then(([value, nextSuppressions]) => { if (alive) { setSettings(value); setSuppressions(nextSuppressions); } }).catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : "Could not load provider settings."); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const providers = settings?.providers || [];
  const get = (id: EmailProviderId) => providers.find((provider) => provider.provider === id);
  const choices = useMemo(() => providers.filter((provider) => provider.eligibleForSending), [providers]);

  const connectGmail = async () => {
    setBusy("gmail"); setError("");
    try { const result = await beginGmailConnection(); window.location.assign(result.authorizationUrl); }
    catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "Could not connect Gmail."); setBusy(""); }
  };

  const disconnect = async () => {
    setBusy("gmail"); setError("");
    try { await disconnectGmail(); await refresh(); setNotice("Gmail has been disconnected. Existing email history is preserved."); }
    catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "Could not disconnect Gmail."); }
    finally { setBusy(""); }
  };

  const runTest = async (id: EmailProviderId) => {
    setBusy(`${id}-test`); setError(""); setNotice("");
    try {
      const result = await testEmailProvider(id);
      setSettings(result.settings);
      setNotice(`${get(id)?.name || id} connection verified for ${result.result.senderEmail}${result.result.verifiedDomainStatus ? ` · sender ${result.result.verifiedDomainStatus}` : ""}${result.result.sandbox ? " · SES sandbox mode" : ""}.`);
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "Provider connection test failed."); await refresh().catch(() => undefined); }
    finally { setBusy(""); }
  };

  const save = async (id: "ses" | "resend") => {
    setBusy(`${id}-save`); setError(""); setNotice("");
    try {
      const current = get(id);
      const result = await updateEmailProvider(id, { ...forms[id], active: current?.active || false });
      setSettings(result);
      setForms((value) => ({ ...value, [id]: { ...value[id], accessKeyId: "", secretAccessKey: "", apiKey: "", webhookSecret: "" } }));
      setNotice(`${current?.name || id} settings saved securely. Test the connection to confirm sender and webhook capabilities.`);
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "Could not save provider settings."); }
    finally { setBusy(""); }
  };

  const toggleActive = async (provider: EmailProviderStatus) => {
    if (provider.provider === "gmail") return;
    setBusy(`${provider.provider}-active`); setError(""); setNotice("");
    try {
      const result = await updateEmailProvider(provider.provider, { active: !provider.active });
      setSettings(result);
      setNotice(`${provider.name} ${provider.active ? "deactivated" : "activated"}.`);
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "Could not update provider status."); }
    finally { setBusy(""); }
  };

  const chooseDefault = async (provider: EmailProviderId) => {
    setBusy("default"); setError(""); setNotice("");
    try { setSettings(await setDefaultEmailProvider(provider)); setNotice(`New messages will use ${get(provider)?.name || provider} by default.`); }
    catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "Could not change the default provider."); }
    finally { setBusy(""); }
  };

  const pauseSending = async (paused: boolean) => {
    setBusy("pause"); setError(""); setNotice("");
    try { setSettings(await setEmailSendingPaused(paused)); setNotice(paused ? "Outbound sending is paused for this workspace." : "Outbound sending is resumed."); }
    catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "Could not change the sending control."); }
    finally { setBusy(""); }
  };

  const removeSuppression = async (item: EmailSuppression) => {
    if (!window.confirm(`Remove the suppression for ${item.email_address}? Only continue if the address was corrected or the recipient has explicitly opted in again.`)) return;
    setBusy(`suppression-${item.email_address}`); setError(""); setNotice("");
    try { await removeEmailSuppression(item.email_address); await refresh(); setNotice(`Suppression removed for ${item.email_address}.`); }
    catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "Could not update the suppression list."); }
    finally { setBusy(""); }
  };

  const updateField = (id: "ses" | "resend", field: keyof ProviderForm, value: string) => {
    setForms((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
  };

  if (loading) return <section className="panel provider-settings"><div className="provider-settings-heading"><div><span className="outreach-kicker">DELIVERY</span><h2>Email providers</h2><p>Load your connected mailboxes and provider capabilities.</p></div></div><div className="provider-loading">Loading provider settings…</div></section>;

  return <section className="panel provider-settings">
    <div className="provider-settings-heading">
      <div><span className="outreach-kicker">DELIVERY</span><h2>Email providers</h2><p>Choose an outbound service and see which events each one can report. Provider changes keep message history intact.</p></div>
      <div className="provider-controls"><label className="provider-default">Default outbound provider<select value={settings?.defaultProvider || "gmail"} onChange={(event) => void chooseDefault(event.target.value as EmailProviderId)} disabled={busy === "default" || !choices.length}><option value="gmail" disabled={!get("gmail")?.eligibleForSending}>Gmail / Google Workspace</option><option value="ses" disabled={!get("ses")?.eligibleForSending}>Amazon SES</option><option value="resend" disabled={!get("resend")?.eligibleForSending}>Resend · opted-in recipients only</option></select></label><button className={settings?.sendingPaused ? "button button-primary" : "button button-secondary"} disabled={Boolean(busy)} onClick={() => void pauseSending(!settings?.sendingPaused)}>{settings?.sendingPaused ? "Resume all sending" : "Pause all sending"}</button></div>
    </div>
    {error && <div className="outreach-message error-message" role="alert">{error}</div>}
    {notice && <div className="outreach-message success-message" role="status">{notice}</div>}
    {!choices.length && <div className="provider-empty-state">Connect Gmail or configure and verify an email provider before sending.</div>}

    <article className="provider-card">
      <ProviderHeader provider={get("gmail")} title="Gmail / Google Workspace" description="Mailbox connection for individual sending and Gmail reply synchronization." />
      <div className="provider-account-row"><span>Sender account</span><strong>{get("gmail")?.senderEmail || "Not connected"}</strong><span>Domain</span><strong>{get("gmail")?.verifiedDomainStatus || "Not connected"}</strong></div>
      <Capabilities capabilities={get("gmail")?.capabilities} />
      <div className="provider-actions">{get("gmail")?.connected ? <button className="button button-secondary" disabled={Boolean(busy)} onClick={() => void disconnect()}>Disconnect mailbox</button> : <button className="button button-primary" disabled={Boolean(busy)} onClick={() => void connectGmail()}>{busy === "gmail" ? "Connecting…" : "Connect Gmail"}</button>}<button className="button button-secondary" disabled={!get("gmail")?.connected || Boolean(busy)} onClick={() => void runTest("gmail")}>{busy === "gmail-test" ? "Checking…" : "Test connection"}</button></div>
      <ProviderFoot provider={get("gmail")} />
    </article>

    <article className="provider-card">
      <ProviderHeader provider={get("ses")} title="Amazon SES" description="API-based delivery with SES configuration-set event publishing." />
      <div className="provider-form-grid">
        <ProviderInput label="Verified sender email" value={forms.ses.senderEmail} placeholder={get("ses")?.senderEmail || "you@yourdomain.com"} onChange={(value) => updateField("ses", "senderEmail", value)} />
        <ProviderInput label="AWS region" value={forms.ses.region} placeholder="us-east-1" onChange={(value) => updateField("ses", "region", value)} />
        <ProviderInput label="Configuration set" value={forms.ses.configurationSet} placeholder="Optional until events are configured" onChange={(value) => updateField("ses", "configurationSet", value)} />
        <ProviderInput label="AWS access key ID" value={forms.ses.accessKeyId} placeholder="Saved credentials stay hidden" secret onChange={(value) => updateField("ses", "accessKeyId", value)} />
        <ProviderInput label="AWS secret access key" value={forms.ses.secretAccessKey} placeholder="Saved credentials stay hidden" secret onChange={(value) => updateField("ses", "secretAccessKey", value)} />
      </div>
      <p className="provider-help">Leave credential fields blank to keep saved values or use environment defaults. SES must be out of sandbox to send to arbitrary recipients.</p>
      <Capabilities capabilities={get("ses")?.capabilities} />
      <div className="provider-webhook"><strong>SES event endpoint</strong><code>{get("ses")?.webhookUrl || "Set PUBLIC_API_URL to display the public endpoint"}</code><small>Point your SES configuration-set SNS event destination to this URL. Enable Delivery, Bounce, Complaint, Reject, Open, and Click events. Test connection to report the verified sender and configured event types.</small></div>
      <div className="provider-actions"><button className="button button-secondary" disabled={Boolean(busy)} onClick={() => void save("ses")}>{busy === "ses-save" ? "Saving…" : "Save SES settings"}</button><button className="button button-secondary" disabled={Boolean(busy)} onClick={() => void runTest("ses")}>{busy === "ses-test" ? "Testing…" : "Test connection"}</button><button className={get("ses")?.active ? "button button-secondary" : "button button-primary"} disabled={Boolean(busy) || (!get("ses")?.active && !get("ses")?.configured)} onClick={() => { const status = get("ses"); if (status) void toggleActive(status); }}>{get("ses")?.active ? "Deactivate" : "Activate"}</button></div>
      <ProviderFoot provider={get("ses")} />
    </article>

    <article className="provider-card">
      <ProviderHeader provider={get("resend")} title="Resend" description="API-based delivery for recipients who explicitly opted in." policy />
      <div className="resend-policy-note"><strong>Opt-in only</strong><span>Resend’s current policy prohibits unsolicited email, including cold outreach. This tool requires explicit opt-in confirmation for every Resend send.</span></div>
      <div className="provider-form-grid">
        <ProviderInput label="Verified sender email" value={forms.resend.senderEmail} placeholder={get("resend")?.senderEmail || "you@yourdomain.com"} onChange={(value) => updateField("resend", "senderEmail", value)} />
        <ProviderInput label="Resend API key" value={forms.resend.apiKey} placeholder="Saved credentials stay hidden" secret onChange={(value) => updateField("resend", "apiKey", value)} />
        <ProviderInput label="Webhook signing secret" value={forms.resend.webhookSecret} placeholder="Saved secret stays hidden" secret onChange={(value) => updateField("resend", "webhookSecret", value)} />
      </div>
      <p className="provider-help">Leave credential fields blank to keep saved values or use environment defaults. Create a webhook in Resend with the endpoint below and subscribe to sent, delivered, bounced, complained, failed, opened, and clicked events.</p>
      <Capabilities capabilities={get("resend")?.capabilities} />
      <div className="provider-webhook"><strong>Resend webhook endpoint</strong><code>{get("resend")?.webhookUrl || "Set PUBLIC_API_URL to display the public endpoint"}</code><small>Copy the webhook signing secret into settings. Webhook signatures use the original request body; event IDs are deduplicated.</small></div>
      <div className="provider-actions"><button className="button button-secondary" disabled={Boolean(busy)} onClick={() => void save("resend")}>{busy === "resend-save" ? "Saving…" : "Save Resend settings"}</button><button className="button button-secondary" disabled={Boolean(busy)} onClick={() => void runTest("resend")}>{busy === "resend-test" ? "Testing…" : "Test connection"}</button><button className={get("resend")?.active ? "button button-secondary" : "button button-primary"} disabled={Boolean(busy) || (!get("resend")?.active && !get("resend")?.configured)} onClick={() => { const status = get("resend"); if (status) void toggleActive(status); }}>{get("resend")?.active ? "Deactivate" : "Activate"}</button></div>
      <ProviderFoot provider={get("resend")} />
    </article>
    <section className="provider-suppressions">
      <div className="provider-suppression-heading"><div><h3>Suppressed addresses</h3><p>Permanent bounces, complaints, and unsubscribes are blocked for every provider.</p></div><strong>{suppressions.length}</strong></div>
      {!suppressions.length ? <div className="provider-empty-state">No addresses are currently suppressed.</div> : <div className="provider-suppression-list">{suppressions.map((item) => <div key={item.email_address}><div><strong>{item.email_address}</strong><small>{item.reason.replace("_", " ")} · {item.provider.toUpperCase()} · {dateLabel(item.created_at)}</small></div><button className="button button-secondary" disabled={Boolean(busy)} onClick={() => void removeSuppression(item)}>Remove suppression</button></div>)}</div>}
    </section>
  </section>;
}

function ProviderHeader({ provider, title, description, policy = false }: { provider?: EmailProviderStatus; title: string; description: string; policy?: boolean }) {
  const state = provider?.eligibleForSending ? "Ready" : provider?.active ? "Needs setup" : provider?.connected || provider?.configured ? "Configured" : "Not connected";
  return <header className="provider-card-heading"><div><span className="provider-state-dot" data-ready={Boolean(provider?.eligibleForSending)} /><div><h3>{title}{policy && <span className="provider-policy-label">OPT-IN ONLY</span>}</h3><p>{description}</p></div></div><span className={"provider-state " + (provider?.eligibleForSending ? "provider-state-ready" : "")}>{state}</span></header>;
}

function Capabilities({ capabilities }: { capabilities?: EmailProviderStatus["capabilities"] }) {
  const rows: Array<[keyof NonNullable<typeof capabilities>, string]> = [
    ["sending", "Send"], ["inboundSynchronization", "Mailbox replies"], ["webhooks", "Webhooks"],
    ["bounceReporting", "Bounces"], ["deliveryEvents", "Delivery"], ["openTracking", "Open estimate"], ["clickTracking", "Clicks"],
  ];
  return <div className="provider-capabilities" aria-label="Provider capabilities">{rows.map(([key, label]) => <span key={key} className={capabilities?.[key] ? "capability-available" : ""}><i>{capabilities?.[key] ? "✓" : "—"}</i>{label}</span>)}</div>;
}

function ProviderInput({ label, value, placeholder, secret = false, onChange }: { label: string; value: string; placeholder: string; secret?: boolean; onChange: (value: string) => void }) {
  return <label className="provider-input">{label}<input type={secret ? "password" : "text"} autoComplete="off" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function ProviderFoot({ provider }: { provider?: EmailProviderStatus }) {
  if (!provider) return null;
  return <footer className="provider-foot"><span>Source: {provider.source === "workspace" ? "encrypted workspace settings" : provider.source === "environment" ? "server environment" : "connected mailbox"}</span><span>Last successful operation: {dateLabel(provider.lastSuccessAt)}</span>{provider.lastError && <span className="provider-last-error">Last error: {provider.lastError}</span>}{provider.warning && <span className="provider-warning">{provider.warning}</span>}</footer>;
}
