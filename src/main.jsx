import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

// Incrustada en otro sitio (p. ej. un visor), la impresión no está disponible.
try {
  if (window.self !== window.top) document.documentElement.classList.add("embedded");
} catch {
  document.documentElement.classList.add("embedded");
}

createRoot(document.getElementById("root")).render(<App />);

if ("serviceWorker" in navigator && import.meta.env.PROD && import.meta.env.MODE !== "static") {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}
