import React, { useEffect, useState } from "react";
import { ClipboardList, CalendarDays, LogOut, Loader2, Truck, BarChart3 } from "lucide-react";
import { supabase } from "./supabaseClient";
import Login from "./components/Login";
import NewReportForm from "./components/NewReportForm";
import HistoryList from "./components/HistoryList";
import ReportDetail from "./components/ReportDetail";
import PlantHours from "./components/PlantHours";
import Dashboard from "./components/Dashboard";

const PROJECT_NAME = import.meta.env.VITE_PROJECT_NAME || "Site Daily Report";

export default function App() {
  const [session, setSession] = useState(undefined);
  const [tab, setTab] = useState("dashboard");
  const [detailId, setDetailId] = useState(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => listener.subscription.unsubscribe();
  }, []);

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
          {tab === "plant" && !detailId && <PlantHours />}
          {tab === "dashboard" && !detailId && <Dashboard />}
          {tab === "history" && !detailId && <HistoryList refreshKey={historyRefreshKey} onOpen={setDetailId} />}
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
            <button className={`nav-btn ${tab === "plant" ? "active" : ""}`} onClick={() => setTab("plant")}>
              <Truck size={20} strokeWidth={tab === "plant" ? 2.4 : 2} />
              <span>Plant Hours</span>
            </button>
            <button className={`nav-btn ${tab === "history" ? "active" : ""}`} onClick={goHistory}>
              <CalendarDays size={20} strokeWidth={tab === "history" ? 2.4 : 2} />
              <span>History</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
