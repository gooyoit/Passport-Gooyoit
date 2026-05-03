import { useState } from "react";
import { api } from "../lib/utils";

export function useCaptcha() {
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
      if (import.meta.env.DEV && r.captcha_answer) setCaptchaAnswer(r.captcha_answer);
      setCaptchaError("");
    } catch (err) {
      setCaptchaError((err as Error).message || "获取验证码失败");
    }
  }

  return {
    captchaKey,
    captchaImage,
    captchaAnswer,
    setCaptchaAnswer,
    showCaptchaModal,
    setShowCaptchaModal,
    captchaError,
    setCaptchaError,
    fetchCaptcha,
  };
}
