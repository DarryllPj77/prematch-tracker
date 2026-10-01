import { useState } from "react";
import { loginUser, registerUser, resetPin } from "../services/apiService.js";
import { saveLocalProfile } from "../services/storageService.js";
import "../styles/login.css";

export default function Login({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState("");
  const [managerCode, setManagerCode] = useState("");
  const [teamCode, setTeamCode] = useState("");
  const [teamName, setTeamName] = useState("");
  const [isCreatingTeam, setIsCreatingTeam] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isRegister = mode === "register";
  const isResettingPin = mode === "reset";

  const changeMode = () => {
    setMode((currentMode) => currentMode === "login" ? "register" : "login");
    setPin("");
    setRole("");
    setManagerCode("");
    setTeamCode("");
    setTeamName("");
    setIsCreatingTeam(true);
    setError("");
  };

  const openPinRecovery = () => {
    setMode("reset");
    setPin("");
    setTeamCode("");
    setError("");
  };

  const returnToLogin = () => {
    setMode("login");
    setPin("");
    setTeamCode("");
    setError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!username.trim() || !/^\d{4}$/.test(pin)) {
      setError(isResettingPin ? "ENTER A CALLSIGN AND A NEW 4-DIGIT PIN." : "ENTER A CALLSIGN AND A 4-DIGIT PIN.");
      return;
    }
    if (isResettingPin && !/^[A-Z0-9]{4}$/.test(teamCode)) {
      setError("ENTER A VALID 4-CHARACTER TEAM INVITE CODE.");
      return;
    }
    if (isRegister && !role) {
      setError("SELECT AN ACCESS ROLE.");
      return;
    }
    if (isRegister && role === "player" && !/^[A-Z0-9]{4}$/.test(teamCode)) {
      setError("ENTER A VALID 4-CHARACTER TEAM INVITE CODE.");
      return;
    }
    if (isRegister && role === "manager" && isCreatingTeam && (!teamName.trim() || teamName.trim().length > 64)) {
      setError("ENTER A PREMIER TEAM NAME BETWEEN 1 AND 64 CHARACTERS.");
      return;
    }
    if (isRegister && role === "manager" && !isCreatingTeam && !/^[A-Z0-9]{4}$/.test(teamCode)) {
      setError("ENTER A VALID 4-CHARACTER TEAM INVITE CODE.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const profile = isResettingPin
        ? await resetPin({ callsign: username, teamCode, newPin: pin })
        : isRegister
          ? await registerUser({
            username,
            pin,
            role,
            managerCode,
            teamCode,
            teamName,
            intent: role === "manager" ? isCreatingTeam ? "create" : "join" : undefined,
          })
          : await loginUser({ username, pin });
      onLogin(await saveLocalProfile(profile));
    } catch (submissionError) {
      if (submissionError?.code === "USER_EXISTS") {
        setError("CALLSIGN ALREADY REGISTERED. LOG IN INSTEAD.");
      } else if (submissionError?.code === "INVALID_CREDENTIALS") {
        setError("INVALID CALLSIGN OR PIN.");
      } else if (submissionError?.code === "INVALID_MANAGER_CODE") {
        setError("INVALID MANAGER REGISTRATION CODE.");
      } else if (submissionError?.code === "INVALID_TEAM_CODE") {
        setError("INVALID TEAM CODE.");
      } else if (submissionError?.code === "INVALID_TEAM_NAME") {
        setError("ENTER A PREMIER TEAM NAME BETWEEN 1 AND 64 CHARACTERS.");
      } else if (submissionError?.code === "INVALID_RECOVERY") {
        setError("INVALID CALLSIGN OR TEAM CODE.");
      } else if (submissionError?.code === "TEAM_ASSIGNMENT_REQUIRED") {
        setError("THIS LEGACY ACCOUNT NEEDS A TEAM. REGISTER AGAIN WITH THE SAME CALLSIGN, PIN, AND A TEAM INVITE CODE.");
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
        <h1>{isResettingPin
          ? <>PIN<br /><span>RECOVERY</span></>
          : isRegister
            ? <>NEW AGENT<br /><span>REGISTRATION</span></>
            : <>SYSTEM<br /><span>LOGIN</span></>}</h1>
        <p>{isResettingPin
          ? "Verify your player identity with the Team Invite Code, then establish a new four-digit PIN."
          : isRegister
            ? "Create a persistent identity. Your assigned role controls which operational dashboard is mounted."
            : "Authenticate with your registered callsign. Your saved server role routes you into the correct operational environment."}</p>
        <div className="login-signal" aria-hidden="true"><i /><span>SECURE SERVER AUTHENTICATION</span></div>
      </div>

      <form className="login-form" onSubmit={submit}>
        <div className="login-form-head">
          <span>{isResettingPin ? "03" : isRegister ? "02" : "01"}</span>
          <strong>{isResettingPin ? "PIN RECOVERY" : isRegister ? "IDENTITY REGISTRATION" : "SECURE AUTHENTICATION"}</strong>
        </div>
        <label>CALLSIGN<input autoFocus autoComplete="username" maxLength="32" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Enter callsign" /></label>
        {isResettingPin && <label>TEAM INVITE CODE<input type="text" autoComplete="off" inputMode="text" maxLength="4" pattern="[A-Za-z0-9]{4}" value={teamCode} onChange={(event) => setTeamCode(event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 4))} placeholder="e.g. K9X2" /></label>}
        <label>{isResettingPin ? "NEW 4-DIGIT PIN" : "4-DIGIT PIN"}<input className="login-pin-input" type="password" inputMode="numeric" autoComplete={isRegister || isResettingPin ? "new-password" : "current-password"} maxLength="4" pattern="[0-9]{4}" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" /></label>

        {isRegister && <fieldset className="role-selector">
          <legend>SELECT ROLE</legend>
          <button className={role === "player" ? "is-selected" : ""} type="button" aria-pressed={role === "player"} onClick={() => setRole("player")}>
            <span>PLAYER</span><small>SUBMIT AND TRACK WARM-UP PROOF</small>
          </button>
          <button className={role === "manager" ? "is-selected" : ""} type="button" aria-pressed={role === "manager"} onClick={() => { if (role !== "manager") setIsCreatingTeam(true); setRole("manager"); }}>
            <span>MANAGER</span><small>MONITOR ATTENDANCE AND TARGETS</small>
          </button>
        </fieldset>}

        {isRegister && role === "manager" && <>
          <fieldset className="manager-intent-selector">
            <legend>MANAGER TEAM SETUP</legend>
            <button className={isCreatingTeam ? "is-selected" : ""} type="button" aria-pressed={isCreatingTeam} onClick={() => { setIsCreatingTeam(true); setError(""); }}>
              <span>CREATE NEW TEAM</span><small>GENERATE A NEW INVITE CODE</small>
            </button>
            <button className={!isCreatingTeam ? "is-selected" : ""} type="button" aria-pressed={!isCreatingTeam} onClick={() => { setIsCreatingTeam(false); setError(""); }}>
              <span>JOIN EXISTING TEAM</span><small>USE AN ACTIVE TEAM CODE</small>
            </button>
          </fieldset>
          <label htmlFor="manager-registration-code">MANAGER REGISTRATION CODE<input id="manager-registration-code" name="managerCode" type="password" autoComplete="off" value={managerCode} onChange={(event) => setManagerCode(event.target.value)} placeholder="Enter deployment manager code" /></label>
          {isCreatingTeam
            ? <label htmlFor="premier-team-name">PREMIER TEAM NAME<input id="premier-team-name" name="teamName" type="text" autoComplete="organization" maxLength="64" value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="e.g. Paper Rex" required /></label>
            : <label htmlFor="manager-team-code">TEAM INVITE CODE (4-DIGIT)<input id="manager-team-code" name="teamCode" type="text" autoComplete="off" inputMode="text" maxLength="4" pattern="[A-Za-z0-9]{4}" value={teamCode} onChange={(event) => setTeamCode(event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 4))} placeholder="e.g. K9X2" required /></label>}
        </>}
        {isRegister && role === "player" && <label>TEAM INVITE CODE<input type="text" autoComplete="off" inputMode="text" maxLength="4" pattern="[A-Za-z0-9]{4}" value={teamCode} onChange={(event) => setTeamCode(event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 4))} placeholder="e.g. K9X2" /></label>}

        {error && <div className="login-error" role="alert">{error}</div>}
        <button className="btn-primary login-submit" type="submit" disabled={saving}>{saving ? "PROCESSING..." : isResettingPin ? "RESET & LOGIN" : isRegister ? "REGISTER & ENTER" : "AUTHENTICATE"}</button>
        <div className="login-secondary-actions">
          {!isRegister && !isResettingPin && <button className="login-recovery-link" type="button" onClick={openPinRecovery}>FORGOT PIN?</button>}
          {isResettingPin
            ? <button className="login-recovery-link" type="button" onClick={returnToLogin}>CANCEL / BACK TO LOGIN</button>
            : <div className="login-mode-switch">
              <span>{isRegister ? "ALREADY REGISTERED?" : "NEW AGENT?"}</span>
              <button type="button" onClick={changeMode}>{isRegister ? "LOGIN" : "REGISTER HERE"}</button>
            </div>}
        </div>
        <small className="login-storage-note">ACCOUNTS ARE STORED SECURELY ON THE PREMATCH SERVER.</small>
      </form>
    </section>
  </main>;
}
