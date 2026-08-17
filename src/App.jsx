import React, { useEffect, useState } from "react";
import { ClipboardList, CalendarDays, LogOut, Loader2, BarChart3, ShieldCheck, Users } from "lucide-react";
import { supabase } from "./supabaseClient";
import Login from "./components/Login";
import NewReportForm from "./components/NewReportForm";
import HistoryList from "./components/HistoryList";
import ReportDetail from "./components/ReportDetail";
import Dashboard from "./components/Dashboard";
import CertsPage from "./components/admin/CertsPage";
import StaffPage from "./components/admin/StaffPage";

const PROJECT_NAME = import.meta.env.VITE_PROJECT_NAME || "Site Daily Report";

export default function App() {
  const [session, setSession] = useState(undefined);
  const [tab, setTab] = useState("dashboard");
  const [detailId, setDetailId] = useState(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setIsAdmin(!!data);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (session === undefined) {
    return (
      <div className="shell" style={{ alignItems: "center", justifyContent: "center", display: "flex", minHeight: "100dvh" }}>
        <Loader2 size={26} color="var(--accent)" className="spin" />
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  function goHistory() {
    setDetailId(null);
    setTab("history");
    setHistoryRefreshKey((k) => k + 1);
  }

  return (
    <div className="shell">
      <div className="phone">
        <div className="header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="header-title">{PROJECT_NAME}</div>
            <div className="header-sub">DAILY SITE REPORT</div>
          </div>
          <div className="header-user">
            <button className="icon-btn" title="Sign out" onClick={() => supabase.auth.signOut()}>
              <LogOut size={16} color="var(--text-muted)" />
            </button>
          </div>
        </div>

        <div className="body">
          {tab === "new" && !detailId && <NewReportForm onSubmitted={() => setHistoryRefreshKey((k) => k + 1)} />}
          {tab === "dashboard" && !detailId && <Dashboard />}
          {tab === "history" && !detailId && <HistoryList refreshKey={historyRefreshKey} onOpen={setDetailId} />}
          {tab === "certs" && !detailId && isAdmin && <CertsPage />}
          {tab === "staff" && !detailId && isAdmin && <StaffPage />}
          {detailId && (
            <ReportDetail
              reportId={detailId}
              onBack={() => setDetailId(null)}
              onDeleted={() => {
                setDetailId(null);
                setHistoryRefreshKey((k) => k + 1);
              }}
            />
          )}
        </div>

        {!detailId && (
          <div className="nav">
            <button className={`nav-btn ${tab === "dashboard" ? "active" : ""}`} onClick={() => setTab("dashboard")}>
              <BarChart3 size={20} strokeWidth={tab === "dashboard" ? 2.4 : 2} />
              <span>Dashboard</span>
            </button>
            <button className={`nav-btn ${tab === "new" ? "active" : ""}`} onClick={() => setTab("new")}>
              <ClipboardList size={20} strokeWidth={tab === "new" ? 2.4 : 2} />
              <span>New Report</span>
            </button>
            <button className={`nav-btn ${tab === "history" ? "active" : ""}`} onClick={goHistory}>
              <CalendarDays size={20} strokeWidth={tab === "history" ? 2.4 : 2} />
              <span>History</span>
            </button>
            {isAdmin && (
              <button className={`nav-btn ${tab === "certs" ? "active" : ""}`} onClick={() => setTab("certs")}>
                <ShieldCheck size={20} strokeWidth={tab === "certs" ? 2.4 : 2} />
                <span>Certs</span>
              </button>
            )}
            {isAdmin && (
              <button className={`nav-btn ${tab === "staff" ? "active" : ""}`} onClick={() => setTab("staff")}>
                <Users size={20} strokeWidth={tab === "staff" ? 2.4 : 2} />
                <span>Staff</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
