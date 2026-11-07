import React, { useRef } from "react";
import { useTranslation } from "react-i18next";

const LENGTH = 6;

export default function OtpInput({
  value,
  onChange,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] ?? "");

  function focusAt(index: number) {
    refs.current[Math.min(LENGTH - 1, Math.max(0, index))]?.focus();
  }

  function writeDigits(start: number, input: string) {
    const incoming = input.replace(/\D/g, "");
    if (!incoming) return;
    const arr = digits.slice();
    for (let k = 0; k < incoming.length && start + k < LENGTH; k++) {
      arr[start + k] = incoming[k];
    }
    onChange(arr.join("").slice(0, LENGTH));
    focusAt(start + incoming.length);
  }

  function handleInput(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.currentTarget.value;
    // Select-all replacement or typed character both land here.
    if (raw.replace(/\D/g, "")) {
      writeDigits(index, raw);
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[index]) {
        const arr = digits.slice();
        arr[index] = "";
        onChange(arr.join(""));
      } else if (index > 0) {
        const arr = digits.slice();
        arr[index - 1] = "";
        onChange(arr.join(""));
        focusAt(index - 1);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusAt(index - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusAt(index + 1);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    writeDigits(0, e.clipboardData.getData("text"));
  }

  return (
    <div className="otp-row" role="group" aria-label={t("login.code")}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="otp-cell"
          type="text"
          name="otp-code"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          spellCheck={false}
          value={digit}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => handleInput(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={t("login.codeDigit", { index: i + 1 })}
        />
      ))}
    </div>
  );
}
