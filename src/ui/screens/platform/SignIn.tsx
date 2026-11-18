"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, KeyRound, Lock, Mail, Shield } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { describeError } from "@/ui/errors";
import { platformCall } from "./api";

/**
 * The real platform sign-in (docs/PLATFORM_ADMINS.md): a password on `/platform/sign-in`, then `/platform/verify` for the second step, which is
 * either a code from the authenticator app (or a backup code) or, for an admin with no second step yet, the set-up. Both are new routes; the frozen
 * tenant sign-in pages are untouched. Nothing here says whether an email exists: every failure of the password step is the same sentence.
 */

type Call = typeof platformCall;

function Card({ title, body, children }: { title: string; body: ReactNode; children: ReactNode }) {
  return (
    <div className="fb-pl-auth">
      <div className="fb-pl-auth-card">
        <div className="fb-pl-auth-pill">
          <Shield size={14} aria-hidden="true" />
          Platform console
        </div>
        <h1>{title}</h1>
        <p className="fb-pl-auth-body">{body}</p>
        {children}
      </div>
    </div>
  );
}

function ErrorLine({ children }: { children: ReactNode }) {
  return children ? (
    <div role="alert" className="fb-pl-auth-err">
      <AlertTriangle size={15} aria-hidden="true" />
      {children}
    </div>
  ) : null;
}

function Field({ label, icon, ...rest }: { label: string; icon: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
      <span style={{ fontSize: 13, fontWeight: 600, paddingLeft: 4 }}>{label}</span>
      <span className="fb-pl-auth-wrap">
        {icon}
        <input className="fb-pl-auth-input" {...rest} />
      </span>
    </label>
  );
}

/** Step 1: email and password. On success the server holds a ten-minute pending sign-in and the browser goes on to the second step. */
export function PlatformSignInPage({ call = platformCall, onDone = () => window.location.assign("/platform/verify") }: { call?: Call; onDone?: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await call("POST", "/api/platform/auth/sign-in", { email: email.trim(), password });
      onDone();
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(status === 401 ? "That email and password did not match, or the account is locked for a while." : describeError(err).body);
      setBusy(false);
    }
  }

  return (
    <Card title="Platform sign-in" body="For Figbloom platform admins only. You will be asked for a code from your authenticator app next.">
      <form onSubmit={submit} noValidate>
        <Field label="Email" icon={<Mail size={18} aria-hidden="true" />} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" icon={<Lock size={18} aria-hidden="true" />} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorLine>{error}</ErrorLine>
        <button type="submit" className="fb-pl-auth-cta" disabled={busy}>
          Continue <ArrowRight size={17} aria-hidden="true" />
        </button>
      </form>
      <p className="fb-pl-auth-foot">
        Not a platform admin? <Link href="/login" style={{ fontWeight: 700, color: "#1a1c19", textDecoration: "underline" }}>Log in to your organisation</Link>
      </p>
    </Card>
  );
}

/**
 * First step for a new platform admin (docs/PLATFORM_BOOTSTRAP.md): the single-use link carries a token; the person chooses a password here.
 * No session is created. They sign in next at /platform/sign-in and set up the authenticator app. A new route; frozen tenant pages untouched.
 */
const PLATFORM_MIN_PASSWORD = 12;

