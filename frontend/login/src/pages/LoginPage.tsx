import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { GithubIcon as GithubIcon, ShieldCheck, Eye, EyeOff, KeyRound } from "lucide-react";
import { FaWeixin } from "react-icons/fa";
import Showcase from "../components/Showcase";
import GoogleIcon from "../components/GoogleIcon";
import { useOAuthParams, providerUrl, api, safeRedirect, redirectUriSchema, loginMethodsSchema, bufferDecode, bufferEncode } from "../lib/utils";
import { useCaptcha } from "../hooks/useCaptcha";

type FormEvent = React.FormEvent;

export default function LoginPage({ onSwitch }: { onSwitch: (v: "login" | "register") => void }) {
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
  const [loginMethods, setLoginMethods] = useState<string[]>([]);
  const [emailPasswordEnabled, setEmailPasswordEnabled] = useState(false);
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
      if (methods.length > 0) {
        setLoginMethods(methods);
        setEmailPasswordEnabled(methods.includes("email_password"));
        if (!methods.includes("email_code")) {
          setMode("password");
        }
      }
    }).catch(() => {
      setLoginMethods(["email_code"]);
      setEmailPasswordEnabled(true);
    });
  }, []);

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
      if (import.meta.env.DEV) setDebugCode(r.debug_code ?? "");
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
        const parsed = redirectUriSchema.safeParse(r);
        if (parsed.success) safeRedirect(parsed.data.redirect_uri);
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
        const parsedPwd = redirectUriSchema.safeParse(r);
        if (parsedPwd.success) safeRedirect(parsedPwd.data.redirect_uri);
      }
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handlePasskeyLogin() {
    if (!window.PublicKeyCredential) {
      setMsg("Your browser does not support Passkeys");
      return;
    }
    setLoading(true);
    setMsg("");
    try {
      const beginR = await api<{ options: Record<string, unknown>; challenge_id: string }>(
        "/auth/webauthn/login/begin",
        {
          method: "POST",
          body: JSON.stringify({ client_id: oauth.clientId }),
        },
      );
      const serverOptions = beginR.options as unknown as PublicKeyCredentialRequestOptionsJSON;
      const { extensions: _, userVerification: _uv, allowCredentials: _ac, ...pkOptions } = serverOptions;
      void _; void _uv; void _ac;
      const pkc = await navigator.credentials.get({
        publicKey: {
          ...pkOptions,
          challenge: bufferDecode(serverOptions.challenge as string) as unknown as BufferSource,
          allowCredentials: [],
        } as PublicKeyCredentialRequestOptions,
      });
      if (!pkc) {
        setMsg("Passkey authentication cancelled");
        return;
      }
      const credential = pkc as PublicKeyCredential;
      const authResponse = credential.response as AuthenticatorAssertionResponse;
      const credentialJSON = {
        id: credential.id,
        rawId: bufferEncode(new Uint8Array(credential.rawId)),
        type: credential.type,
        response: {
          authenticatorData: bufferEncode(authResponse.authenticatorData),
          clientDataJSON: bufferEncode(authResponse.clientDataJSON),
          signature: bufferEncode(authResponse.signature),
          userHandle: authResponse.userHandle ? bufferEncode(authResponse.userHandle) : null,
        },
      };
      const verifyR = await api<{ redirect_uri: string }>(
        "/auth/webauthn/login/verify",
        {
          method: "POST",
          body: JSON.stringify({
            client_id: oauth.clientId,
            redirect_uri: oauth.redirectUri,
            state: oauth.state,
            credential: credentialJSON,
            challenge_id: beginR.challenge_id,
          }),
        },
      );
      const parsed = redirectUriSchema.safeParse(verifyR);
      if (parsed.success) safeRedirect(parsed.data.redirect_uri);
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
                {emailPasswordEnabled && (
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
                )}
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
              {import.meta.env.DEV && debugCode ? ` (${debugCode})` : ""}
            </p>
          )}

          <div className="or-divider">
            <span />
            <small>OR</small>
            <span />
          </div>

          {loginMethods.includes("google") && (
          <a className="social-btn" href={providerUrl("google", oauth)} rel="noopener noreferrer">
            <GoogleIcon size={18} />
            <span>{t("login.google")}</span>
          </a>
          )}

          {loginMethods.includes("github") && (
          <a className="social-btn" href={providerUrl("github", oauth)} rel="noopener noreferrer">
            <GithubIcon size={18} />
            <span>{t("login.github")}</span>
          </a>
          )}

          {loginMethods.includes("wechat") && (
          <a className="social-btn" href={providerUrl("wechat", oauth)} rel="noopener noreferrer">
            <FaWeixin size={18} color="#07C160" />
            <span>{t("login.wechat")}</span>
          </a>
          )}

          {loginMethods.includes("passkey") && (
          <button
            type="button"
            className="social-btn"
            onClick={handlePasskeyLogin}
            disabled={loading}
          >
            <KeyRound size={18} />
            <span>{t("login.passkey", "Passkey")}</span>
          </button>
          )}

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
              {!captchaImage.startsWith("data:image/") ? null : <img className="captcha-img" src={captchaImage} alt="CAPTCHA" onClick={fetchCaptcha} title={t("login.captchaRefresh")} />}
              <input type="text" value={captchaAnswer} onChange={(e) => setCaptchaAnswer(e.target.value)} placeholder={t("login.captchaPlaceholder")} maxLength={4} />
            </div>
            {captchaError && <p className="msg" style={{ margin: 0 }}>{captchaError}</p>}
            <div className="flex w-full gap-2.5">
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
