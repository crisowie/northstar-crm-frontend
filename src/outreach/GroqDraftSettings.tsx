import { useEffect, useState } from "react";
import { getGroqDraftSettings, testGroqDraftSettings, updateGroqDraftSettings } from "../data/outreach";
import type { GroqDraftSettings } from "../types/outreach";

const defaultModel = "openai/gpt-oss-20b";

export default function GroqDraftSettings() {
  const [settings, setSettings] = useState<GroqDraftSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(defaultModel);
  const [clearWorkspaceKey, setClearWorkspaceKey] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void getGroqDraftSettings().then((result) => {
      if (!active) return;
      setSettings(result);
      setModel(result.model || defaultModel);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not load Groq settings.");
    });
    return () => { active = false; };
  }, []);

  const save = async () => {
    setBusy("save"); setError(""); setNotice("");
    try {
      const result = await updateGroqDraftSettings({
        model: model.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(clearWorkspaceKey ? { clearWorkspaceKey: true } : {}),
      });
      setSettings(result);
      setApiKey("");
      setClearWorkspaceKey(false);
      setNotice("Groq drafting settings saved. Test the connection before composing with AI.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not save Groq settings.");
    } finally { setBusy(""); }
  };

  const test = async () => {
    setBusy("test"); setError(""); setNotice("");
    try {
      const result = await testGroqDraftSettings();
      setSettings(result.settings);
      setNotice(`Groq connection verified using ${result.result.model}.`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Groq connection test failed.");
      void getGroqDraftSettings().then(setSettings).catch(() => undefined);
    } finally { setBusy(""); }
  };

  const source = settings?.keySource === "workspace" ? "Encrypted workspace key" : settings?.keySource === "environment" ? "API server environment" : "Not configured";
  return <section className="panel settings-card groq-settings-card">
    <div className="settings-title"><div className="settings-icon">✦</div><div><h2>AI email drafting</h2><p>Generate a draft for review. The CRM never sends AI-generated email automatically.</p></div></div>
    {error && <div className="outreach-message error-message" role="alert">{error}</div>}
    {notice && <div className="outreach-message success-message" role="status">{notice}</div>}
    <div className="groq-settings-status"><span className={"sync-dot " + (settings?.configured ? "sync-saved" : "sync-loading")} /><strong>{settings?.configured ? "Groq is configured" : settings ? "Groq is not configured" : "Loading Groq settings…"}</strong><small>Key source: {source}</small></div>
    <label className="field-label">Groq API key<input className="form-input" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setClearWorkspaceKey(false); }} placeholder={settings?.hasWorkspaceKey ? "Saved key stays hidden; enter a new key to replace it" : "Paste a Groq API key"} /></label>
    <label className="field-label">Chat model<input className="form-input" value={model} onChange={(event) => setModel(event.target.value)} placeholder={defaultModel} /></label>
    <p className="field-help">The API key is sent to the CRM API, encrypted at rest, and never returned to the browser. For Render, a server environment secret is a good default; a workspace key here overrides it. Keep the API encryption key stable.</p>
    <p className="field-help">AI drafting sends the selected contact’s name, job title, country, preferred language, linked company and opportunity details, and your brief to Groq. It does not send contact email, phone, or internal notes.</p>
    <div className="settings-actions groq-settings-actions">
      {settings?.hasWorkspaceKey && <button className="button button-quiet" type="button" disabled={Boolean(busy)} onClick={() => { setClearWorkspaceKey(true); setApiKey(""); }}>Use server environment key</button>}
      <button className="button button-secondary" type="button" disabled={!settings?.configured || Boolean(busy)} onClick={() => void test()}>{busy === "test" ? "Testing…" : "Test connection"}</button>
      <button className="button button-primary" type="button" disabled={Boolean(busy) || !model.trim()} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save AI settings"}</button>
    </div>
  </section>;
}
