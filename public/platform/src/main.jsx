import React from "react";
import ReactDOM from "react-dom/client";
import PlatformApp from "./platform-ui/PlatformApp.jsx";
import "./platform-ui/styles/global.scss";

const rootElement = document.getElementById("root");

function installMobileZoomGuards() {
  const preventGesture = (event) => {
    event.preventDefault();
  };

  const preventMultiTouchZoom = (event) => {
    if (event.touches.length > 1) {
      event.preventDefault();
    }
  };

  document.addEventListener("gesturestart", preventGesture, { passive: false });
  document.addEventListener("gesturechange", preventGesture, { passive: false });
  document.addEventListener("gestureend", preventGesture, { passive: false });
  document.addEventListener("touchmove", preventMultiTouchZoom, { passive: false });
}

installMobileZoomGuards();

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <PlatformApp />
    </React.StrictMode>,
  );
}
