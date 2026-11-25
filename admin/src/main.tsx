import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { api, getToken, setToken, setUnauthorizedHandler } from "./api";
import { Login } from "./pages/Login";
import { Reports } from "./pages/Reports";
import { Products } from "./pages/Products";
import { Orders, OrderDetail } from "./pages/Orders";
import { Members, MemberDetail } from "./pages/Members";
import { Rates } from "./pages/Rates";
import { Withdrawals } from "./pages/Withdrawals";
import { Settings } from "./pages/Settings";

const NAV = [
  ["reports", "الرئيسية والتقارير", "▦"],
  ["orders", "الطلبات والفواتير", "🧾"],
  ["members", "الحسابات", "👥"],
  ["products", "المنتجات", "📦"],
  ["withdrawals", "السحب والخصومات", "💸"],
  ["rates", "النسب", "٪"],
  ["settings", "الإعدادات والسجل", "⚙"],
] as const;

function useHash() {
  const [hash, setHash] = useState(() => location.hash.replace(/^#\/?/, ""));
  useEffect(() => {
    const on = () => setHash(location.hash.replace(/^#\/?/, ""));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash;
}


function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [me, setMe] = useState<{ name: string; username: string }>();
  const hash = useHash();

  useEffect(() => {
    setUnauthorizedHandler(() => { setToken(null); setAuthed(false); });
  }, []);
  useEffect(() => {
    if (authed) api("GET", "/me").then(setMe, () => {});
  }, [authed]);

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  const [section = "reports", id] = hash.split("/");
  const logout = () => {
    setToken(null);
    setAuthed(false);
  };

  let page;
  switch (section) {
    case "orders": page = id ? <OrderDetail id={Number(id)} /> : <Orders />; break;
    case "members": page = id ? <MemberDetail id={Number(id)} /> : <Members />; break;
    case "products": page = <Products />; break;
    case "withdrawals": page = <Withdrawals />; break;
    case "rates": page = <Rates />; break;
    case "settings": page = <Settings />; break;
    default: page = <Reports />;
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">HIGH TECH</div>
          <div className="brand-sub">لوحة التحكم</div>
        </div>
        <nav>
          {NAV.map(([key, label, icon]) => (
            <a key={key} href={`#/${key}`} className={section === key || (key === "reports" && !NAV.some(([k]) => k === section)) ? "active" : ""}>
              <span className="nav-icon">{icon}</span>
              {label}
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div>{me?.name ?? ""}</div>
          <button className="btn ghost light" onClick={logout}>تسجيل الخروج</button>
        </div>
      </aside>
      <main className="content">{page}</main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
