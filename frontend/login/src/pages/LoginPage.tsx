import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { GithubIcon as GithubIcon, ShieldCheck, Eye, EyeOff, KeyRound } from "lucide-react";
import { FaWeixin } from "react-icons/fa";
import Showcase from "../components/Showcase";
import GoogleIcon from "../components/GoogleIcon";
import OtpInput from "../components/OtpInput";
import LegalModal from "../components/LegalModal";
import { useOAuthParams, providerUrl, api, safeRedirect, redirectUriSchema, loginMethodsSchema, bufferDecode, bufferEncode, normalizeCnPhone } from "../lib/utils";
import { useAliyunCaptcha } from "../lib/aliyunCaptcha";

type FormEvent = React.FormEvent;
type SmsPurpose = "login" | "register" | "reset_password";
type View = "login" | "register" | "forgot";
type Tab = "sms" | "password";

export default function LoginPage() {
  const { t } = useTranslation();
  const oauth = useOAuthParams();
  const [view, setView] = useState<View>("login");
  const [mode, setMode] = useState<Tab>("sms");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [msg, setMsg] = useState("");
  const [codeMsg, setCodeMsg] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [debugCode, setDebugCode] = useState("");
  const [loginMethods, setLoginMethods] = useState<string[]>([]);
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [passwordEnabled, setPasswordEnabled] = useState(true);
  const [appName, setAppName] = useState(oauth.appName);
  const [legal, setLegal] = useState<null | "tos" | "privacy">(null);
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  const purposeRef = useRef<SmsPurpose>("login");

  async function handleCaptchaVerify(captchaVerifyParam: string) {
    const phoneValue = normalizeCnPhone(phoneRef.current);
    if (!phoneValue) {
      setPhoneError(t("login.phoneInvalid"));
      return { captchaResult: true, bizResult: false };
    }
    try {
      const r = await api<{ sent: boolean; debug_code?: string }>(
        "/auth/sms/request-code",
        {
          method: "POST",
          body: JSON.stringify({
            client_id: oauth.clientId,
            phone: phoneValue,
            purpose: purposeRef.current,
            captcha_verify_param: captchaVerifyParam,
          }),
        },
      );
      if (import.meta.env.DEV) setDebugCode(r.debug_code ?? "");
      setCodeSent(true);
      setCodeMsg("");
      setCooldown(60);
      return { captchaResult: true, bizResult: true };
    } catch (err) {
      const m = (err as Error).message;
      if (m.includes("Captcha verification failed")) {
        return { captchaResult: false, bizResult: false };
      }
      if (m.includes("rate limit") || m.includes("Too Many")) {
        setCodeMsg(t("login.tooFrequent"));
      } else {
        setCodeMsg(m);
      }
      return { captchaResult: true, bizResult: false };
    }
  }

  const captcha = useAliyunCaptcha(handleCaptchaVerify);

  useEffect(() => {
    document.title = t(
      view === "register" ? "login.registerTitle" : view === "forgot" ? "login.forgotTitle" : "login.title",
      { appName },
    );
  }, [t, appName, view]);

  useEffect(() => {
    if (!oauth.clientId || !oauth.redirectUri) return;
    api<{ login_methods: string[] }>(
      `/oauth/login-methods?client_id=${encodeURIComponent(oauth.clientId)}`
    ).then((data) => {
      const parsed = loginMethodsSchema.safeParse(data);
      const methods = parsed.success ? parsed.data.login_methods : [];
      if (parsed.success && parsed.data.application_name) {
        setAppName(parsed.data.application_name);
      }
      if (parsed.success && parsed.data.allow_registration) {
        setAllowRegistration(true);
      }
      if (methods.length > 0) {
        setLoginMethods(methods);
        setPasswordEnabled(methods.includes("email_password"));
        const tabs: Tab[] = [
          methods.includes("sms_code") ? "sms" : null,
          methods.includes("email_password") ? "password" : null,
        ].filter(Boolean) as Tab[];
        if (tabs.length > 0 && !tabs.includes("sms")) setMode(tabs[0]);
      }
    }).catch(() => {
      setLoginMethods(["sms_code"]);
    });
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function switchView(next: View) {
    setView(next);
    setMsg("");
    setCodeMsg("");
    setCodeSent(false);
    setCode("");
    setNewPassword("");
  }

  async function requestCode(e: React.MouseEvent, purpose: SmsPurpose) {
    e.preventDefault();
    if (cooldown > 0) return;
    if (!normalizeCnPhone(phone)) {
      setPhoneError(t("login.phoneInvalid"));
      return;
    }
    purposeRef.current = purpose;
    if (!captcha.trigger()) {
      setCodeMsg(t("login.captchaUnavailable"));
    }
  }

  async function finishSmsFlow(endpoint: string, extra: Record<string, unknown>) {
    const r = await api<{ redirect_uri: string }>(endpoint, {
      method: "POST",
      body: JSON.stringify({
        client_id: oauth.clientId,
        redirect_uri: oauth.redirectUri,
        phone,
        code,
        state: oauth.state,
        ...extra,
      }),
    });
    const parsed = redirectUriSchema.safeParse(r);
    if (parsed.success) safeRedirect(parsed.data.redirect_uri);
  }

  async function login(e: FormEvent) {
    e.preventDefault();
    if (mode === "sms" && !normalizeCnPhone(phone)) {
      setPhoneError(t("login.phoneInvalid"));
      return;
    }
    setLoading(true);
    setMsg("");
    try {
      if (mode === "sms") {
        await finishSmsFlow("/auth/sms/login", {});
      } else {
        const r = await api<{ redirect_uri: string }>("/auth/email/login-password", {
          method: "POST",
          body: JSON.stringify({
            client_id: oauth.clientId,
            redirect_uri: oauth.redirectUri,
            identifier,
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

  async function register(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg("");
    try {
      await finishSmsFlow("/auth/sms/register", {});
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg("");
    try {
      await finishSmsFlow("/auth/sms/reset-password", { new_password: newPassword });
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
          clientDataJSON: bufferEncode(credential.response.clientDataJSON),
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

  const smsAvailable = loginMethods.length === 0 || loginMethods.includes("sms_code");
  const tabsAvailable = smsAvailable || passwordEnabled;

  const secondaryProviders = (
    <>
      {loginMethods.includes("wechat") && (
        <a className="social-btn" href={providerUrl("wechat", oauth)} rel="noopener noreferrer">
          <FaWeixin size={18} color="#07C160" />
          <span>{t("login.wechat")}</span>
        </a>
      )}
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
    </>
  );

  const phoneField = (
    <label className="field">
      <span>{t("login.phone")}</span>
      <input
        type="tel"
        value={phone}
        onChange={(e) => {
          setPhone(e.target.value);
          if (phoneError) setPhoneError("");
        }}
        placeholder={t("login.phonePlaceholder")}
        autoComplete="tel"
        inputMode="tel"
        maxLength={20}
        required
      />
      {phoneError && <span className="field-msg">{phoneError}</span>}
    </label>
  );

  const smsCodeField = (purpose: SmsPurpose) => (
    <label className="field">
      <span>{t("login.code")}</span>
      <OtpInput value={code} onChange={setCode} />
      <div className="otp-meta">
        <span className="otp-hint">{codeSent ? t("login.noCode") : ""}</span>
        <button
          type="button"
          className="text-btn send-code-link"
          onClick={(e) => requestCode(e, purpose)}
          disabled={loading || !phone || cooldown > 0}
        >
          {cooldown > 0 ? t("login.resendIn", { seconds: cooldown }) : codeSent ? t("login.resend") : t("login.sendCode")}
        </button>
      </div>
      {codeMsg && <span className="field-msg">{codeMsg}</span>}
      {import.meta.env.DEV && debugCode && codeSent && (
        <p className="field-msg">DEV: {debugCode}</p>
      )}
    </label>
  );

  return (
    <main className="shell">
      <Showcase />
      <section className="auth-side">
        <div className="auth-card">
          <div className="auth-header">
            <div className="brand-mark">
              <ShieldCheck size={28} />
            </div>
            <h1>
              {view === "register"
                ? t("login.registerTitle", { appName })
                : view === "forgot"
                  ? t("login.forgotTitle")
                  : t("login.title", { appName })}
            </h1>
          </div>
          {view === "register" && <p className="auth-subtitle">{t("login.registerDesc")}</p>}
          {view === "forgot" && <p className="auth-subtitle">{t("login.forgotDesc")}</p>}

          {view !== "login" && (
            <button type="button" className="back-link" onClick={() => switchView("login")}>
              ← {t("login.backToLogin")}
            </button>
          )}

          {view === "login" && (
            <>
              {tabsAvailable && (
                <div className="setup-tabs login-tabs" role="tablist">
                  {smsAvailable && (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === "sms"}
                      className={mode === "sms" ? "active" : ""}
                      onClick={() => { setMode("sms"); setMsg(""); }}
                    >
                      {t("login.tabSms")}
                    </button>
                  )}
                  {passwordEnabled && (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === "password"}
                      className={mode === "password" ? "active" : ""}
                      onClick={() => { setMode("password"); setMsg(""); }}
                    >
                      {t("login.tabPassword")}
                    </button>
                  )}
                </div>
              )}

              <form className="email-form" onSubmit={login}>
                  {mode === "sms" ? (
                    <>
                      {phoneField}
                      {smsCodeField("login")}
                    </>
                  ) : (
                    <>
                      <label className="field">
                        <span>{t("login.identifier")}</span>
                        <input
                          type="text"
                          value={identifier}
                          onChange={(e) => setIdentifier(e.target.value)}
                          placeholder={t("login.identifierPlaceholder")}
                          autoComplete="username"
                          required
                        />
                      </label>
                      <label className="field">
                        <span>{t("login.password")}</span>
                        <div className="pwd-wrap">
                          <input
                            type={showPwd ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={t("login.pwdPlaceholder")}
                            autoComplete="current-password"
                            required
                          />
                          <button
                            type="button"
                            className="pwd-toggle"
                            onClick={() => setShowPwd(!showPwd)}
                            aria-label="toggle password"
                          >
                            {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                        <div className="otp-meta">
                          <button
                            type="button"
                            className="text-btn send-code-link"
                            onClick={() => switchView("forgot")}
                          >
                            {t("login.forgotLink")}
                          </button>
                        </div>
                      </label>
                    </>
                  )}

                  <button
                    type="submit"
                    className="primary-btn"
                    disabled={loading || (mode === "sms" && code.length < 4)}
                  >
                    {loading ? t("login.logging") : t("login.submit")}
                  </button>

                  {(loginMethods.includes("wechat") || loginMethods.includes("google") || loginMethods.includes("github") || loginMethods.includes("passkey")) && (
                    <div className="or-divider">
                      <span />
                      <small>OR</small>
                      <span />
                    </div>
                  )}
                  {secondaryProviders}
                </form>

              {allowRegistration && smsAvailable && (
                <p className="switch-text">
                  {t("login.noAccount")}{" "}
                  <button type="button" onClick={() => switchView("register")}>
                    {t("login.toRegister")}
                  </button>
                </p>
              )}
            </>
          )}

          {view === "register" && (
            <form className="email-form" onSubmit={register}>
              {phoneField}
              {smsCodeField("register")}
              <button type="submit" className="primary-btn" disabled={loading || code.length < 4}>
                {loading ? t("login.logging") : t("login.registerSubmit")}
              </button>
            </form>
          )}

          {view === "forgot" && (
            <form className="email-form" onSubmit={resetPassword}>
              {phoneField}
              {smsCodeField("reset_password")}
              <label className="field">
                <span>{t("login.newPassword")}</span>
                <div className="pwd-wrap">
                  <input
                    type={showNewPwd ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t("login.newPwdPlaceholder")}
                    autoComplete="new-password"
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    className="pwd-toggle"
                    onClick={() => setShowNewPwd(!showNewPwd)}
                    aria-label="toggle password"
                  >
                    {showNewPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="field-hint">{t("login.pwdHint")}</p>
              </label>
              <button type="submit" className="primary-btn" disabled={loading || code.length < 4 || newPassword.length < 8}>
                {loading ? t("login.logging") : t("login.forgotSubmit")}
              </button>
            </form>
          )}

          {msg && (
            <p className="msg">
              {msg}
              {import.meta.env.DEV && debugCode && view === "login" && mode === "sms" ? ` (${debugCode})` : ""}
            </p>
          )}

          {view === "register" && (
            <p className="switch-text">
              {t("login.haveAccount")}{" "}
              <button type="button" onClick={() => switchView("login")}>
                {t("login.toLogin")}
              </button>
            </p>
          )}
          {view === "forgot" && (
            <p className="switch-text">
              {t("login.remembered")}{" "}
              <button type="button" onClick={() => switchView("login")}>
                {t("login.toLogin")}
              </button>
            </p>
          )}

          {view === "login" && (
            <p className="switch-text">
              <a href="/account/settings">{t("login.accountSettings")}</a>
            </p>
          )}
          <p className="terms">
            {t("login.termsPre")}
            <button type="button" onClick={() => setLegal("tos")}>
              {t("login.tos")}
            </button>
            {t("login.termsJoin")}
            <button type="button" onClick={() => setLegal("privacy")}>
              {t("login.privacy")}
            </button>
            {t("login.termsSuffix")}
          </p>
        </div>
      </section>

      {legal && <LegalModal kind={legal} onClose={() => setLegal(null)} />}

      <div id="aliyun-captcha-element" />
      <button
        ref={captcha.triggerRef}
        id="aliyun-captcha-trigger"
        type="button"
        style={{ display: "none" }}
        tabIndex={-1}
        aria-hidden="true"
      />
    </main>
  );
}
