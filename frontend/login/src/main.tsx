import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import "./i18n";
import "./styles.css";

function App() {
  const [view, setView] = useState<"login" | "register">("login");
  return view === "register" ? (
    <RegisterPage onSwitch={setView} />
  ) : (
    <LoginPage onSwitch={setView} />
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
