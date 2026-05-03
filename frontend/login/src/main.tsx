import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import {
  Copy,
  Github as GithubIcon,
  ShieldCheck,
  ChevronLeft,
  Eye,
  EyeOff,
  Zap,
  Users,
  Globe,
  Lock,
} from "lucide-react";
import { FaWeixin } from "react-icons/fa";

type FormEvent = React.FormEvent;
import "./i18n";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8080";

/* ── helpers ─────────────────────────────────────────────── */

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> ?? {}),
    },
  });
  if (!res.ok) {
    const raw = await res.text();
    let msg = raw || res.statusText;
    try {
      const d = JSON.parse(raw);
      if (typeof d.detail === "string") msg = d.detail;
      else if (Array.isArray(d.detail)) msg = d.detail.map((e: { msg: string }) => e.msg).join(", ");
    } catch { /* keep raw */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

function useOAuthParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    clientId: p.get("client_id") ?? "",
    redirectUri: p.get("redirect_uri") ?? "",
    state: p.get("state") ?? "",
    appName: p.get("application_name") ?? "Gooyoit",
  };
}

function providerUrl(provider: string, o: ReturnType<typeof useOAuthParams>) {
  return `${API_BASE}/oauth/providers/${provider}/authorize?client_id=${encodeURIComponent(o.clientId)}&redirect_uri=${encodeURIComponent(o.redirectUri)}&state=${encodeURIComponent(o.state)}`;
}

/* ── shared left panel (carousel) ────────────────────────── */

const slideConfigs = [
  { icon: ShieldCheck, titleKey: "slide1Title", descKey: "slide1Desc", color: "#3B82F6" },
  { icon: Zap, titleKey: "slide2Title", descKey: "slide2Desc", color: "#F59E0B" },
  { icon: Users, titleKey: "slide3Title", descKey: "slide3Desc", color: "#10B981" },
  { icon: Globe, titleKey: "slide4Title", descKey: "slide4Desc", color: "#8B5CF6" },
  { icon: Lock, titleKey: "slide5Title", descKey: "slide5Desc", color: "#EF4444" },
];

