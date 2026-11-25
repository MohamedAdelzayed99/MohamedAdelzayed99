import { useState } from "react";
import { api, qs } from "../api";
import {
  Badge, Card, date, EARNING_STATUS_AR, Empty, ErrorBox, Field, Loading, MEMBER_STATUS_AR, METHOD_AR, Modal, money,
  ORDER_STATUS_AR, PROGRAM_AR, Stat, useAction, useApi, WD_STATUS_AR,
} from "../ui";
import type { Order } from "./Orders";

interface MemberRow {
  id: number;
  program: string;
  phone: string;
  name: string;
  referralCode: string;
  shareLink: string;
  status: string;
  shopName: string | null;
  shopAddress: string | null;
  createdAt: string;
  directCount: number;
  parentId: number | null;
  available: number;
  pending: number;
}

interface MemberDetailData {
  member: MemberRow & { commercialReg: string | null; lastActiveAt: string | null; payoutMethod: string | null; payoutAccount: string | null };
  upline: { id: number; name: string; phone: string; referralCode: string }[];
  network: {
    totalMembers: number;
    levels: { level: number; count: number; earnedAvailable: number; earnedPending: number }[];
    members: { id: number; depth: number; name: string; phone: string; parentId: number }[];
  };
  wallet: {
    available: number; pending: number; withdrawn: number; usedOnInvoices: number; lifetime: number; canWithdraw: boolean;
    earnings: { id: number; order_id: number; level: number; amount: number; status: string; release_at: string; created_at: string }[];
    withdrawals: { id: number; amount: number; method: string; account: string; status: string; note: string; created_at: string }[];
  };
  orders: Order[];
}

