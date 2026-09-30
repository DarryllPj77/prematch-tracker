import { useEffect, useState } from "react";
import Login from "./components/Login.jsx";
import ManagerDashboard from "./components/ManagerDashboard.jsx";
import PlayerUploadForm from "./components/PlayerUploadForm.jsx";
import { useRetentionCleanup } from "./hooks/useRetentionCleanup.js";
import { getCurrentUser } from "./services/apiService.js";
import * as socketService from "./services/socketService.js";
import { clearLocalProfile, getLocalProfile, saveLocalProfile } from "./services/storageService.js";
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

    async function restoreSession() {
      try {
        const savedProfile = await getLocalProfile();
        if (!savedProfile) return;
        const verifiedProfile = await getCurrentUser(savedProfile.token);
        const refreshedProfile = await saveLocalProfile({ ...verifiedProfile, token: savedProfile.token });
        if (active) setProfile(refreshedProfile);
      } catch {
        await clearLocalProfile().catch(() => {});
        if (active) setProfile(null);
      } finally {
        if (active) setProfileLoading(false);
      }
    }

    restoreSession();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!profile) return;
    socketService.authenticate(profile);
  }, [profile]);

  useEffect(() => {
    if (profile?.role !== "player") return undefined;
    let handlingKick = false;
    const removeKickListener = socketService.on("kicked_from_team", async (payload = {}) => {
      if (handlingKick) return;
      handlingKick = true;
      try {
        await clearLocalProfile();
      } finally {
        socketService.disconnect();
        setProfile(null);
        window.alert(payload.message || "You were removed from the team by the manager.");
      }
    });
    return removeKickListener;
  }, [profile]);

  const logout = async () => {
    try {
      await clearLocalProfile();
    } finally {
      socketService.disconnect();
      setProfile(null);
    }
  };

  if (profileLoading) return <div className="profile-loading">VERIFYING SESSION...</div>;
  if (!profile) return <Login onLogin={setProfile} />;

  return <div className="app-shell">
    <nav className="topbar">
      <div className="brand">PREMATCH <b>/</b> TRACKER</div>
      <div className="session-controls">
        <div className="session-identity">
          <span className="session-team-label">PREMIER TEAM</span>
          <strong className="session-team-name">{profile.teamName}</strong>
          <small className="session-user">
            <b>{profile.role}</b> / <span className="user-callsign">{profile.username}</span>
          </small>
        </div>
        <button className="session-logout" type="button" onClick={logout}>LOG OUT / CHANGE USER</button>
      </div>
    </nav>
    <div className="wipe-in" key={`${profile.role}-${profile.username}`}>
      {profile.role === "player" ? <PlayerUploadForm profile={profile} /> : <ManagerDashboard profile={profile} />}
    </div>
  </div>;
}
