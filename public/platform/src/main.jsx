import React from "react";
import ReactDOM from "react-dom/client";
import PlatformApp from "./platform-ui/PlatformApp.jsx";
import "./platform-ui/styles/global.scss";

const rootElement = document.getElementById("root");

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <PlatformApp />
    </React.StrictMode>,
  );
}
