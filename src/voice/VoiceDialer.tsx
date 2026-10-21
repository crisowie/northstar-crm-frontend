import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { TelnyxRTC } from "@telnyx/webrtc";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import {
  authorizeVoiceCall,
  endVoiceCall,
  getVoiceCall,
  getVoiceCalls,
  getVoiceConfig,
  getVoiceToken,
  revokeVoiceSession,
  saveVoiceOutcome,
  type VoiceCall,
  type VoiceReadiness,
} from "../data/voice";

type Phase = "idle" | "initializing" | "connecting" | "ringing" | "connected" | "ending" | "ended" | "failed";
const outcomeOptions = ["No answer", "Busy", "Voicemail", "Connected — interested", "Connected — follow-up required", "Not interested", "Wrong number", "Other"];
const terminalServerStates = new Set(["ended", "failed", "cancelled"]);

function sdkState(value: unknown): Phase | null {
  const numeric = typeof value === "number" ? value : Number.NaN;
  const state = Number.isInteger(numeric)
    ? ({ 0: "new", 1: "requesting", 2: "trying", 3: "recovering", 4: "ringing", 5: "answering", 6: "early", 7: "active", 8: "held", 9: "hangup", 10: "destroy", 11: "purge" } as Record<number, string>)[numeric]
    : String(value || "").toLowerCase();
  if (["new", "requesting", "trying", "recovering", "answering"].includes(state)) return "connecting";
  if (["ringing", "early"].includes(state)) return "ringing";
  if (["active", "held"].includes(state)) return "connected";
  if (["hangup", "destroy", "purge"].includes(state)) return "ended";
  return null;
}

function normalizePhone(value: string, country: "US" | "GB") {
  try {
    const parsed = parsePhoneNumberFromString(value.trim(), country as CountryCode);
    if (!parsed?.isValid() || (parsed.country !== "US" && parsed.country !== "GB")) return null;
    return { number: parsed.number, country: parsed.country };
  } catch { return null; }
}

function displayTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function callPhaseLabel(phase: Phase) {
  return ({ idle: "Ready", initializing: "Requesting microphone and secure session…", connecting: "Connecting…", ringing: "Ringing…", connected: "Connected", ending: "Ending call…", ended: "Call ended", failed: "Call failed" })[phase];
}

