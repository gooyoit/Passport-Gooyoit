import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface CaptchaVerifyResult {
  captchaResult: boolean;
  bizResult?: boolean;
}

type VerifyCallback = (captchaVerifyParam: string) => Promise<CaptchaVerifyResult>;

declare global {
  interface Window {
    AliyunCaptchaConfig?: { region: string; prefix: string };
    initAliyunCaptcha?: (options: Record<string, unknown>) => void;
  }
}

const SCENE_ID = import.meta.env.VITE_ALIYUN_CAPTCHA_SCENE_ID as string | undefined;
const PREFIX = import.meta.env.VITE_ALIYUN_CAPTCHA_PREFIX as string | undefined;
const REGION = (import.meta.env.VITE_ALIYUN_CAPTCHA_REGION as string | undefined) ?? "cn";
const SDK_URL = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";

export function captchaConfigured(): boolean {
  return Boolean(SCENE_ID && PREFIX);
}

let sdkPromise: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (window.initAliyunCaptcha) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    window.AliyunCaptchaConfig = { region: REGION, prefix: PREFIX! };
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error("captcha sdk failed to load"));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

/**
 * Bind the Aliyun Captcha 2.0 popup to a hidden trigger button. Call
 * trigger() after local validation to pop the widget; the verify callback
 * runs the real business request and reports captcha/biz results back so
 * the widget can show success or retry UI on its own.
 */
export function useAliyunCaptcha(verify: VerifyCallback) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const verifyRef = useRef(verify);
  verifyRef.current = verify;
  const { i18n } = useTranslation();
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!captchaConfigured()) {
      setUnavailable(true);
      return;
    }
    let cancelled = false;
    loadSdk()
      .then(() => {
        if (cancelled) return;
        window.initAliyunCaptcha!({
          SceneId: SCENE_ID,
          mode: "popup",
          element: "#aliyun-captcha-element",
          button: "#aliyun-captcha-trigger",
          captchaVerifyCallback: (captchaVerifyParam: string) =>
            verifyRef.current(captchaVerifyParam),
          onBizResultCallback: () => {},
          getInstance: () => {},
          slideStyle: { width: 320, height: 40 },
          language: i18n.language?.startsWith("zh") ? "cn" : "en",
        });
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function trigger(): boolean {
    if (!ready || !triggerRef.current) return false;
    triggerRef.current.click();
    return true;
  }

  return { triggerRef, trigger, unavailable };
}
