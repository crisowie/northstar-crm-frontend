import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import App from "../App";
import { isMockAuthEnabled, isSupabaseConfigured, mockSessionStorageKey, supabase } from "../data/api";
import "../styles.css";

export default function AuthGate() {
  const [session, setSession] = useState<Session | null>(null);
  const [demoSession, setDemoSession] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (isMockAuthEnabled) {
      setDemoSession(window.sessionStorage.getItem(mockSessionStorageKey) === "active");
      setCheckingSession(false);
      return;
    }
    if (!supabase) {
      setCheckingSession(false);
      return;
    }
    let alive = true;
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (alive) setSession(nextSession);
    });
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!alive) return;
      if (sessionError) setError(sessionError.message);
      setSession(data.session);
      setCheckingSession(false);
    }).catch((sessionError: unknown) => {
      if (!alive) return;
      setError(sessionError instanceof Error ? sessionError.message : "Could not check your session.");
      setCheckingSession(false);
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) setError(signInError.message);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Could not sign in. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const signOut = async () => {
    setError("");
    if (isMockAuthEnabled) {
      window.sessionStorage.removeItem(mockSessionStorageKey);
      setDemoSession(false);
      setPassword("");
      setNotice("You have left the demo workspace.");
      return;
    }
    if (!supabase) return;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError(signOutError.message);
    else {
      setSession(null);
      setPassword("");
      setNotice("You have signed out.");
    }
  };

  const enterDemo = () => {
    window.sessionStorage.setItem(mockSessionStorageKey, "active");
    setDemoSession(true);
    setError("");
    setNotice("");
  };

  if (checkingSession) {
    return <div className="auth-loading"><span className="auth-spinner" /><span>Checking your session…</span></div>;
  }

  if (demoSession) {
    return <App userName="Demo User" userEmail="demo@northstar.local" onSignOut={signOut} />;
  }

  if (session?.user) {
    const metadataName = session.user.user_metadata?.full_name || session.user.user_metadata?.name;
    const name = typeof metadataName === "string" && metadataName.trim()
      ? metadataName.trim()
      : session.user.email?.split("@")[0] || "Workspace member";
    return <App userName={name} userEmail={session.user.email || ""} onSignOut={signOut} />;
  }

  return <main className="auth-shell">
    <section className="auth-visual">
      <div className="auth-visual-top"><div className="brand"><div className="brand-mark"><span className="brand-star">✦</span></div><span className="brand-name">northstar<span>CRM</span></span></div><span className="auth-private"><span />Private workspace</span></div>
      <div className="auth-visual-content">
        <span className="auth-kicker">RELATIONSHIPS, IN MOTION</span>
        <h1>A clearer view of<br />the work ahead.</h1>
        <p>Keep your people, projects, and opportunities moving forward—all in one calm workspace.</p>
        <div className="auth-preview">
          <div className="preview-top"><span><i /> Your pipeline</span><small>This month</small></div>
          <div className="preview-pipeline"><span style={{ height: "37%" }} /><span style={{ height: "61%" }} /><span style={{ height: "76%" }} /><span style={{ height: "53%" }} /><span style={{ height: "83%" }} /></div>
          <div className="preview-labels"><span>Lead</span><span>Qualified</span><span>Discovery</span><span>Proposal</span><span>Won</span></div>
          <div className="preview-activity"><span className="preview-avatar">AM</span><span><strong>Amara Okafor</strong><small>Opportunity moved to Discovery</small></span><small>Just now</small></div>
        </div>
      </div>
      <div className="auth-visual-footer"><span>Thoughtful work starts with good context.</span><span>Northstar CRM · Internal workspace</span></div>
    </section>
    <section className="auth-form-side">
      <div className="auth-form-card">
        <div className="mobile-brand"><div className="brand-mark"><span className="brand-star">✦</span></div><span className="brand-name">northstar<span>CRM</span></span></div>
        <div className="auth-form-heading"><span className="auth-eyebrow">WELCOME BACK</span><h2>Sign in to Northstar</h2><p>Enter your work email and password to continue.</p></div>
        {isMockAuthEnabled && <div className="auth-config-alert demo-config-alert"><strong>Local demo mode</strong><span>Use the demo workspace to explore the CRM. This access is available only while running Vite in development.</span></div>}
        {!isMockAuthEnabled && !isSupabaseConfigured && <div className="auth-config-alert"><strong>Supabase setup needed</strong><span>Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env.local</code>. Setup notes are in the project README.</span></div>}
        {error && <div className="auth-message error-message" role="alert">{error}</div>}
        {notice && <div className="auth-message success-message" role="status">{notice}</div>}
        {isMockAuthEnabled ? <div className="demo-login"><p>The demo uses the same NestJS workspace and analytics API as the CRM. Start the API first, then continue into the demo workspace.</p><button className="auth-submit" type="button" onClick={enterDemo}>Continue as Demo User <span>→</span></button></div> : <form className="auth-form" onSubmit={signIn}>
          <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="you@company.com" required /></label>
          <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Enter your password" required /></label>
          <button className="auth-submit" type="submit" disabled={submitting || !isSupabaseConfigured}>{submitting ? <><span className="auth-spinner small" />Signing in…</> : <>Sign in <span>→</span></>}</button>
        </form>}
        <div className="auth-access-note"><span className="auth-lock">⌑</span><span>{isMockAuthEnabled ? "Demo access is development-only. Switch VITE_AUTH_MODE to supabase when you are ready to use real Supabase accounts." : "Access is managed by your workspace administrator. Ask them to create your account if you need access."}</span></div>
        <div className="auth-mobile-foot">Northstar CRM · Internal workspace</div>
      </div>
    </section>
  </main>;
}
