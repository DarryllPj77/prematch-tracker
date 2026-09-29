import { useEffect, useState } from "react";
import Login from "./components/Login.jsx";
import ManagerDashboard from "./components/ManagerDashboard.jsx";
import PlayerUploadForm from "./components/PlayerUploadForm.jsx";
import { useRetentionCleanup } from "./hooks/useRetentionCleanup.js";
import * as socketService from "./services/socketService.js";
import { clearLocalProfile, getLocalProfile } from "./services/storageService.js";
import "./styles/theme.css";
import "./styles/animations.css";
import "./styles/dashboard.css";
import "./styles/drill-performance.css";

export default function App() {
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  useRetentionCleanup();

  useEffect(() => {
    let active = true;
    getLocalProfile()
      .then((savedProfile) => { if (active) setProfile(savedProfile); })
      .catch(() => { if (active) setProfile(null); })
      .finally(() => { if (active) setProfileLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!profile) return;
    socketService.authenticate(profile);
  }, [profile]);

  const logout = async () => {
    try {
      await clearLocalProfile();
    } finally {
      socketService.disconnect();
      setProfile(null);
    }
  };

  if (profileLoading) return <div className="profile-loading">RESTORING LOCAL PROFILE...</div>;
  if (!profile) return <Login onLogin={setProfile} />;

  return <div className="app-shell">
    <nav className="topbar">
      <div className="brand">PREMATCH <b>/</b> TRACKER</div>
      <div className="session-controls">
        <div className="session-identity"><span>{profile.role}</span><strong>{profile.username}</strong></div>
        <button className="session-logout" type="button" onClick={logout}>LOG OUT / CHANGE USER</button>
      </div>
    </nav>
    <div className="wipe-in" key={`${profile.role}-${profile.username}`}>
      {profile.role === "player" ? <PlayerUploadForm profile={profile} /> : <ManagerDashboard profile={profile} />}
    </div>
  </div>;
}
