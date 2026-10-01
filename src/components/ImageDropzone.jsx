import { useEffect, useId, useRef, useState } from "react";

export default function ImageDropzone({
  value,
  onChange,
  loadPreview,
  disabled = false,
  resetKey,
  label = "screenshot",
}) {
  const inputId = useId();
  const inputRef = useRef(null);
  const previewUrlRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");

  const replacePreviewUrl = (nextUrl) => {
    if (previewUrlRef.current?.startsWith("blob:")) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = nextUrl;
    setPreviewUrl(nextUrl);
  };

  useEffect(() => {
    let active = true;

    async function restorePreview() {
      if (!value || !loadPreview) {
        replacePreviewUrl("");
        return;
      }

      try {
        const preview = await loadPreview(value);
        if (!active || !preview) return;
        replacePreviewUrl(typeof preview === "string" ? preview : URL.createObjectURL(preview));
      } catch {
        if (active) setError("Preview unavailable");
      }
    }

    restorePreview();
    return () => { active = false; };
  }, [value, loadPreview]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.value = "";
  }, [resetKey]);

  useEffect(() => () => {
    if (previewUrlRef.current?.startsWith("blob:")) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const selectImage = async (file) => {
    if (disabled || isBusy || !file) return;
    if (!file.type.startsWith("image/")) {
      setError("Images only");
      return;
    }

    setError("");
    setIsBusy(true);
    try {
      await onChange(file);
      replacePreviewUrl(URL.createObjectURL(file));
    } catch {
      setError("Upload failed. Try again.");
    } finally {
      setIsBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const openFilePicker = () => {
    if (!disabled && !isBusy) inputRef.current?.click();
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openFilePicker();
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    selectImage(Array.from(event.dataTransfer.files).find((file) => file.type.startsWith("image/")));
  };

  const handlePaste = (event) => {
    const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith("image/"));
    if (!image) return;
    event.preventDefault();
    selectImage(image);
  };

  const removeImage = async (event) => {
    event.stopPropagation();
    if (disabled || isBusy) return;
    setError("");
    setIsBusy(true);
    try {
      await onChange(null);
      replacePreviewUrl("");
    } catch {
      setError("Could not remove image.");
    } finally {
      setIsBusy(false);
    }
  };

  return <div
    className={`image-dropzone${isDragging ? " is-dragging" : ""}${previewUrl ? " has-preview" : ""}${disabled ? " is-disabled" : ""}`}
    role="button"
    tabIndex={disabled ? -1 : 0}
    aria-label={`Upload ${label}`}
    aria-disabled={disabled}
    aria-busy={isBusy}
    onClick={openFilePicker}
    onKeyDown={handleKeyDown}
    onPaste={handlePaste}
    onDragEnter={(event) => {
      event.preventDefault();
      if (!disabled) setIsDragging(true);
    }}
    onDragOver={(event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      if (!disabled) setIsDragging(true);
    }}
    onDragLeave={(event) => {
      event.preventDefault();
      if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false);
    }}
    onDrop={handleDrop}
  >
    <input
      id={inputId}
      ref={inputRef}
      className="image-dropzone-input"
      type="file"
      accept="image/*"
      disabled={disabled || isBusy}
      onChange={(event) => selectImage(event.target.files?.[0])}
      tabIndex={-1}
    />

    {previewUrl ? <>
      <img className="image-dropzone-preview" src={previewUrl} alt={`${label} preview`} />
      {!disabled && <button
        className="image-dropzone-remove"
        type="button"
        aria-label={`Remove ${label}`}
        disabled={isBusy}
        onClick={removeImage}
      >✕</button>}
      <span className="image-dropzone-replace">{isBusy ? "PROCESSING..." : disabled ? "SCREENSHOT LOCKED" : "CLICK, DROP, OR PASTE TO REPLACE"}</span>
    </> : <div className="image-dropzone-prompt">
      <span className="image-dropzone-icon" aria-hidden="true">+</span>
      <strong>{isBusy ? "PROCESSING SCREENSHOT..." : "Drag & Drop screenshot, Paste (Ctrl+V), or Click to browse."}</strong>
      <small>{error || "PNG, JPG, WEBP"}</small>
    </div>}

    {previewUrl && error && <span className="image-dropzone-error">{error}</span>}
  </div>;
}