export function Members() {
  const [program, setProgram] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [rows, error, reload] = useApi(() => api<MemberRow[]>("GET", "/members" + qs({ program, status, query: q })), [program, status, q]);
  return (
    <div className="page">
      <header className="page-head">
        <h1>الحسابات</h1>
        <button className="btn primary" onClick={() => setCreating(true)}>+ عضو تسجّله الشركة</button>
      </header>
      <Card>
        <form className="row wrap" onSubmit={(e) => { e.preventDefault(); setQ(query.trim()); }}>
          <input className="grow" placeholder="ابحث برقم الموبايل أو الاسم أو كود الدعوة" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select value={program} onChange={(e) => setProgram(e.target.value)}>
            <option value="">القطاعي والجملة</option>
            <option value="retail">القطاعي</option>
            <option value="wholesale">الجملة</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">كل الحالات</option>
            {Object.entries(MEMBER_STATUS_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn">بحث</button>
        </form>
      </Card>
      <ErrorBox error={error} />
      <Card>
        {!rows ? <Loading /> : rows.length === 0 ? <Empty text="لا توجد حسابات" /> : (
          <table>
            <thead>
              <tr><th>الاسم</th><th>التطبيق</th><th>الموبايل</th><th>الكود</th><th>تحته مباشرة</th><th>متاح</th><th>معلّق</th><th>الحالة</th><th>التسجيل</th></tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="clickable" onClick={() => (location.hash = `/members/${m.id}`)}>
                  <td><b>{m.shopName ?? m.name}</b>{m.shopName && <div className="muted small">{m.name}</div>}</td>
                  <td><Badge value={m.program} label={PROGRAM_AR[m.program]} /></td>
                  <td dir="ltr" className="num">{m.phone}</td>
                  <td className="mono">{m.referralCode}</td>
                  <td>{m.directCount}</td>
                  <td>{money(m.available)}</td>
                  <td className="muted">{money(m.pending)}</td>
                  <td><Badge value={m.status} label={MEMBER_STATUS_AR[m.status]} /></td>
                  <td className="num muted">{date(m.createdAt).slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {creating && <CreateMember onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); reload(); location.hash = `/members/${id}`; }} />}
    </div>
  );
}

function CreateMember({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const [f, setF] = useState({ program: "retail", name: "", phone: "", parentId: "", shopName: "", shopAddress: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const { busy, error, run } = useAction();
  return (
    <Modal title="عضو تسجّله الشركة" onClose={onClose}>
      <p className="muted small">مثل الأسماء في أعلى الورقتين (م. خالد، ميلانو…). اترك «العضو الأعلى» فارغًا ليبدأ شجرة مستقلة.</p>
      <div className="form-grid">
        <Field label="التطبيق">
          <select value={f.program} onChange={set("program")}>
            <option value="retail">القطاعي</option>
            <option value="wholesale">الجملة</option>
          </select>
        </Field>
        <Field label="الاسم"><input value={f.name} onChange={set("name")} /></Field>
        <Field label="رقم الموبايل"><input dir="ltr" value={f.phone} onChange={set("phone")} placeholder="01xxxxxxxxx" /></Field>
        <Field label="رقم العضو الأعلى (اختياري)"><input type="number" value={f.parentId} onChange={set("parentId")} /></Field>
        {f.program === "wholesale" && (
          <>
            <Field label="اسم المحل"><input value={f.shopName} onChange={set("shopName")} /></Field>
            <Field label="عنوان المحل"><input value={f.shopAddress} onChange={set("shopAddress")} /></Field>
          </>
        )}
      </div>
      <ErrorBox error={error} />
      <div className="row end">
        <button className="btn" onClick={onClose}>إلغاء</button>
        <button className="btn primary" disabled={busy}
          onClick={() => run(() => api<{ id: number }>("POST", "/members", { ...f, parentId: f.parentId ? Number(f.parentId) : null }), (r) => onDone(r.id))}>
          إنشاء
        </button>
      </div>
    </Modal>
  );
}

export function MemberDetail({ id }: { id: number }) {
  const [d, error, reload] = useApi(() => api<MemberDetailData>("GET", `/members/${id}`), [id]);
  const [moving, setMoving] = useState(false);
  const [tab, setTab] = useState<"network" | "orders" | "wallet">("network");
  const { busy, error: actionError, run } = useAction();
  if (error) return <div className="page"><a href="#/members" className="back">→ الحسابات</a><ErrorBox error={error} /></div>;
  if (!d) return <Loading />;
  const m = d.member;
  const isW = m.program === "wholesale";
  const setStatus = (status: string, msg: string) => {
    if (!confirm(msg)) return;
    run(() => api("POST", `/members/${id}/status`, { status }), reload);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <a href="#/members" className="back">→ الحسابات</a>
          <h1>
            {m.shopName ?? m.name} <Badge value={m.program} label={PROGRAM_AR[m.program]} /> <Badge value={m.status} label={MEMBER_STATUS_AR[m.status]} />
          </h1>
          <div className="muted">عضو #{m.id} · <span dir="ltr" className="num">{m.phone}</span> · الكود <span className="mono">{m.referralCode}</span></div>
        </div>
        <div className="row wrap">
          {m.status === "pending_approval" && (
            <button className="btn primary" disabled={busy} onClick={() => setStatus("active", `تفعيل محل «${m.shopName ?? m.name}»؟`)}>✓ تفعيل المحل</button>
          )}
          {m.status === "active" && (
            <button className="btn danger" disabled={busy} onClick={() => setStatus("suspended", "إيقاف الحساب؟ سيتم تسجيل خروجه من التطبيق.")}>إيقاف الحساب</button>
          )}
          {m.status === "suspended" && (
            <button className="btn primary" disabled={busy} onClick={() => setStatus("active", "إعادة تفعيل الحساب؟")}>إعادة التفعيل</button>
          )}
          <button className="btn" onClick={() => setMoving(true)}>نقل في الشجرة</button>
        </div>
      </header>
      <ErrorBox error={actionError} />

      <div className="stats">
        <Stat label={isW ? "رصيد الخصم المتاح" : "الرصيد المتاح"} value={money(d.wallet.available)} tone="green" />
        <Stat label="رصيد معلّق" value={money(d.wallet.pending)} tone="amber" sub="داخل مدة الإرجاع" />
        <Stat label={isW ? "مُستخدم في الفواتير" : "تم سحبه"} value={money(isW ? d.wallet.usedOnInvoices : d.wallet.withdrawn)} />
        <Stat label="إجمالي ما كسبه" value={money(d.wallet.lifetime)} />
        <Stat label="حجم الشبكة" value={d.network.totalMembers} sub={`${d.network.levels.length} مستوى`} />
      </div>

      <div className="grid-side">
        <div>
          <div className="tabs">
            <button className={tab === "network" ? "active" : ""} onClick={() => setTab("network")}>الشبكة ({d.network.totalMembers})</button>
            <button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}>{isW ? "الفواتير" : "الطلبات"} ({d.orders.length})</button>
            <button className={tab === "wallet" ? "active" : ""} onClick={() => setTab("wallet")}>المحفظة</button>
          </div>
          {tab === "network" && <NetworkTab d={d} />}
          {tab === "orders" && (
            <Card>
              {d.orders.length === 0 ? <Empty text="لا توجد طلبات" /> : (
                <table>
                  <thead><tr><th>رقم</th><th>التاريخ</th><th>الإجمالي</th><th>خصم مستخدم</th><th>الحالة</th></tr></thead>
                  <tbody>
                    {d.orders.map((o) => (
                      <tr key={o.id} className="clickable" onClick={() => (location.hash = `/orders/${o.id}`)}>
                        <td>#{o.id}</td><td className="num">{date(o.createdAt)}</td><td>{money(o.total)}</td>
                        <td>{o.discountUsed ? money(o.discountUsed) : "—"}</td>
                        <td><Badge value={o.status} label={ORDER_STATUS_AR[o.status]} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}
          {tab === "wallet" && (
            <>
              <Card title="الأرباح">
                {d.wallet.earnings.length === 0 ? <Empty /> : (
                  <table>
                    <thead><tr><th>الطلب</th><th>المستوى</th><th>المبلغ</th><th>الحالة</th><th>يُتاح في</th></tr></thead>
                    <tbody>
                      {d.wallet.earnings.map((e) => (
                        <tr key={e.id}>
                          <td><a href={`#/orders/${e.order_id}`}>#{e.order_id}</a></td><td>{e.level}</td><td>{money(e.amount)}</td>
                          <td><Badge value={e.status} label={EARNING_STATUS_AR[e.status]} /></td><td className="num muted">{date(e.release_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
              {d.wallet.withdrawals.length > 0 && (
                <Card title="طلبات السحب">
                  <table>
                    <thead><tr><th>التاريخ</th><th>المبلغ</th><th>الطريقة</th><th>الحالة</th></tr></thead>
                    <tbody>
                      {d.wallet.withdrawals.map((w) => (
                        <tr key={w.id}>
                          <td className="num">{date(w.created_at)}</td><td>{money(w.amount)}</td>
                          <td>{METHOD_AR[w.method] ?? w.method} <span dir="ltr" className="muted num">{w.account}</span></td>
                          <td><Badge value={w.status} label={WD_STATUS_AR[w.status]} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </>
          )}
        </div>
        <div>
          <Card title="البيانات">
            <dl className="kv">
              <dt>الاسم</dt><dd>{m.name}</dd>
              {isW && <><dt>المحل</dt><dd>{m.shopName}</dd><dt>العنوان</dt><dd>{m.shopAddress}</dd><dt>السجل التجاري</dt><dd>{m.commercialReg ?? "—"}</dd></>}
              <dt>لينك المشاركة</dt><dd dir="ltr" className="small mono">{m.shareLink}</dd>
              <dt>طريقة السحب</dt><dd>{m.payoutMethod ? `${METHOD_AR[m.payoutMethod] ?? m.payoutMethod} · ${m.payoutAccount}` : "—"}</dd>
              <dt>التسجيل</dt><dd className="num">{date(m.createdAt)}</dd>
              <dt>آخر نشاط</dt><dd className="num">{date(m.lastActiveAt)}</dd>
            </dl>
          </Card>
          <Card title="من فوقه في الشجرة">
            {d.upline.length === 0 ? <p className="muted">عضو في أعلى الشجرة (لا أحد فوقه).</p> : (
              <ol className="upline">
                {d.upline.map((u, i) => (
                  <li key={u.id}>
                    <span className="lvl">{i === 0 ? "صاحب اللينك" : `مستوى ${i + 1}`}</span>
                    <a href={`#/members/${u.id}`}>{u.name}</a> <span className="muted small num" dir="ltr">{u.phone}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
      {moving && <MoveMember d={d} onClose={() => setMoving(false)} onDone={() => { setMoving(false); reload(); }} />}
    </div>
  );
}

function NetworkTab({ d }: { d: MemberDetailData }) {
  const [depth, setDepth] = useState(0);
  const names = new Map(d.network.members.map((x) => [x.id, x.name]));
  const list = d.network.members.filter((x) => !depth || x.depth === depth);
  return (
    <>
      <Card title="المستويات">
        {d.network.levels.length === 0 ? <Empty text="لا أحد تحته بعد" /> : (
          <table>
            <thead><tr><th>المستوى</th><th>العدد</th><th>أرباح متاحة</th><th>أرباح معلّقة</th></tr></thead>
            <tbody>
              {d.network.levels.map((l) => (
                <tr key={l.level} className={`clickable ${depth === l.level ? "selected" : ""}`} onClick={() => setDepth(depth === l.level ? 0 : l.level)}>
                  <td>المستوى {l.level}</td><td>{l.count}</td><td>{money(l.earnedAvailable)}</td><td className="muted">{money(l.earnedPending)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {d.network.members.length > 0 && (
        <Card title={depth ? `أعضاء المستوى ${depth}` : "كل الأعضاء تحته"} actions={depth ? <button className="btn small ghost" onClick={() => setDepth(0)}>عرض الكل</button> : undefined}>
          <table>
            <thead><tr><th>المستوى</th><th>الاسم</th><th>الموبايل</th><th>جاء عن طريق</th></tr></thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id} className="clickable" onClick={() => (location.hash = `/members/${x.id}`)}>
                  <td>{x.depth}</td><td>{x.name}</td><td dir="ltr" className="num">{x.phone}</td>
                  <td className="muted">{x.depth === 1 ? "مباشر" : names.get(x.parentId) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

function MoveMember({ d, onClose, onDone }: { d: MemberDetailData; onClose: () => void; onDone: () => void }) {
  const [parentId, setParentId] = useState(d.member.parentId ? String(d.member.parentId) : "");
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<MemberRow[]>([]);
  const { busy, error, run } = useAction();
  return (
    <Modal title={`نقل «${d.member.shopName ?? d.member.name}» في الشجرة`} onClose={onClose}>
      <p className="muted small">الشبكة التي تحته تنتقل معه. التغيير يُسجّل باسمك في سجل التعديلات، ويؤثر على الطلبات التي تُسلّم بعد النقل.</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); run(() => api<MemberRow[]>("GET", "/members" + qs({ program: d.member.program, query: search })), setResults); }}>
        <input className="grow" placeholder="ابحث عن العضو الجديد الأعلى (موبايل / اسم / كود)" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn">بحث</button>
      </form>
      {results.length > 0 && (
        <ul className="list pick">
          {results.filter((r) => r.id !== d.member.id).map((r) => (
            <li key={r.id} className={String(r.id) === parentId ? "selected" : ""} onClick={() => setParentId(String(r.id))}>
              #{r.id} {r.shopName ?? r.name} <span className="muted num" dir="ltr">{r.phone}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="form-grid">
        <Field label="رقم العضو الأعلى الجديد" hint="فارغ = يصبح في أعلى الشجرة"><input type="number" value={parentId} onChange={(e) => setParentId(e.target.value)} /></Field>
        <Field label="السبب (مطلوب)"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      <ErrorBox error={error} />
      <div className="row end">
        <button className="btn" onClick={onClose}>إلغاء</button>
        <button className="btn primary" disabled={busy || !reason.trim()}
          onClick={() => run(() => api("POST", `/members/${d.member.id}/move`, { parentId: parentId ? Number(parentId) : null, reason }), onDone)}>
          تأكيد النقل
        </button>
      </div>
    </Modal>
  );
}
