import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { getLive } from "./data/live";
import "./index.css";

getLive();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
