import { useEffect, useState } from "react";
import { getScreenshot } from "../services/storageService.js";

export default function ScreenshotPreview({ screenshotKey, onOpen }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setUrl("");
    getScreenshot(screenshotKey)
      .then((entry) => {
        if (!active || !entry?.blob) return;
        objectUrl = URL.createObjectURL(entry.blob);
        setUrl(objectUrl);
      })
      .catch(() => { if (active) setUrl(""); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [screenshotKey]);

  return url ?
    <button className="shot-button" type="button" onClick={(event) => { event.stopPropagation(); onOpen?.(); }} aria-label="Open full-screen match evidence">
      <img className="shot" src={url} alt="Match evidence" />
    </button>
    : <div className="shot shot-empty">SCREENSHOT UNAVAILABLE</div>;
}