export function AcceptInvitePage({ token, call = platformCall }: { token: string; call?: Call }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <Card title="This link is incomplete" body="Open the full link from your invitation. If it was cut off, ask for a new one.">
        <p className="fb-pl-auth-foot">
          <Link href="/platform/sign-in" style={{ fontWeight: 700, color: "#1a1c19", textDecoration: "underline" }}>Platform sign-in</Link>
        </p>
      </Card>
    );
  }

  if (done) {
    return (
      <Card title="Password set" body="Your platform admin account is ready. Sign in next; you will set up your authenticator app on first sign-in.">
        <p style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
          <CheckCircle2 size={18} aria-hidden="true" /> Nothing else to do on this page.
        </p>
        <a href="/platform/sign-in" className="fb-pl-auth-cta" style={{ display: "inline-flex", textDecoration: "none" }}>
          Go to sign-in <ArrowRight size={17} aria-hidden="true" />
        </a>
      </Card>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < PLATFORM_MIN_PASSWORD) {
      setError(`Choose a password of at least ${PLATFORM_MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await call("POST", "/api/platform/auth/accept-invite", { token, password });
      setDone(true);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(status === 400 || status === 401 || status === 404 ? "This link is not valid any more. It may have been used already or it expired. Ask for a new one." : describeError(err).body);
      setBusy(false);
    }
  }

  return (
    <Card title="Choose your password" body={`For your Figbloom platform admin account. At least ${PLATFORM_MIN_PASSWORD} characters. You will set up your authenticator app when you sign in.`}>
      <form onSubmit={submit} noValidate>
        <Field label="New password" icon={<Lock size={18} aria-hidden="true" />} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Field label="Repeat the password" icon={<KeyRound size={18} aria-hidden="true" />} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <ErrorLine>{error}</ErrorLine>
        <button type="submit" className="fb-pl-auth-cta" disabled={busy}>
          Set password <ArrowRight size={17} aria-hidden="true" />
        </button>
      </form>
    </Card>
  );
}

interface Enrolment {
  secret: string;
  otpauthUri: string;
}

/** Step 2: the pending sign-in says which second step it needs (the challenge route), then this page runs it. */
export function VerifyPage({ call = platformCall, onDone = (to: string) => window.location.assign(to) }: { call?: Call; onDone?: (to: string) => void }) {
  const [purpose, setPurpose] = useState<"VERIFY" | "ENROL" | "EXPIRED" | null>(null);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const c = await call<{ purpose: "VERIFY" | "ENROL" }>("GET", "/api/platform/auth/challenge");
        if (!alive) return;
        if (c.purpose === "ENROL") setEnrolment(await call<Enrolment>("POST", "/api/platform/auth/two-step/enrol/start"));
        if (alive) setPurpose(c.purpose);
      } catch {
        if (alive) setPurpose("EXPIRED");
      }
    })();
    return () => {
      alive = false;
    };
  }, [call]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean = code.replace(/\s/g, "");
    if (!clean) {
      setError(purpose === "ENROL" ? "Enter the 6 digits from your app." : "Enter the code from your authenticator app, or a backup code.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (purpose === "ENROL") {
        const r = await call<{ landing: string; backupCodes: string[] }>("POST", "/api/platform/auth/two-step/enrol/confirm", { code: clean });
        setBackupCodes(r.backupCodes);
      } else {
        const r = await call<{ landing: string }>("POST", "/api/platform/auth/two-step/verify", { code: clean });
        onDone(r.landing || "/platform");
      }
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(status === 401 ? "That code did not work. Try the next one from your app, or a backup code." : describeError(err).body);
    } finally {
      setBusy(false);
    }
  }

  if (purpose === null) return <Card title="Verify it’s you" body="One moment.">{null}</Card>;
  if (purpose === "EXPIRED")
    return (
      <Card title="Sign in again" body="This sign-in has expired or was never started. Start again with your password.">
        <Link className="fb-pl-auth-cta" href="/platform/sign-in" style={{ textDecoration: "none" }}>
          Back to sign-in <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </Card>
    );
  if (backupCodes)
    return (
      <Card title="Save your backup codes" body="Each code works once if you lose your phone. They are shown only now. Store them somewhere safe, not in the CRM.">
        <ul aria-label="Backup codes" style={{ columns: 2, padding: 0, listStyle: "none", fontFamily: "IBM Plex Mono, monospace", fontSize: 14 }}>
          {backupCodes.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <button type="button" className="fb-pl-auth-cta" onClick={() => onDone("/platform")}>
          I saved them, open the console <ArrowRight size={17} aria-hidden="true" />
        </button>
      </Card>
    );

  const enrol = purpose === "ENROL";
  return (
    <Card
      title={enrol ? "Set up two-step sign-in" : "Verify it’s you"}
      body={enrol ? "Platform admins always use a second step. Add this key to an authenticator app, then enter the first 6-digit code it shows." : "Enter the 6-digit code from your authenticator app, or one of your backup codes. This device is not remembered."}
    >
      {enrol && enrolment ? (
        <div className="fb-pl-auth-note">
          <CheckCircle2 size={17} aria-hidden="true" />
          <span>
            Key: <code style={{ wordBreak: "break-all" }}>{enrolment.secret}</code> ·{" "}
            <a href={enrolment.otpauthUri}>Open in an authenticator app</a>
          </span>
        </div>
      ) : null}
      <form onSubmit={submit} noValidate>
        <Field
          label={enrol ? "Authenticator code" : "Authenticator or backup code"}
          icon={<KeyRound size={18} aria-hidden="true" />}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode={enrol ? "numeric" : "text"}
          autoComplete="one-time-code"
          placeholder={enrol ? "123 456" : "123 456 or XXXX-XXXX"}
        />
        <ErrorLine>{error}</ErrorLine>
        <button type="submit" className="fb-pl-auth-cta" disabled={busy}>
          {enrol ? "Turn on and sign in" : "Verify"} <ArrowRight size={17} aria-hidden="true" />
        </button>
      </form>
      <p className="fb-pl-auth-foot">
        <Link href="/platform/sign-in" style={{ fontWeight: 700, color: "#1a1c19", textDecoration: "underline" }}>Start again</Link>
      </p>
    </Card>
  );
}