function Showcase() {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(0);
  const next = useCallback(() => setIdx((i) => (i + 1) % slideConfigs.length), []);

  useEffect(() => {
    const timer = setInterval(next, 4000);
    return () => clearInterval(timer);
  }, [next]);

  const slide = slideConfigs[idx];

  return (
    <section className="showcase-side" aria-label={t("showcase.slide1Title")}>
      <div className="showcase">
        <div className="carousel" style={{ "--c": slide.color } as React.CSSProperties}>
          <div className="carousel-slides">
            {slideConfigs.map((s, i) => (
              <div
                key={i}
                className={`carousel-slide ${i === idx ? "active" : ""}`}
              >
                <div className="slide-icon-wrap" style={{ background: `${s.color}12`, color: s.color }}>
                  <s.icon size={48} />
                </div>
                <h2>{t(`showcase.${s.titleKey}`)}</h2>
                <p>{t(`showcase.${s.descKey}`)}</p>
              </div>
            ))}
          </div>

          <div className="carousel-dots">
            {slideConfigs.map((_, i) => (
              <button
                key={i}
                className={`dot ${i === idx ? "active" : ""}`}
                onClick={() => setIdx(i)}
                aria-label={`Page ${i + 1}`}
              />
            ))}
          </div>
        </div>

        <div className="code-window">
          <div className="code-tabs">
            <span>Python</span>
            <span>JavaScript</span>
          </div>
          <pre>{`client = PassportClient(
  client_id="gooyoit_app",
  client_secret=env.CLIENT_SECRET
)

token = client.exchange_code(code)
user = client.userinfo(token.access_token)`}</pre>
          <button aria-label={t("showcase.slide1Title")}>
            <Copy size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}

/* ── login page ──────────────────────────────────────────── */

function LoginPage({ onSwitch }: { onSwitch: (v: "login" | "register") => void }) {
  const { t } = useTranslation();
  const oauth = useOAuthParams();
  const [mode, setMode] = useState<"code" | "password">("code");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [msg, setMsg] = useState("");
  const [codeMsg, setCodeMsg] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [debugCode, setDebugCode] = useState("");
  const [captchaKey, setCaptchaKey] = useState("");
  const [captchaImage, setCaptchaImage] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);
  const [captchaError, setCaptchaError] = useState("");

  async function fetchCaptcha() {
    try {
      const r = await api<{ captcha_key: string; captcha_image: string; captcha_answer?: string }>("/auth/captcha");
      setCaptchaKey(r.captcha_key);
      setCaptchaImage(r.captcha_image);
      if (r.captcha_answer) setCaptchaAnswer(r.captcha_answer);
      setCaptchaError("");
    } catch { /* silent */ }
  }

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    if (cooldown > 0) return;
    await fetchCaptcha();
    setShowCaptchaModal(true);
  }

  async function submitCaptcha() {
    if (captchaAnswer.length < 4) {
      setCaptchaError(t("login.captchaInvalid"));
      return;
    }
    setLoading(true);
    setCaptchaError("");
    try {
      const r = await api<{ sent: boolean; debug_code?: string }>(
        "/auth/email/request-code",
        {
          method: "POST",
          body: JSON.stringify({ client_id: oauth.clientId, email, captcha_key: captchaKey, captcha_answer: captchaAnswer }),
        },
      );
      setDebugCode(r.debug_code ?? "");
      setCodeSent(true);
      setCodeMsg(t("login.codeSent"));
      setCooldown(60);
      setShowCaptchaModal(false);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("429") || msg.includes("Too Many")) {
        setShowCaptchaModal(false);
        setCodeMsg(t("login.tooFrequent"));
      } else {
        setCaptchaError(msg);
        fetchCaptcha();
        setCaptchaAnswer("");
      }
    } finally {
      setLoading(false);
    }
  }

  async function login(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg("");
    try {
      if (mode === "code") {
        const r = await api<{ redirect_uri: string }>("/auth/email/login", {
          method: "POST",
          body: JSON.stringify({
            client_id: oauth.clientId,
            redirect_uri: oauth.redirectUri,
            email,
            code,
            state: oauth.state,
          }),
        });
        window.location.href = r.redirect_uri;
      } else {
        const r = await api<{ redirect_uri: string }>("/auth/email/login-password", {
          method: "POST",
          body: JSON.stringify({
            client_id: oauth.clientId,
            redirect_uri: oauth.redirectUri,
            email,
            password,
            state: oauth.state,
          }),
        });
        window.location.href = r.redirect_uri;
      }
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <Showcase />
      <section className="auth-side">
        <div className="auth-card">
          <div className="auth-header">
            <div className="brand-mark">
              <ShieldCheck size={28} />
            </div>
            <h1>{t("login.title", { appName: oauth.appName })}</h1>
          </div>

          <form className="email-form" onSubmit={login}>
            <label className="field mode-field">
              <span>{t("login.email")}</span>
              <div className="input-with-action">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="m@example.com"
                  required
                />
                <button
                  type="button"
                  className="text-btn mode-switch"
                  onClick={() => {
                    setMode(mode === "code" ? "password" : "code");
                    setMsg("");
                  }}
                >
                  {mode === "code" ? t("login.loginByPwd") : t("login.loginByCode")}
                </button>
              </div>
            </label>

            {mode === "code" ? (
              <>
                <label className="field">
                <span>{t("login.code")}</span>
                <div className="code-row">
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder={t("login.codePlaceholder")}
                    maxLength={6}
                    required
                  />
                  <button
                    type="button"
                    className="send-code-btn inline"
                    onClick={requestCode}
                    disabled={loading || !email || cooldown > 0}
                  >
                    {cooldown > 0 ? `${cooldown}s` : codeSent ? t("login.resend") : t("login.sendCode")}
                  </button>
                  {codeMsg && <p className="field-msg">{codeMsg}</p>}
                </div>
              </label>
              </>
            ) : (
              <label className="field">
                <span>{t("login.password")}</span>
                <div className="pwd-wrap">
                  <input
                    type={showPwd ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("login.pwdPlaceholder")}
                    required
                  />
                  <button
                    type="button"
                    className="pwd-toggle"
                    onClick={() => setShowPwd(!showPwd)}
                  >
                    {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
            )}

            <button
              type="submit"
              className="primary-btn"
              disabled={loading}
            >
              {loading ? t("login.logging") : t("login.submit")}
            </button>
          </form>

          {msg && (
            <p className="msg">
              {msg}
              {debugCode ? ` (${debugCode})` : ""}
            </p>
          )}

          <div className="or-divider">
            <span />
            <small>OR</small>
            <span />
          </div>

          <a className="social-btn" href={providerUrl("google", oauth)}>
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            <span>{t("login.google")}</span>
          </a>

          <a className="social-btn" href={providerUrl("github", oauth)}>
            <GithubIcon size={18} />
            <span>{t("login.github")}</span>
          </a>

          <a className="social-btn" href={providerUrl("wechat", oauth)}>
            <FaWeixin size={18} color="#07C160" />
            <span>{t("login.wechat")}</span>
          </a>

          <p className="switch-text">
            {t("login.noAccount")}
            <button onClick={() => onSwitch("register")}>{t("login.register")}</button>
          </p>
          <p className="terms">
            {t("login.termsPre")}
            <a href="#">{t("login.tos")}</a>
            {t("login.termsJoin")}
            <a href="#">{t("login.privacy")}</a>
            {t("login.termsSuffix")}
          </p>
        </div>
      </section>

      {showCaptchaModal && (
        <div className="modal-overlay" onClick={() => setShowCaptchaModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>{t("login.captchaTitle")}</h3>
            <div className="captcha-row">
              <img className="captcha-img" src={captchaImage} alt="CAPTCHA" onClick={fetchCaptcha} title={t("login.captchaRefresh")} />
              <input type="text" value={captchaAnswer} onChange={(e) => setCaptchaAnswer(e.target.value)} placeholder={t("login.captchaPlaceholder")} maxLength={4} />
            </div>
            {captchaError && <p className="msg" style={{ margin: 0 }}>{captchaError}</p>}
            <div style={{ display: "flex", gap: "10px", width: "100%" }}>
              <button type="button" className="text-btn" onClick={() => setShowCaptchaModal(false)} style={{ flex: 1 }}>{t("login.captchaCancel")}</button>
              <button type="button" className="primary-btn" disabled={loading || !captchaAnswer} onClick={submitCaptcha} style={{ flex: 1 }}>
                {loading ? "..." : t("login.captchaConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* ── register page ───────────────────────────────────────── */

function RegisterPage({
  onSwitch,
}: {
  onSwitch: (v: "login" | "register") => void;
}) {
  const { t } = useTranslation();
  const oauth = useOAuthParams();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    code: "",
    password: "",
  });
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [msg, setMsg] = useState("");
  const [codeMsg, setCodeMsg] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [captchaKey, setCaptchaKey] = useState("");
  const [captchaImage, setCaptchaImage] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);
  const [captchaError, setCaptchaError] = useState("");

  function set(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  async function fetchCaptcha() {
    try {
      const r = await api<{ captcha_key: string; captcha_image: string; captcha_answer?: string }>("/auth/captcha");
      setCaptchaKey(r.captcha_key);
      setCaptchaImage(r.captcha_image);
      if (r.captcha_answer) setCaptchaAnswer(r.captcha_answer);
      setCaptchaError("");
    } catch { /* silent */ }
  }

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    if (cooldown > 0) return;
    await fetchCaptcha();
    setShowCaptchaModal(true);
  }

  async function submitCaptcha() {
    if (captchaAnswer.length < 4) {
      setCaptchaError(t("register.captchaInvalid"));
      return;
    }
    setLoading(true);
    setCaptchaError("");
    try {
      await api<{ sent: boolean }>("/auth/email/request-code", {
        method: "POST",
        body: JSON.stringify({ client_id: oauth.clientId, email: form.email, captcha_key: captchaKey, captcha_answer: captchaAnswer, purpose: "register" }),
      });
      setCodeSent(true);
      setCodeMsg(t("register.codeSent"));
      setCooldown(60);
      setShowCaptchaModal(false);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("429") || msg.includes("Too Many")) {
        setShowCaptchaModal(false);
        setCodeMsg(t("register.tooFrequent"));
      } else {
        setCaptchaError(msg);
        fetchCaptcha();
        setCaptchaAnswer("");
      }
    } finally {
      setLoading(false);
    }
  }

  async function register(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg("");
    try {
      const r = await api<{ redirect_uri: string }>("/auth/email/register", {
        method: "POST",
        body: JSON.stringify({
          client_id: oauth.clientId,
          redirect_uri: oauth.redirectUri,
          state: oauth.state,
          first_name: form.firstName,
          last_name: form.lastName,
          email: form.email,
          code: form.code,
          password: form.password,
        }),
      });
      window.location.href = r.redirect_uri;
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <Showcase />
      <section className="auth-side">
        <div className="auth-card">
          <button className="back-btn" onClick={() => onSwitch("login")}>
            <ChevronLeft size={18} />
            <span>{t("register.back")}</span>
          </button>
          <div className="auth-header">
            <div className="brand-mark">
              <ShieldCheck size={28} />
            </div>
            <h1>{t("register.title")}</h1>
          </div>

          <form onSubmit={register}>
            <div className="name-row">
              <label className="field">
                <span>{t("register.firstName")}</span>
                <input
                  value={form.firstName}
                  onChange={set("firstName")}
                  placeholder={t("register.firstName")}
                  required
                />
              </label>
              <label className="field">
                <span>{t("register.lastName")}</span>
                <input
                  value={form.lastName}
                  onChange={set("lastName")}
                  placeholder={t("register.lastName")}
                  required
                />
              </label>
            </div>

            <label className="field">
              <span>{t("register.email")}</span>
              <input
                type="email"
                value={form.email}
                onChange={set("email")}
                placeholder="m@example.com"
                required
              />
            </label>

            <label className="field">
              <span>{t("register.code")}</span>
              <div className="code-row">
                <input
                  type="text"
                  value={form.code}
                  onChange={set("code")}
                  placeholder={t("register.codePlaceholder")}
                  maxLength={6}
                  required
                />
                <button
                  type="button"
                  className="send-code-btn inline"
                  onClick={requestCode}
                  disabled={loading || !form.email || cooldown > 0}
                >
                  {cooldown > 0 ? `${cooldown}s` : codeSent ? t("register.resend") : t("register.sendCode")}
                </button>
                {codeMsg && <p className="field-msg">{codeMsg}</p>}
              </div>
            </label>

            <label className="field">
              <span>{t("register.password")}</span>
              <div className="pwd-wrap">
                <input
                  type={showPwd ? "text" : "password"}
                  value={form.password}
                  onChange={set("password")}
                  placeholder={t("register.pwdPlaceholder")}
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  className="pwd-toggle"
                  onClick={() => setShowPwd(!showPwd)}
                >
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <button type="submit" className="primary-btn" disabled={loading}>
              {loading ? t("register.registering") : t("register.submit")}
            </button>
          </form>

          <div className="or-divider">
            <span />
            <small>OR</small>
            <span />
          </div>

          <a className="social-btn" href={providerUrl("google", oauth)}>
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            <span>{t("register.google")}</span>
          </a>

          {msg && <p className="msg">{msg}</p>}

          <p className="switch-text">
            {t("register.hasAccount")}
            <button onClick={() => onSwitch("login")}>{t("register.login")}</button>
          </p>
          <p className="terms">
            {t("register.termsPre")}
            <a href="#">{t("register.tos")}</a>
            {t("register.termsJoin")}
            <a href="#">{t("register.privacy")}</a>
            {t("register.termsSuffix")}
          </p>
        </div>
      </section>

      {showCaptchaModal && (
        <div className="modal-overlay" onClick={() => setShowCaptchaModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>{t("register.captchaTitle")}</h3>
            <div className="captcha-row">
              <img className="captcha-img" src={captchaImage} alt="CAPTCHA" onClick={fetchCaptcha} title={t("register.captchaRefresh")} />
              <input type="text" value={captchaAnswer} onChange={(e) => setCaptchaAnswer(e.target.value)} placeholder={t("register.captchaPlaceholder")} maxLength={4} />
            </div>
            {captchaError && <p className="msg" style={{ margin: 0 }}>{captchaError}</p>}
            <div style={{ display: "flex", gap: "10px", width: "100%" }}>
              <button type="button" className="text-btn" onClick={() => setShowCaptchaModal(false)} style={{ flex: 1 }}>{t("register.captchaCancel")}</button>
              <button type="button" className="primary-btn" disabled={loading || !captchaAnswer} onClick={submitCaptcha} style={{ flex: 1 }}>
                {loading ? "..." : t("register.captchaConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* ── app ─────────────────────────────────────────────────── */

function App() {
  const [view, setView] = useState<"login" | "register">("login");
  return view === "register" ? (
    <RegisterPage onSwitch={setView} />
  ) : (
    <LoginPage onSwitch={setView} />
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
