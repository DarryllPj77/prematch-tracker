import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getScreenshot } from "../services/storageService.js";
import "../styles/screenshot-modal.css";

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "TIME UNAVAILABLE";
  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function ScreenshotModal({ preview, onClose }) {
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const closeButtonRef = useRef(null);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setImageUrl("");
    setLoading(true);

    getScreenshot(preview.screenshotKey)
      .then((entry) => {
        if (!active) return;
        if (entry?.blob) {
          objectUrl = URL.createObjectURL(entry.blob);
          setImageUrl(objectUrl);
        }
      })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [preview.screenshotKey]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const openDedicatedWindow = () => {
    if (!imageUrl) return;
    window.open(
      imageUrl,
      "prematch-proof-window",
      "popup=yes,width=1280,height=720,toolbar=no,menubar=no,location=no,status=no,scrollbars=yes,resizable=yes",
    );
  };

  return createPortal(
    <div
      className="screenshot-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section className="screenshot-modal-dialog" role="dialog" aria-modal="true" aria-label={`${preview.playerName} proof screenshot`}>
        <header className="screenshot-modal-header">
          <div className="screenshot-modal-identity">
            <span>TACTICAL PROOF INSPECTOR</span>
            <h2>{preview.playerName}</h2>
          </div>
          <div className="screenshot-modal-status">
            <span>{formatTimestamp(preview.submittedAt)}</span>
            <strong className={preview.passed ? "is-pass" : "is-fail"}>{preview.passed ? "PASS" : "FAIL"}</strong>
          </div>
          <button ref={closeButtonRef} className="screenshot-modal-close" type="button" onClick={onClose} aria-label="Close proof viewer">
            <span aria-hidden="true">X</span> CLOSE
          </button>
        </header>

        <div className="screenshot-modal-scores">
          <span>DM PLACEMENTS <strong>{preview.dmResults.join(" / ") || "--"}</strong></span>
          <span>RANGE SCORES <strong>{preview.rangeResults.join(" / ") || "--"}</strong></span>
        </div>

        <div className="screenshot-modal-stage">
          {loading && <div className="screenshot-modal-message">LOADING FULL-RESOLUTION PROOF...</div>}
          {!loading && imageUrl && <img src={imageUrl} alt={`${preview.playerName} full-resolution warm-up proof`} />}
          {!loading && !imageUrl && <div className="screenshot-modal-message is-expired">SCREENSHOT EXPIRED</div>}
        </div>

        <footer className="screenshot-modal-footer">
          <span>ESC TO CLOSE / CLICK OUTSIDE FRAME</span>
          <button type="button" onClick={openDedicatedWindow} disabled={!imageUrl}>OPEN IN DEDICATED WINDOW</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
