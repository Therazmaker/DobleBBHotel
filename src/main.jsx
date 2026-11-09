import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(<App />);

if ("serviceWorker" in navigator && import.meta.env.PROD && import.meta.env.MODE !== "static") {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}
