import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Copy, ShieldCheck, Zap, Users, Globe, Lock } from "lucide-react";

const slideConfigs = [
  { icon: ShieldCheck, titleKey: "slide1Title", descKey: "slide1Desc" },
  { icon: Zap, titleKey: "slide2Title", descKey: "slide2Desc" },
  { icon: Users, titleKey: "slide3Title", descKey: "slide3Desc" },
  { icon: Globe, titleKey: "slide4Title", descKey: "slide4Desc" },
  { icon: Lock, titleKey: "slide5Title", descKey: "slide5Desc" },
];

export default function Showcase() {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(0);
  const next = useCallback(() => setIdx((i) => (i + 1) % slideConfigs.length), []);

  useEffect(() => {
    const timer = setInterval(next, 4000);
    return () => clearInterval(timer);
  }, [next]);

  return (
    <section className="showcase-side" aria-label={t("showcase.slide1Title")}>
      <div className="showcase">
        <div className="carousel">
          <div className="carousel-slides">
            {slideConfigs.map((s, i) => (
              <div
                key={i}
                className={`carousel-slide ${i === idx ? "active" : ""}`}
              >
                <div className="slide-icon-wrap">
                  <s.icon size={22} />
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
