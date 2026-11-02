import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Link2, ShieldCheck, UserRound } from "lucide-react";
import Showcase from "../components/Showcase";
import OtpInput from "../components/OtpInput";
import { api, redirectUriSchema, safeRedirect, normalizeCnPhone } from "../lib/utils";
import { useAliyunCaptcha } from "../lib/aliyunCaptcha";

type SetupContext = {
  provider: string;
  display_name: string | null;
  avatar_url: string | null;
  application_name: string;
  client_id: string;
};

export default function AccountCompletePage() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [context, setContext] = useState<SetupContext | null>(null);
  const [mode, setMode] = useState<"new" | "link">("new");
  const [form, setForm] = useState({ phone: "", code: "", username: "", password: "", identifier: "", existingPassword: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [codeMsg, setCodeMsg] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const phoneRef = useRef(form.phone);
  phoneRef.current = form.phone;
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    if (!token) {
      setMessage("账号完善链接无效，请重新发起微信登录。");
      return;
    }
    api<SetupContext>(`/auth/account-setup?token=${encodeURIComponent(token)}`)
      .then(setContext)
      .catch((error) => setMessage((error as Error).message));
  }, [token]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function update(key: keyof typeof form) {
    return (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  }

  async function handleCaptchaVerify(captchaVerifyParam: string) {
    const phoneValue = normalizeCnPhone(phoneRef.current);
    if (!phoneValue) {
      setCodeMsg("请输入正确的 11 位手机号");
      return { captchaResult: true, bizResult: false };
    }
    if (!contextRef.current) return { captchaResult: true, bizResult: false };
    try {
      const r = await api<{ sent: boolean; debug_code?: string }>("/auth/sms/request-code", {
        method: "POST",
        body: JSON.stringify({
          client_id: contextRef.current.client_id,
          phone: phoneValue,
          purpose: "bind_phone",
          captcha_verify_param: captchaVerifyParam,
        }),
      });
      if (import.meta.env.DEV && r.debug_code) setCodeMsg(`DEV: ${r.debug_code}`);
      setCodeSent(true);
      setCodeMsg("");
      setCooldown(60);
      return { captchaResult: true, bizResult: true };
    } catch (error) {
      const m = (error as Error).message;
      if (m.includes("Captcha verification failed")) {
        return { captchaResult: false, bizResult: false };
      }
      setCodeMsg(m.includes("rate limit") || m.includes("Too Many") ? "发送过于频繁，请稍后再试" : m);
      return { captchaResult: true, bizResult: false };
    }
  }

  const captcha = useAliyunCaptcha(handleCaptchaVerify);

  function requestCode(e: React.MouseEvent) {
    e.preventDefault();
    if (cooldown > 0) return;
    if (!normalizeCnPhone(form.phone)) {
      setCodeMsg("请输入正确的 11 位手机号");
      return;
    }
    setCodeMsg("");
    if (!captcha.trigger()) {
      setCodeMsg("人机验证暂不可用，请稍后再试");
    }
  }

  async function finish(selectedMode: "new" | "link" | "skip") {
    setLoading(true);
    setMessage("");
    try {
      const result = await api<{ redirect_uri: string }>("/auth/account-setup", {
        method: "POST",
        body: JSON.stringify({
          token,
          mode: selectedMode,
          phone: selectedMode === "new" ? normalizeCnPhone(form.phone) || null : null,
          code: selectedMode === "new" ? form.code.trim() || null : null,
          username: selectedMode === "new" ? form.username || null : null,
          password: selectedMode === "new" ? form.password || null : null,
          identifier: selectedMode === "link" ? form.identifier : null,
          existing_password: selectedMode === "link" ? form.existingPassword : null,
        }),
      });
      const parsed = redirectUriSchema.safeParse(result);
      if (parsed.success) safeRedirect(parsed.data.redirect_uri);
      else setMessage("业务系统回调地址无效");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function submitNew(event: React.FormEvent) {
    event.preventDefault();
    if (!normalizeCnPhone(form.phone)) {
      setMessage("请输入正确的 11 位手机号");
      return;
    }
    if (!form.code.trim()) {
      setMessage("请输入验证码");
      return;
    }
    void finish("new");
  }

  return (
    <main className="shell">
      <Showcase />
      <section className="auth-side account-setup-side">
        <div className="auth-card account-setup-card">
          <div className="auth-header">
            <div className="brand-mark"><ShieldCheck size={28} /></div>
            <h1>完善 Passport 账号</h1>
            {context && <p className="setup-lead">微信身份已验证，完成后继续访问「{context.application_name}」</p>}
          </div>

          <div className="setup-steps" aria-hidden="true">
            <span className="step done"><CheckCircle2 size={14} /> 微信验证</span>
            <span className="step-line" />
            <span className="step current"><UserRound size={14} /> 绑定手机号</span>
          </div>

          {context?.display_name && (
            <div className="provider-confirmation">
              {context.avatar_url ? <img src={context.avatar_url} alt="微信头像" /> : <CheckCircle2 size={22} />}
              <div><strong>{context.display_name}</strong><span>微信身份已确认</span></div>
            </div>
          )}

          <div className="setup-tabs" role="tablist">
            <button className={mode === "new" ? "active" : ""} onClick={() => setMode("new")}>完善新账号</button>
            <button className={mode === "link" ? "active" : ""} onClick={() => setMode("link")}>绑定已有账号</button>
          </div>

          {mode === "new" ? (
            <form onSubmit={submitNew}>
              <p className="field-group-title">绑定手机号</p>
              <label className="field"><span>手机号</span><input type="tel" value={form.phone} onChange={update("phone")} placeholder="请输入手机号" autoComplete="tel" inputMode="tel" maxLength={20} required /></label>
              <label className="field"><span>验证码</span><OtpInput value={form.code} onChange={(value) => setForm((current) => ({ ...current, code: value }))} />
                <div className="otp-meta">
                  <span className="otp-hint">{codeSent ? "没收到验证码？" : ""}</span>
                  <button type="button" className="text-btn send-code-link" onClick={requestCode} disabled={loading || !form.phone || cooldown > 0}>
                    {cooldown > 0 ? `${cooldown}s 后重发` : codeSent ? "重新发送" : "发送验证码"}
                  </button>
                </div>
                {codeMsg && <span className="field-msg">{codeMsg}</span>}
              </label>
              <p className="field-hint">若该手机号已注册，验证后将把微信并入该账号。</p>
              <p className="field-group-title">设置用户名和密码（可选）</p>
              <label className="field"><span>用户名（可选）</span><input value={form.username} onChange={update("username")} placeholder="3-64 位字母、数字、下划线或连字符" autoComplete="username" /></label>
              <label className="field"><span>密码（设置用户名时必填）</span><div className="pwd-wrap"><input type={showPassword ? "text" : "password"} value={form.password} onChange={update("password")} placeholder="至少 8 位，包含三类字符" autoComplete="new-password" /><button type="button" className="pwd-toggle" onClick={() => setShowPassword(!showPassword)} aria-label="显示或隐藏密码">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
              <button className="primary-btn" type="submit" disabled={loading}>{loading ? "处理中…" : "保存并继续"}</button>
              <button className="skip-btn" type="button" onClick={() => void finish("skip")} disabled={loading}>暂时跳过，仅使用微信登录</button>
              <p className="skip-hint">跳过后仍可随时在 Passport 账号设置中补全</p>
            </form>
          ) : (
            <form onSubmit={(event) => { event.preventDefault(); void finish("link"); }}>
              <div className="link-note"><Link2 size={18} /><span>验证现有账号后，微信将成为该账号的新登录方式。</span></div>
              <label className="field"><span>用户名或邮箱</span><input value={form.identifier} onChange={update("identifier")} required autoComplete="username" /></label>
              <label className="field"><span>现有密码</span><input type="password" value={form.existingPassword} onChange={update("existingPassword")} required autoComplete="current-password" /></label>
              <button className="primary-btn" type="submit" disabled={loading}>{loading ? "验证中…" : "验证并绑定"}</button>
            </form>
          )}
          {message && <p className="msg">{message}</p>}
        </div>
      </section>

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
