import React from "react";
import { createRoot } from "react-dom/client";
import LoginPage from "./pages/LoginPage";
import AccountCompletePage from "./pages/AccountCompletePage";
import "./i18n";
import "./styles.css";

function App() {
  if (window.location.pathname === "/account/complete") {
    return <AccountCompletePage />;
  }
  return <LoginPage />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
