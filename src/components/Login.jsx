import { useState } from "react";
import { loginUser, registerUser } from "../services/apiService.js";
import { saveLocalProfile } from "../services/storageService.js";
import "../styles/login.css";

export default function Login({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState("");
  const [managerCode, setManagerCode] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isRegister = mode === "register";

  const changeMode = () => {
    setMode((currentMode) => currentMode === "login" ? "register" : "login");
    setPin("");
    setRole("");
    setManagerCode("");
    setError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!username.trim() || !/^\d{4}$/.test(pin)) {
      setError("ENTER A CALLSIGN AND A 4-DIGIT PIN.");
      return;
    }
    if (isRegister && !role) {
      setError("SELECT AN ACCESS ROLE.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const profile = isRegister
        ? await registerUser({ username, pin, role, managerCode })
        : await loginUser({ username, pin });
      onLogin(await saveLocalProfile(profile));
    } catch (submissionError) {
      if (submissionError?.code === "USER_EXISTS") {
        setError("CALLSIGN ALREADY REGISTERED. LOG IN INSTEAD.");
      } else if (submissionError?.code === "INVALID_CREDENTIALS") {
        setError("INVALID CALLSIGN OR PIN.");
      } else if (submissionError?.code === "INVALID_MANAGER_CODE") {
        setError("INVALID MANAGER REGISTRATION CODE.");
      } else if (submissionError?.code === "SERVER_UNAVAILABLE") {
        setError("PREMATCH SERVER UNAVAILABLE. TRY AGAIN WHEN THE SERVICE IS ONLINE.");
      } else {
        setError(submissionError?.message?.toUpperCase() || "AUTHENTICATION FAILED.");
      }
      setSaving(false);
    }
  };

  return <main className="login-shell">
    <section className="login-card cut-corner">
      <div className={`login-copy ${isRegister ? "is-register" : "is-login"}`}>
        <div className="eyebrow">PREMATCH TRACKER / ACCESS GATE</div>
        <h1>{isRegister ? <>NEW AGENT<br /><span>REGISTRATION</span></> : <>SYSTEM<br /><span>LOGIN</span></>}</h1>
        <p>{isRegister
          ? "Create a persistent identity. Your assigned role controls which operational dashboard is mounted."
          : "Authenticate with your registered callsign. Your saved server role routes you into the correct operational environment."}</p>
        <div className="login-signal" aria-hidden="true"><i /><span>SECURE SERVER AUTHENTICATION</span></div>
      </div>

      <form className="login-form" onSubmit={submit}>
        <div className="login-form-head"><span>{isRegister ? "02" : "01"}</span><strong>{isRegister ? "IDENTITY REGISTRATION" : "SECURE AUTHENTICATION"}</strong></div>
        <label>CALLSIGN<input autoFocus autoComplete="username" maxLength="32" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Enter callsign" /></label>
        <label>4-DIGIT PIN<input className="login-pin-input" type="password" inputMode="numeric" autoComplete={isRegister ? "new-password" : "current-password"} maxLength="4" pattern="[0-9]{4}" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" /></label>

        {isRegister && <fieldset className="role-selector">
          <legend>SELECT ROLE</legend>
          <button className={role === "player" ? "is-selected" : ""} type="button" aria-pressed={role === "player"} onClick={() => setRole("player")}>
            <span>PLAYER</span><small>SUBMIT AND TRACK WARM-UP PROOF</small>
          </button>
          <button className={role === "manager" ? "is-selected" : ""} type="button" aria-pressed={role === "manager"} onClick={() => setRole("manager")}>
            <span>MANAGER</span><small>MONITOR ATTENDANCE AND TARGETS</small>
          </button>
        </fieldset>}

        {isRegister && role === "manager" && <label>MANAGER REGISTRATION CODE<input type="password" autoComplete="off" value={managerCode} onChange={(event) => setManagerCode(event.target.value)} placeholder="Enter deployment manager code" /></label>}

        {error && <div className="login-error" role="alert">{error}</div>}
        <button className="btn-primary login-submit" type="submit" disabled={saving}>{saving ? "PROCESSING..." : isRegister ? "REGISTER & ENTER" : "AUTHENTICATE"}</button>
        <div className="login-mode-switch">
          <span>{isRegister ? "ALREADY REGISTERED?" : "NEW AGENT?"}</span>
          <button type="button" onClick={changeMode}>{isRegister ? "LOGIN" : "REGISTER HERE"}</button>
        </div>
        <small className="login-storage-note">ACCOUNTS ARE STORED SECURELY ON THE PREMATCH SERVER.</small>
      </form>
    </section>
  </main>;
}
