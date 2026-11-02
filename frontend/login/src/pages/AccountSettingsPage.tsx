import React, { useEffect, useState, type FormEvent } from "react";
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
import { api } from "../lib/utils";
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

type Section = "email" | "credentials" | "phone" | null;

function ProviderIcon({ provider }: { provider: string }) {
  const cls = provider === "wechat" ? "credential-icon wechat" : "credential-icon";
  if (provider === "wechat") return <div className={cls}><FaWeixin size={18} /></div>;
  if (provider === "google") return <div className={cls}><GoogleIcon size={18} /></div>;
  if (provider === "github") return <div className={cls}><GithubIcon size={18} /></div>;
  if (provider === "email") return <div className={cls}><Mail size={18} /></div>;
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
  const [codeMessage, setCodeMessage] = useState("");
  const [cooldown, setCooldown] = useState(0);

  async function handleCaptchaVerify(captchaVerifyParam: string) {
    try {
      await api("/account/email/send-code", {
        method: "POST",
        body: JSON.stringify({ email, captcha_verify_param: captchaVerifyParam }),
      });
      setCodeMessage(t("accountSettings.codeSent"));
      setCooldown(60);
      return { captchaResult: true, bizResult: true };
    } catch (error) {
      const detail = (error as Error).message;
      if (detail.includes("already bound to another account")) {
        setShowMerge(true);
        setMergeIdentifier(email);
        setMessage(t("accountSettings.mergeHint"));
        return { captchaResult: true, bizResult: false };
      }
      if (detail.includes("Captcha verification failed")) {
        return { captchaResult: false, bizResult: false };
      }
      setMessage(detail);
      return { captchaResult: true, bizResult: false };
    }
  }

  const captcha = useAliyunCaptcha(handleCaptchaVerify);

  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [showMerge, setShowMerge] = useState(false);
  const [mergeIdentifier, setMergeIdentifier] = useState("");
  const [mergePassword, setMergePassword] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState("");

  useEffect(() => {
    api<Profile>("/account/profile")
      .then((data) => {
        setProfile(data);
        setAuthState("ready");
        setUsername(data.user.username ?? "");
        setPhone(data.user.contact_phone ?? "");
      })
      .catch(() => setAuthState("guest"));
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((v) => v - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  function update(key: "emailCode" | "username" | "password" | "currentPassword" | "phone") {
    const setters = { emailCode: setEmailCode, username: setUsername, password: setPassword, currentPassword: setCurrentPassword, phone: setPhone };
    return (event: React.ChangeEvent<HTMLInputElement>) => setters[key](event.target.value);
  }

  function requestEmailCode() {
    if (!email || cooldown > 0) return;
    if (!captcha.trigger()) {
      setMessage(t("accountSettings.captchaUnavailable"));
    }
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
      setEmailCode("");
      setCodeMessage("");
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
        body: JSON.stringify({ email, code: emailCode }),
      });
      setProfile(updated);
      setEditing(null);
      setEmail("");
      setEmailCode("");
      setCodeMessage("");
    } catch (error) {
      setMessage((error as Error).message);
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

  async function savePhone(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const updated = await api<Profile>("/account/credentials", {
        method: "POST",
        body: JSON.stringify({ contact_phone: phone || null }),
      });
      setProfile(updated);
      setEditing(null);
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

  
  const otherIdentities = profile.identities;

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
            <ProviderIcon provider="email" />
            <div className="credential-label">
              <strong>{t("accountSettings.emailCredential")}</strong>
              {profile.user.email ? (
                <span>{profile.user.email}{profile.user.email_verified ? "" : ` · ${t("accountSettings.unverified")}`}</span>
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
              <label className="field">
                <span>{t("accountSettings.code")}</span>
                <div className="code-row">
                  <input value={emailCode} onChange={update("emailCode")} maxLength={6} placeholder={t("accountSettings.codePlaceholder")} required />
                  <button type="button" className="send-code-btn inline" onClick={requestEmailCode} disabled={busy || cooldown > 0}>
                    {cooldown > 0 ? `${cooldown}s` : t("accountSettings.sendCode")}
                  </button>
                  {codeMessage && <p className="field-msg">{codeMessage}</p>}
                </div>
              </label>
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

        <section className="auth-card settings-card">
          <h2 className="settings-section-title">{t("accountSettings.contact")}</h2>
          <div className="credential-row">
            <div className="credential-icon"><Smartphone size={18} /></div>
            <div className="credential-label">
              <strong>{t("accountSettings.phone")}</strong>
              <span>{profile.user.contact_phone || t("accountSettings.phoneHint")}</span>
            </div>
            {editing === "phone" ? (
              <span className="status-badge missing">{t("accountSettings.editing")}</span>
            ) : (
              <button className="text-btn" onClick={() => { setEditing("phone"); setMessage(""); }}>
                {profile.user.contact_phone ? t("accountSettings.edit") : t("accountSettings.add")}
              </button>
            )}
          </div>
          {editing === "phone" && (
            <form className="inline-form" onSubmit={savePhone}>
              <label className="field">
                <span>{t("accountSettings.phone")}</span>
                <input type="tel" value={phone} onChange={update("phone")} placeholder="+8613800138000" autoComplete="tel" />
              </label>
              <button className="primary-btn" type="submit" disabled={busy}>{busy ? t("accountSettings.working") : t("accountSettings.save")}</button>
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
