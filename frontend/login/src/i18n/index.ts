import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "./zh.json";
import en from "./en.json";

const lang = navigator.language.startsWith("zh") ? "zh" : "en";

i18next.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: lang,
  fallbackLng: "zh",
  interpolation: { escapeValue: false },
});

document.title = i18next.t("login.title");

export default i18next;
