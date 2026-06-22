import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/app";
import { configureMonacoEditor } from "./shared/monaco-editor-setup";

configureMonacoEditor();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
