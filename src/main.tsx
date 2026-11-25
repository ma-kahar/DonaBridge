import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./i18n";
import "./styles/global.css";

// Forward uncaught UI errors to the console/log stream so they are visible in
// development and in the diagnostics bundle.
window.addEventListener("error", (event) => {
  console.error("Uncaught UI error:", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled UI rejection:", event.reason);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
