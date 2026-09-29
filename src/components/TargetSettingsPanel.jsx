import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../styles/target-settings.css";

export default function TargetSettingsPanel({ targets, onSave, onClose }) {
  const [draft, setDraft] = useState(() => ({
    dm: { ...targets.dm },
    range: { ...targets.range },
  }));
  const [closing, setClosing] = useState(false);
  const closeButtonRef = useRef(null);
  const closeTimerRef = useRef(0);

  const requestClose = useCallback(() => {
    if (closeTimerRef.current) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(onClose, 160);
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") requestClose();
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      window.clearTimeout(closeTimerRef.current);
    };
  }, [requestClose]);

  const update = (section, key, value) => {
    setDraft((current) => ({
      ...current,
      [section]: { ...current[section], [key]: Number(value) || 0 },
    }));
  };

  const submit = (event) => {
    event.preventDefault();
    onSave(draft);
  };

  return createPortal(
    <div className={`settings-backdrop${closing ? " is-closing" : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <form className="target-settings-panel cut-corner" onSubmit={submit} role="dialog" aria-modal="true" aria-label="Target settings">
        <header className="target-settings-head">
          <div><span>MANAGER CONFIGURATION</span><h2>TARGET SETTINGS</h2></div>
          <button ref={closeButtonRef} className="target-settings-x" type="button" onClick={requestClose} aria-label="Close target settings">X</button>
        </header>

        <div className="target-settings-fields">
          <label>DM MATCHES REQUIRED<input type="number" min="1" value={draft.dm.matchesRequired} onChange={(event) => update("dm", "matchesRequired", event.target.value)} /></label>
          <label>TOP PLACEMENT LIMIT<input type="number" min="1" value={draft.dm.placementLimit} onChange={(event) => update("dm", "placementLimit", event.target.value)} /></label>
          <label>RANGE ROUNDS REQUIRED<input type="number" min="1" value={draft.range.roundsRequired} onChange={(event) => update("range", "roundsRequired", event.target.value)} /></label>
          <label>RANGE MINIMUM SCORE<input type="number" min="0" max="30" value={draft.range.minScore} onChange={(event) => update("range", "minScore", event.target.value)} /></label>
        </div>

        <footer className="target-settings-actions">
          <button className="settings-cancel" type="button" onClick={requestClose}>CANCEL</button>
          <button className="btn-primary" type="submit">SAVE CHANGES</button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
