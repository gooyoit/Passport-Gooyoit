import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

type LegalKind = "tos" | "privacy";
type Section = { h: string; p: string | string[] };

export default function LegalModal({
  kind,
  onClose,
}: {
  kind: LegalKind;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const sections = t(`legal.${kind}.sections`, {
    returnObjects: true,
  }) as Section[];

  return (
    <div className="legal-overlay" onClick={onClose}>
      <div
        className="legal-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t(`legal.${kind}.title`)}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="legal-head">
          <h2>{t(`legal.${kind}.title`)}</h2>
          <button
            ref={closeRef}
            type="button"
            className="legal-close"
            onClick={onClose}
            aria-label={t("legal.close")}
          >
            <X size={18} />
          </button>
        </header>
        <div className="legal-body">
          <p className="legal-updated">{t(`legal.${kind}.updated`)}</p>
          {Array.isArray(sections) &&
            sections.map((s, i) => (
              <section key={i}>
                <h3>{s.h}</h3>
                {(Array.isArray(s.p) ? s.p : [s.p]).map((para, j) => (
                  <p key={j}>{para}</p>
                ))}
              </section>
            ))}
        </div>
        <footer className="legal-foot">
          <button type="button" className="primary-btn" onClick={onClose}>
            {t("legal.close")}
          </button>
        </footer>
      </div>
    </div>
  );
}
