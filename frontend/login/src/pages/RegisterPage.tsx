import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { GithubIcon as GithubIcon, ShieldCheck, ChevronLeft, Eye, EyeOff } from "lucide-react";
import { FaWeixin } from "react-icons/fa";
import Showcase from "../components/Showcase";
import GoogleIcon from "../components/GoogleIcon";
import { useOAuthParams, providerUrl, api, safeRedirect, redirectUriSchema, loginMethodsSchema } from "../lib/utils";
import { useCaptcha } from "../hooks/useCaptcha";

type FormEvent = React.FormEvent;

export default function RegisterPage({
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
  const [loginMethods, setLoginMethods] = useState<string[]>([]);
  const {
    captchaKey,
    captchaImage,
    captchaAnswer,
    setCaptchaAnswer,
    showCaptchaModal,
    setShowCaptchaModal,
    captchaError,
    setCaptchaError,
    fetchCaptcha,
  } = useCaptcha();

  useEffect(() => {
    if (!oauth.clientId || !oauth.redirectUri) return;
    api<{ login_methods: string[] }>(
      `/oauth/login-methods?client_id=${encodeURIComponent(oauth.clientId)}`
    ).then((data) => {
      const parsed = loginMethodsSchema.safeParse(data);
      const methods = parsed.success ? parsed.data.login_methods : [];
      if (methods.length > 0) setLoginMethods(methods);
    }).catch(() => setLoginMethods(["email_code"]));
  }, []);

  type FormKey = "firstName" | "lastName" | "email" | "code" | "password";
  function set(k: FormKey) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
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
      const parsedReg = redirectUriSchema.safeParse(r);
      if (parsedReg.success) safeRedirect(parsedReg.data.redirect_uri);
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

          {loginMethods.includes("google") && (
          <a className="social-btn" href={providerUrl("google", oauth)} rel="noopener noreferrer">
            <GoogleIcon size={18} />
            <span>{t("register.google")}</span>
          </a>
          )}

          {loginMethods.includes("github") && (
          <a className="social-btn" href={providerUrl("github", oauth)} rel="noopener noreferrer">
            <GithubIcon size={18} />
            <span>{t("register.github")}</span>
          </a>
          )}

          {loginMethods.includes("wechat") && (
          <a className="social-btn" href={providerUrl("wechat", oauth)} rel="noopener noreferrer">
            <FaWeixin size={18} color="#07C160" />
            <span>{t("register.wechat")}</span>
          </a>
          )}

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
              {!captchaImage.startsWith("data:image/") ? null : <img className="captcha-img" src={captchaImage} alt="CAPTCHA" onClick={fetchCaptcha} title={t("register.captchaRefresh")} />}
              <input type="text" value={captchaAnswer} onChange={(e) => setCaptchaAnswer(e.target.value)} placeholder={t("register.captchaPlaceholder")} maxLength={4} />
            </div>
            {captchaError && <p className="msg" style={{ margin: 0 }}>{captchaError}</p>}
            <div className="flex w-full gap-2.5">
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