export default function VoiceDialer({ contactId, companyId, contactName, initialPhone = "", initialCountry, showHistory = true, onClose }: {
  contactId?: string; companyId?: string; contactName: string; initialPhone?: string; initialCountry?: "US" | "GB"; showHistory?: boolean; onClose: () => void;
}) {
  const [config, setConfig] = useState<VoiceReadiness | null>(null);
  const [history, setHistory] = useState<VoiceCall[]>([]);
  const [country, setCountry] = useState<"US" | "GB">(initialCountry || (initialPhone.startsWith("+44") ? "GB" : "US"));
  const [phone, setPhone] = useState(initialPhone);
  const [phase, setPhase] = useState<Phase>("idle");
  const [authorizedCallId, setAuthorizedCallId] = useState("");
  const [serverCall, setServerCall] = useState<VoiceCall | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [muted, setMuted] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [savingOutcome, setSavingOutcome] = useState(false);
  const [waitingForProvider, setWaitingForProvider] = useState(false);
  const [selectedCallerId, setSelectedCallerId] = useState("");
  const clientRef = useRef<TelnyxRTC | null>(null);
  const callRef = useRef<ReturnType<TelnyxRTC["newCall"]> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const callIdRef = useRef("");
  const sessionIdRef = useRef("");
  const terminalRef = useRef(false);

  const refreshHistory = useCallback(async () => {
    try { setHistory((await getVoiceCalls(contactId, companyId)).calls); } catch { /* Keep the dialer usable when history is temporarily unavailable. */ }
  }, [contactId, companyId]);

  useEffect(() => {
    let alive = true;
    getVoiceConfig().then((value) => { if (alive) setConfig(value); }).catch((reason: unknown) => {
      if (alive) setError(reason instanceof Error ? reason.message : "Calling configuration could not be loaded.");
    });
    if (showHistory) void refreshHistory();
    return () => { alive = false; };
  }, [refreshHistory, showHistory]);

  const cleanupMedia = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    const client = clientRef.current;
    clientRef.current = null;
    if (client) void client.disconnect().catch(() => undefined);
  }, []);

  const reconcileServerCall = useCallback(async (id: string) => {
    setWaitingForProvider(true);
    setInfo("Waiting for Telnyx to confirm the call result…");
    for (let attempt = 0; attempt < 15; attempt += 1) {
      try {
        const current = (await getVoiceCall(id)).call;
        setServerCall(current);
        if (terminalServerStates.has(current.status)) {
          setWaitingForProvider(false);
          setInfo("");
          await refreshHistory();
          return;
        }
      } catch { /* A later request can still pick up a delayed webhook. */ }
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
    setWaitingForProvider(false);
    setInfo("Telnyx has not confirmed the final status yet. The call history will update when its signed event arrives.");
  }, [refreshHistory]);

  const applySdkState = useCallback((next: Phase | null) => {
    if (!next) return;
    setPhase(next);
    if (next === "ended") {
      terminalRef.current = true;
      cleanupMedia();
      if (callIdRef.current) void reconcileServerCall(callIdRef.current);
    }
  }, [cleanupMedia, reconcileServerCall]);

  const startCall = async () => {
    if (phase !== "idle" || !config?.configured) return;
    setError(""); setInfo(""); setPhase("initializing"); setServerCall(null); setOutcome(""); setNote(""); setFollowUpDate("");
    const normalized = normalizePhone(phone, country);
    if (!normalized) {
      setPhase("idle"); setError("Enter a valid US (+1) or UK (+44) phone number.");
      return;
    }
    setCountry(normalized.country);
    let authCallId = "";
    let browserSessionId = "";
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot access a microphone. Use a current browser over HTTPS or localhost.");
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const session = await getVoiceToken();
      browserSessionId = session.sessionId;
      sessionIdRef.current = session.sessionId;
      const idempotencyKey = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const authorization = await authorizeVoiceCall({ sessionId: session.sessionId, ...(contactId ? { contactId } : {}), ...(companyId ? { companyId } : {}), destination: normalized.number, idempotencyKey });
      authCallId = authorization.id;
      callIdRef.current = authorization.id;
      setAuthorizedCallId(authorization.id);
      setSelectedCallerId(authorization.callerId);

      const client = new TelnyxRTC({ login_token: session.token, enableCallRecording: false, hangupOnBeforeUnload: true });
      clientRef.current = client;
      let readyResolve: (() => void) | undefined;
      let readyReject: ((reason?: Error) => void) | undefined;
      const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
      const onNotification = (notification: { call?: { id?: string; state?: unknown } }) => {
        const eventCall = notification?.call;
        if (!eventCall || (callRef.current?.id && eventCall.id !== callRef.current.id)) return;
        applySdkState(sdkState(eventCall.state));
      };
      const onError = (reason: { message?: string }) => {
        const message = reason?.message || "Telnyx browser calling reported an error.";
        readyReject?.(new Error(message));
        if (callRef.current) {
          setError(message); setPhase("failed"); terminalRef.current = true;
          void endVoiceCall(authorization.id).catch(() => undefined);
          cleanupMedia();
          void reconcileServerCall(authorization.id);
        }
      };
      client.on("telnyx.ready", () => readyResolve?.());
      client.on("telnyx.error", onError);
      client.on("telnyx.notification", onNotification);
      await client.connect();
      await Promise.race([ready, new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("Telnyx did not finish connecting. Check your network and try again.")), 30_000))]);
      setPhase("connecting");
      callRef.current = client.newCall({
        destinationNumber: authorization.destination,
        callerNumber: authorization.callerId,
        audio: true,
        localStream: streamRef.current || undefined,
        remoteElement: audioRef.current || undefined,
        customHeaders: [{ name: "X-Northstar-Call-ID", value: authorization.id }],
      });
      applySdkState(sdkState(callRef.current.state));
    } catch (reason) {
      cleanupMedia();
      if (authCallId) {
        callIdRef.current = authCallId;
        setAuthorizedCallId(authCallId);
        await endVoiceCall(authCallId).catch(() => undefined);
        void reconcileServerCall(authCallId);
      } else if (browserSessionId) await revokeVoiceSession(browserSessionId).catch(() => undefined);
      setPhase("failed"); terminalRef.current = true;
      const message = reason instanceof Error ? reason.message : "Could not start the Telnyx call.";
      setError(/permission|denied|not allowed/i.test(message)
        ? "Microphone access was denied. Allow microphone access for this site in your browser settings, then try again."
        : message);
    }
  };

  const endCall = async () => {
    if (phase === "ending" || terminalRef.current) return;
    setPhase("ending"); setError("");
    const call = callRef.current;
    try { await call?.hangup(); } catch { /* The signed backend event remains the source of final status. */ }
    cleanupMedia();
    if (callIdRef.current) {
      try {
        const result = await endVoiceCall(callIdRef.current);
        setServerCall(result.call);
        if (terminalServerStates.has(result.call.status)) {
          terminalRef.current = true; setPhase(result.call.status === "failed" ? "failed" : "ended");
          await refreshHistory();
        }
      } catch (reason) { setError(reason instanceof Error ? reason.message : "The server could not request call termination."); }
    }
  };

  const toggleMute = () => {
    const call = callRef.current;
    if (!call || phase !== "connected") return;
    if (muted) call.unmuteAudio(); else call.muteAudio();
    setMuted(!muted);
  };

  const submitOutcome = async (event: FormEvent) => {
    event.preventDefault();
    if (!serverCall || !terminalServerStates.has(serverCall.status) || !outcome) return;
    setSavingOutcome(true); setError("");
    try {
      const result = await saveVoiceOutcome(serverCall.id, { outcome, note, followUpDate });
      setServerCall(result.call); setInfo(result.call.contactId ? "Outcome saved to the contact activity timeline." : result.call.companyId ? "Outcome saved to the company activity timeline." : "Outcome saved to call history." );
      await refreshHistory();
      window.dispatchEvent(new Event("northstar:voice-outcome"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the call outcome."); }
    finally { setSavingOutcome(false); }
  };

  useEffect(() => {
    const handlePageExit = () => {
      const current = callRef.current;
      if (callIdRef.current && !terminalRef.current && current) {
        void current.hangup().catch(() => undefined);
        void endVoiceCall(callIdRef.current).catch(() => undefined);
      } else if (!callIdRef.current && sessionIdRef.current && !terminalRef.current) {
        void revokeVoiceSession(sessionIdRef.current).catch(() => undefined);
      }
    };
    window.addEventListener("pagehide", handlePageExit);
    return () => {
      window.removeEventListener("pagehide", handlePageExit);
      const current = callRef.current;
      if (current && !terminalRef.current) void current.hangup().catch(() => undefined);
      if (callIdRef.current && !terminalRef.current) void endVoiceCall(callIdRef.current).catch(() => undefined);
      if (!callIdRef.current && sessionIdRef.current && !terminalRef.current) void revokeVoiceSession(sessionIdRef.current).catch(() => undefined);
      cleanupMedia();
    };
  }, [cleanupMedia]);

  const normalizedPreview = normalizePhone(phone, country);
  const canClose = terminalRef.current || phase === "idle" || phase === "failed";
  const canSaveOutcome = Boolean(serverCall && terminalServerStates.has(serverCall.status));

  return <div className="voice-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget && canClose) onClose(); }}>
    <section className="voice-dialog" role="dialog" aria-modal="true" aria-labelledby="voice-dialog-title">
      <header className="voice-header"><div><span className="modal-kicker">NORTHSTAR CALLING</span><h2 id="voice-dialog-title">Call {contactName}</h2><p>Outbound calls use the Telnyx number assigned by your workspace.</p></div><button type="button" className="icon-button" aria-label="Close dialer" disabled={!canClose} onClick={onClose}>×</button></header>
      <div className="voice-content">
        {config && !config.configured && <div className="voice-not-configured" role="status"><strong>Calling is not configured</strong><span>{config.message}</span>{config.missing.length > 0 && <small>Backend settings still needed: {config.missing.join(", ")}</small>}{config.missing.some((item) => item.startsWith("TELNYX_PHONE_NUMBER")) && <small>Buy an authorized US Telnyx number and add it to the backend before dialing.</small>}</div>}
        {config?.configured && <div className="voice-account-note" role="note">Telnyx account verification, available balance, and destination-country permissions are managed in the Telnyx portal and can still block a call.</div>}
        {!config && !error && <div className="voice-muted">Checking Telnyx configuration…</div>}
        <div className="voice-contact"><span className="voice-contact-avatar">{contactName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?"}</span><div><strong>{contactName}</strong><small>{selectedCallerId ? `Calling from ${selectedCallerId}` : "Caller ID is selected by the server"}</small></div></div>
        <label className="voice-field">Destination number<div className="voice-phone-row"><select aria-label="Default country for phone number" value={country} disabled={phase !== "idle"} onChange={(event) => setCountry(event.target.value as "US" | "GB")}><option value="US">US (+1)</option><option value="GB">UK (+44)</option></select><input aria-label="Phone number to call" value={phone} disabled={phase !== "idle"} onChange={(event) => setPhone(event.target.value)} placeholder={country === "US" ? "+1 415 555 0100" : "+44 20 7946 0958"} autoComplete="tel" /></div></label>
        {phone.trim() && <p className={normalizedPreview ? "voice-validation voice-validation-ok" : "voice-validation"}>{normalizedPreview ? `Will dial ${normalizedPreview.number}` : "Enter a valid US or UK number."}</p>}
        <div className="voice-state-row"><span className={`voice-state-dot voice-state-${phase}`} /><strong>{callPhaseLabel(phase)}</strong>{waitingForProvider && <span className="voice-muted">Server confirmation in progress</span>}</div>
        <div className="voice-controls">
          {phase === "idle" && <button type="button" className="button button-primary" disabled={!config?.configured || !normalizedPreview} onClick={() => void startCall()}>Start call</button>}
          {(["initializing", "connecting", "ringing", "connected", "ending"].includes(phase)) && <>
            {phase === "connected" && <button type="button" className="button button-secondary" onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</button>}
            <button type="button" className="button button-danger" disabled={phase === "ending"} onClick={() => void endCall()}>{phase === "ending" ? "Ending…" : "End call"}</button>
          </>}
          {(phase === "ended" || phase === "failed") && <button type="button" className="button button-secondary" onClick={() => { setPhase("idle"); setError(""); setInfo(""); setServerCall(null); setAuthorizedCallId(""); callIdRef.current = ""; sessionIdRef.current = ""; terminalRef.current = false; void refreshHistory(); }}>Call again</button>}
          <span className="voice-secure-note">Microphone access is requested only when you start a call. Calls are not recorded.</span>
        </div>
        {error && <div className="voice-error" role="alert">{error}</div>}
        {info && <div className="voice-info" role="status">{info}</div>}
        {canSaveOutcome && !serverCall?.outcome && <form className="voice-outcome" onSubmit={(event) => void submitOutcome(event)}>
          <h3>Save call outcome</h3>
          <label className="voice-field">Outcome<select required value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="">Choose an outcome…</option>{outcomeOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="voice-field">Note <span className="voice-optional">Optional</span><textarea rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a note for this contact…" /></label>
          <label className="voice-field">Follow-up date <span className="voice-optional">Optional</span><input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} /></label>
          <button type="submit" className="button button-primary" disabled={!outcome || savingOutcome}>{savingOutcome ? "Saving…" : "Save outcome"}</button>
        </form>}
        {serverCall?.outcome && <div className="voice-info">Outcome saved: {serverCall.outcome}{serverCall.followUpDate ? ` · follow-up ${serverCall.followUpDate}` : ""}</div>}
        {showHistory && <section className="voice-history"><div className="voice-history-heading"><h3>Recent calls</h3><button type="button" className="text-button" onClick={() => void refreshHistory()}>Refresh</button></div>
          {history.length === 0 ? <p className="voice-muted">No calls are logged for this contact yet.</p> : history.slice(0, 6).map((item) => <article className="voice-history-item" key={item.id}><div><strong>{item.destination}</strong><small>{displayTime(item.startedAt)} · {item.durationSeconds === null ? "duration pending" : `${item.durationSeconds}s`}</small>{item.outcome && <small>{item.outcome}{item.followUpDate ? ` · follow-up ${item.followUpDate}` : ""}</small>}{!item.outcome && terminalServerStates.has(item.status) && <button type="button" className="voice-record-outcome" onClick={() => { setServerCall(item); setPhase(item.status === "failed" ? "failed" : "ended"); setOutcome(""); setNote(item.note || ""); setFollowUpDate(item.followUpDate || ""); callIdRef.current = item.id; terminalRef.current = true; }}>Record outcome</button>}</div><span className={`voice-history-status status-${item.status}`}>{item.status}</span></article>)}
        </section>}
      </div>
      <audio ref={audioRef} autoPlay />
    </section>
  </div>;
}
