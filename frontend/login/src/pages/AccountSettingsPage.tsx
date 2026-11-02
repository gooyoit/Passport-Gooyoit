import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  GithubIcon as GithubIcon,
  KeyRound,
  Mail,
  Smartphone,
  UserCircle2,
} from "lucide-react";
import { FaWeixin } from "react-icons/fa";
import GoogleIcon from "../components/GoogleIcon";
import OtpInput from "../components/OtpInput";
import { api, API_BASE, normalizeCnPhone } from "../lib/utils";
import { useAliyunCaptcha } from "../lib/aliyunCaptcha";

type Identity = { provider: string; provider_email: string | null };

type Profile = {
  user: {
    id: number;
    username: string | null;
    email: string | null;
    email_verified: boolean;
    contact_phone: string | null;
    display_name: string | null;
    avatar_url: string | null;
    status: string;
  };
  has_password: boolean;
  identities: Identity[];
};

type Section = "email" | "credentials" | "phoneBind" | null;

function ProviderIcon({ provider }: { provider: string }) {
  const cls = provider === "wechat" ? "credential-icon wechat" : "credential-icon";
  if (provider === "wechat") return <div className={cls}><FaWeixin size={18} /></div>;
  if (provider === "google") return <div className={cls}><GoogleIcon size={18} /></div>;
  if (provider === "github") return <div className={cls}><GithubIcon size={18} /></div>;
  if (provider === "email") return <div className={cls}><Mail size={18} /></div>;
  if (provider === "phone") return <div className={cls}><Smartphone size={18} /></div>;
  return <div className={cls}><UserCircle2 size={18} /></div>;
}

const PROVIDER_NAMES: Record<string, string> = {
  wechat: "微信",
  google: "Google",
  github: "GitHub",
  email: "邮箱",
};

export default function AccountSettingsPage() {
  const { t } = useTranslation();
  const [authState, setAuthState] = useState<"loading" | "guest" | "ready">("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState<Section>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const [email, setEmail] = useState("");
  const [showMerge, setShowMerge] = useState(false);
  const [mergeIdentifier, setMergeIdentifier] = useState("");
  const [mergePassword, setMergePassword] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [bindPhone, setBindPhone] = useState("");
  const [bindCode, setBindCode] = useState("");
  const [bindCodeSent, setBindCodeSent] = useState(false);
  const [bindCodeMsg, setBindCodeMsg] = useState("");
  const [bindCooldown, setBindCooldown] = useState(0);
  const bindPhoneRef = useRef(bindPhone);
  bindPhoneRef.current = bindPhone;

  useEffect(() => {
    api<Profile>("/account/profile")
      .then((data) => {
        setProfile(data);
        setAuthState("ready");
        setUsername(data.user.username ?? "");
      })
      .catch(() => setAuthState("guest"));
  }, []);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("bind");
    if (!result) return;
    if (result === "ok") setMessage(t("accountSettings.wechatBindOk"));
    else if (result === "conflict") setMessage(t("accountSettings.wechatBindConflict"));
    else setMessage(t("accountSettings.wechatBindError"));
    window.history.replaceState(null, "", "/account/settings");
  }, [t]);

  useEffect(() => {
    if (bindCooldown <= 0) return;
    const timer = setTimeout(() => setBindCooldown(bindCooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [bindCooldown]);

  async function handlePhoneCaptchaVerify(captchaVerifyParam: string) {
    const phoneValue = normalizeCnPhone(bindPhoneRef.current);
    if (!phoneValue) {
      setBindCodeMsg(t("login.phoneInvalid"));
      return { captchaResult: true, bizResult: false };
    }
    try {
      await api<{ sent: boolean }>("/account/phone/request-code", {
        method: "POST",
        body: JSON.stringify({ phone: phoneValue, captcha_verify_param: captchaVerifyParam }),
      });
      setBindCodeSent(true);
      setBindCodeMsg("");
      setBindCooldown(60);
      return { captchaResult: true, bizResult: true };
    } catch (error) {
      const m = (error as Error).message;
      if (m.includes("Captcha verification failed")) {
        return { captchaResult: false, bizResult: false };
      }
      setBindCodeMsg(m.includes("rate limit") || m.includes("Too Many") ? t("login.tooFrequent") : m);
      return { captchaResult: true, bizResult: false };
    }
  }

  const captcha = useAliyunCaptcha(handlePhoneCaptchaVerify);

  function requestBindCode(e: React.MouseEvent) {
    e.preventDefault();
    if (bindCooldown > 0) return;
    if (!normalizeCnPhone(bindPhone)) {
      setBindCodeMsg(t("login.phoneInvalid"));
      return;
    }
    setBindCodeMsg("");
    if (!captcha.trigger()) {
      setBindCodeMsg(t("login.captchaUnavailable"));
    }
  }

  function update(key: "username" | "password" | "currentPassword") {
    const setters = { username: setUsername, password: setPassword, currentPassword: setCurrentPassword };
    return (event: React.ChangeEvent<HTMLInputElement>) => setters[key](event.target.value);
  }

  async function mergeExisting(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await api<{ profile: Profile }>("/account/link-existing", {
        method: "POST",
        body: JSON.stringify({ identifier: mergeIdentifier, password: mergePassword }),
      });
      setProfile(result.profile);
      setShowMerge(false);
      setMergeIdentifier("");
      setMergePassword("");
      setEditing(null);
      setEmail("");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function bindEmail(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const updated = await api<Profile>("/account/email/bind", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setProfile(updated);
      setEditing(null);
      setEmail("");
    } catch (error) {
      const detail = (error as Error).message;
      if (detail.includes("already bound to another account")) {
        setShowMerge(true);
        setMergeIdentifier(email);
        setMessage(t("accountSettings.mergeHint"));
      } else {
        setMessage(detail);
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveCredentials(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const updated = await api<Profile>("/account/credentials", {
        method: "POST",
        body: JSON.stringify({
          username: username || null,
          password: password || null,
          ...(profile?.has_password ? { current_password: currentPassword } : {}),
        }),
      });
      setProfile(updated);
      setEditing(null);
      setPassword("");
      setCurrentPassword("");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitPhoneBind(event: FormEvent) {
    event.preventDefault();
    const phoneValue = normalizeCnPhone(bindPhone);
    if (!phoneValue) {
      setMessage(t("login.phoneInvalid"));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await api<{ profile: Profile; access_token: string | null }>("/account/phone/bind", {
        method: "POST",
        body: JSON.stringify({ phone: phoneValue, code: bindCode.trim() }),
      });
      const merged = profile != null && result.profile.user.id !== profile.user.id;
      setProfile(result.profile);
      setEditing(null);
      setBindPhone("");
      setBindCode("");
      setBindCodeSent(false);
      if (merged) setMessage(t("accountSettings.phoneBoundMerged"));
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (authState === "loading") {
    return (
      <main className="settings-page">
        <div className="settings-container"><p className="settings-loading">{t("accountSettings.loading")}</p></div>
      </main>
    );
  }

  if (authState === "guest" || !profile) {
    return (
      <main className="settings-page">
        <div className="settings-container">
          <div className="auth-card settings-card">
            <div className="auth-header">
              <div className="brand-mark"><UserCircle2 size={28} /></div>
              <h1>{t("accountSettings.title")}</h1>
              <p className="settings-lead">{t("accountSettings.loginRequired")}</p>
            </div>
            <a className="primary-btn" href="/">{t("accountSettings.goLogin")}</a>
          </div>
        </div>
      </main>
    );
  }


  const hasPhone = profile.identities.some((identity) => identity.provider === "phone");
  const hasWechat = profile.identities.some((identity) => identity.provider === "wechat");
  const otherIdentities = profile.identities.filter(
    (identity) => identity.provider !== "phone" && identity.provider !== "wechat"
  );

  return (
    <main className="settings-page">
      <div className="settings-container">
        <div className="auth-card settings-card settings-hero">
          {profile.user.avatar_url ? (
            <img className="settings-avatar" src={profile.user.avatar_url} alt="" />
          ) : (
            <div className="settings-avatar settings-avatar-fallback"><UserCircle2 size={36} /></div>
          )}
          <div className="settings-hero-text">
            <h1>{profile.user.display_name || t("accountSettings.defaultName")}</h1>
            <p>{t("accountSettings.lead")}</p>
            <p className="settings-hero-meta">{t("accountSettings.accountId")}{profile.user.id}</p>
          </div>
        </div>

        <section className="auth-card settings-card">
          <h2 className="settings-section-title">{t("accountSettings.identities")}</h2>

          {otherIdentities.map((identity) => (
            <div className="credential-row" key={identity.provider}>
              <ProviderIcon provider={identity.provider} />
              <div className="credential-label">
                <strong>{PROVIDER_NAMES[identity.provider] ?? identity.provider}</strong>
              </div>
              <span className="status-badge bound">{t("accountSettings.bound")}</span>
            </div>
          ))}

          <div className="credential-row">
            <ProviderIcon provider="phone" />
            <div className="credential-label">
              <strong>{t("accountSettings.phoneCredential")}</strong>
              <span>{hasPhone ? t("accountSettings.phoneCredentialHintBound") : t("accountSettings.phoneCredentialHintUnbound")}</span>
            </div>
            {hasPhone ? (
              <span className="status-badge bound">{t("accountSettings.bound")}</span>
            ) : editing === "phoneBind" ? (
              <span className="status-badge missing">{t("accountSettings.binding")}</span>
            ) : (
              <button className="text-btn" onClick={() => { setEditing("phoneBind"); setMessage(""); }}>{t("accountSettings.bindPhone")}</button>
            )}
          </div>

          {editing === "phoneBind" && !hasPhone && (
            <form className="inline-form" onSubmit={submitPhoneBind}>
              <label className="field">
                <span>{t("login.phone")}</span>
                <input type="tel" value={bindPhone} onChange={(e) => setBindPhone(e.target.value)} placeholder={t("login.phonePlaceholder")} autoComplete="tel" inputMode="tel" maxLength={20} required />
              </label>
              <label className="field">
                <span>{t("login.code")}</span>
                <OtpInput value={bindCode} onChange={setBindCode} />
                <div className="otp-meta">
                  <span className="otp-hint">{bindCodeSent ? t("login.noCode") : ""}</span>
                  <button type="button" className="text-btn send-code-link" onClick={requestBindCode} disabled={busy || !bindPhone || bindCooldown > 0}>
                    {bindCooldown > 0 ? t("login.resendIn", { seconds: bindCooldown }) : bindCodeSent ? t("login.resend") : t("login.sendCode")}
                  </button>
                </div>
                {bindCodeMsg && <span className="field-msg">{bindCodeMsg}</span>}
              </label>
              <p className="field-msg">{t("accountSettings.phoneCredentialHintUnbound")}</p>
              <button className="primary-btn" type="submit" disabled={busy}>{busy ? t("accountSettings.working") : t("accountSettings.confirmBind")}</button>
            </form>
          )}

          <div className="credential-row">
            <ProviderIcon provider="wechat" />
            <div className="credential-label">
              <strong>{t("accountSettings.wechatCredential")}</strong>
              <span>{hasWechat ? t("accountSettings.wechatBoundHint") : t("accountSettings.wechatBindHint")}</span>
            </div>
            {hasWechat ? (
              <span className="status-badge bound">{t("accountSettings.bound")}</span>
            ) : (
              <a className="text-btn" href={`${API_BASE}/account/wechat/bind/start`}>{t("accountSettings.bindWechat")}</a>
            )}
          </div>

          <div className="credential-row">
            <ProviderIcon provider="email" />
            <div className="credential-label">
              <strong>{t("accountSettings.emailCredential")}</strong>
              {profile.user.email ? (
                <span>{profile.user.email}</span>
              ) : (
                <span>{t("accountSettings.emailHint")}</span>
              )}
            </div>
            {profile.user.email ? (
              <span className="status-badge bound">{t("accountSettings.bound")}</span>
            ) : editing === "email" ? (
              <span className="status-badge missing">{t("accountSettings.binding")}</span>
            ) : (
              <button className="text-btn" onClick={() => { setEditing("email"); setMessage(""); }}>{t("accountSettings.bindEmail")}</button>
            )}
          </div>

          {editing === "email" && !profile.user.email && (
            <form className="inline-form" onSubmit={bindEmail}>
              <label className="field">
                <span>{t("accountSettings.email")}</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="m@example.com" autoComplete="email" required />
              </label>
              <p className="field-msg">{t("accountSettings.emailHint")}</p>
              <button className="primary-btn" type="submit" disabled={busy}>{busy ? t("accountSettings.working") : t("accountSettings.confirmBind")}</button>
            </form>
          )}

          {editing === "email" && !profile.user.email && showMerge && (
            <form className="inline-form merge-form" onSubmit={mergeExisting}>
              <h3 className="settings-section-title">{t("accountSettings.mergeTitle")}</h3>
              <label className="field">
                <span>{t("accountSettings.mergeIdentifier")}</span>
                <input value={mergeIdentifier} onChange={(e) => setMergeIdentifier(e.target.value)} autoComplete="username" required />
              </label>
              <label className="field">
                <span>{t("accountSettings.mergePassword")}</span>
                <input type="password" value={mergePassword} onChange={(e) => setMergePassword(e.target.value)} autoComplete="current-password" required />
              </label>
              <button className="primary-btn" type="submit" disabled={busy}>{busy ? t("accountSettings.working") : t("accountSettings.mergeSubmit")}</button>
            </form>
          )}

          <div className="credential-row">
            <div className="credential-icon"><KeyRound size={18} /></div>
            <div className="credential-label">
              <strong>{t("accountSettings.passwordCredential")}</strong>
              <span>{profile.has_password ? t("accountSettings.passwordSetHint") : t("accountSettings.passwordHint")}</span>
            </div>
            {editing === "credentials" ? (
              <span className="status-badge missing">{t("accountSettings.editing")}</span>
            ) : (
              <button className="text-btn" onClick={() => { setEditing("credentials"); setMessage(""); }}>
                {profile.has_password ? t("accountSettings.changePassword") : t("accountSettings.setPassword")}
              </button>
            )}
          </div>

          {editing === "credentials" && (
            <form className="inline-form" onSubmit={saveCredentials}>
              <label className="field">
                <span>{t("accountSettings.username")}</span>
                <input value={username} onChange={update("username")} placeholder={t("accountSettings.usernamePlaceholder")} autoComplete="username" />
              </label>
              <label className="field">
                <span>{t("accountSettings.newPassword")}</span>
                <div className="pwd-wrap">
                  <input type={showPassword ? "text" : "password"} value={password} onChange={update("password")} placeholder={t("accountSettings.passwordPlaceholder")} autoComplete="new-password" />
                  <button type="button" className="pwd-toggle" onClick={() => setShowPassword(!showPassword)} aria-label="toggle password">
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
              {profile.has_password && (
                <label className="field">
                  <span>{t("accountSettings.currentPassword")}</span>
                  <input type="password" value={currentPassword} onChange={update("currentPassword")} autoComplete="current-password" required />
                </label>
              )}
              <button className="primary-btn" type="submit" disabled={busy}>{busy ? t("accountSettings.working") : t("accountSettings.saveCredentials")}</button>
            </form>
          )}
        </section>

        {message && <p className="msg settings-msg">{message}</p>}
        <p className="settings-footer">
          <CheckCircle2 size={14} /> {t("accountSettings.footer")}
        </p>
        <a className="text-btn settings-signout" href="/api/auth/logout">{t("accountSettings.signOut")}</a>
      </div>

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
