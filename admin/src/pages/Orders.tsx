import { useState } from "react";
import { api, qs } from "../api";
import { Badge, Card, date, Empty, ErrorBox, Loading, METHOD_AR, money, ORDER_STATUS_AR, PROGRAM_AR, useAction, useApi } from "../ui";

export interface Order {
  id: number;
  program: string;
  memberId: number;
  status: string;
  statusLabel: string;
  paymentMethod: string;
  paymentStatus: string;
  subtotal: number;
  discountUsed: number;
  shippingFee: number;
  total: number;
  address: string;
  governorate: string;
  contactPhone: string;
  notes: string;
  createdAt: string;
  deliveredAt: string | null;
  releaseAt: string | null;
  items: { productId: number; name: string; unitPrice: number; qty: number }[];
  history: { status: string; note: string; at: string }[];
  member?: { id: number; name: string; phone: string };
}

const NEXT: Record<string, string[]> = {
  placed: ["confirmed", "cancelled"],
  confirmed: ["shipped", "cancelled"],
  shipped: ["delivered", "cancelled"],
  delivered: ["returned"],
};
const ACTION_AR: Record<string, string> = {
  confirmed: "تأكيد الطلب", shipped: "تم الشحن", delivered: "تم التسليم", cancelled: "إلغاء", returned: "تسجيل مرتجع",
};
const PAY_AR: Record<string, string> = { unpaid: "غير مدفوع", paid: "مدفوع", refunded: "مسترد" };

export function Orders() {
  const [program, setProgram] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [orders, error, reload] = useApi(() => api<Order[]>("GET", "/orders" + qs({ program, status, query: q })), [program, status, q]);
  return (
    <div className="page">
      <header className="page-head">
        <h1>الطلبات والفواتير</h1>
        <form className="row" onSubmit={(e) => { e.preventDefault(); setQ(query.trim()); }}>
          <select value={program} onChange={(e) => setProgram(e.target.value)}>
            <option value="">القطاعي والجملة</option>
            <option value="retail">القطاعي</option>
            <option value="wholesale">الجملة</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">كل الحالات</option>
            {Object.entries(ORDER_STATUS_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input placeholder="رقم الطلب / الموبايل / الاسم" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="btn">بحث</button>
          <button type="button" className="btn ghost" onClick={reload}>↻</button>
        </form>
      </header>
      <ErrorBox error={error} />
      <Card>
        {!orders ? <Loading /> : orders.length === 0 ? <Empty text="لا توجد طلبات" /> : (
          <table>
            <thead>
              <tr><th>رقم</th><th>التطبيق</th><th>العميل</th><th>التاريخ</th><th>الأصناف</th><th>الإجمالي</th><th>الدفع</th><th>الحالة</th></tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="clickable" onClick={() => (location.hash = `/orders/${o.id}`)}>
                  <td><b>#{o.id}</b></td>
                  <td><Badge value={o.program} label={PROGRAM_AR[o.program]} /></td>
                  <td>{o.member?.name}<div className="muted small num" dir="ltr">{o.member?.phone}</div></td>
                  <td className="num">{date(o.createdAt)}</td>
                  <td>{o.items.reduce((s, i) => s + i.qty, 0)} قطعة</td>
                  <td><b>{money(o.total)}</b></td>
                  <td><Badge value={o.paymentStatus} label={`${METHOD_AR[o.paymentMethod] ?? o.paymentMethod} · ${PAY_AR[o.paymentStatus]}`} /></td>
                  <td><Badge value={o.status} label={ORDER_STATUS_AR[o.status]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

export function OrderDetail({ id }: { id: number }) {
  const [order, error, reload] = useApi(() => api<Order>("GET", `/orders/${id}`), [id]);
  const [note, setNote] = useState("");
  const { busy, error: actionError, run } = useAction();
  const memberId = order?.memberId;
  const [customer] = useApi(
    () => (memberId ? api<{ member: { name: string; shopName: string | null } }>("GET", `/members/${memberId}`) : Promise.resolve(undefined)),
    [memberId],
  );
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!order) return <Loading />;
  const setStatus = (status: string) => {
    if ((status === "cancelled" || status === "returned") && !confirm(`تأكيد: ${ACTION_AR[status]} للطلب #${order.id}؟`)) return;
    run(() => api("POST", `/orders/${order.id}/status`, { status, note }), () => { setNote(""); reload(); });
  };
  const next = NEXT[order.status] ?? [];
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <a href="#/orders" className="back">→ كل الطلبات</a>
          <h1>
            {order.program === "wholesale" ? "فاتورة" : "طلب"} #{order.id}{" "}
            <Badge value={order.status} label={ORDER_STATUS_AR[order.status]} />{" "}
            <Badge value={order.program} label={PROGRAM_AR[order.program]} />
          </h1>
        </div>
      </header>
      <div className="grid-side">
        <div>
          <Card title="الأصناف">
            <table>
              <thead><tr><th>المنتج</th><th>السعر</th><th>الكمية</th><th>الإجمالي</th></tr></thead>
              <tbody>
                {order.items.map((i) => (
                  <tr key={i.productId}><td>{i.name}</td><td>{money(i.unitPrice)}</td><td>{i.qty}</td><td>{money(i.unitPrice * i.qty)}</td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={3}>قيمة المنتجات (تُحسب عليها العمولة)</td><td>{money(order.subtotal)}</td></tr>
                {order.discountUsed > 0 && <tr><td colSpan={3}>خصم من رصيد المحل</td><td className="green-text">− {money(order.discountUsed)}</td></tr>}
                <tr><td colSpan={3}>الشحن</td><td>{money(order.shippingFee)}</td></tr>
                <tr className="total"><td colSpan={3}>الإجمالي المطلوب</td><td>{money(order.total)}</td></tr>
              </tfoot>
            </table>
          </Card>
          <Card title="سجل الحالة">
            <ol className="timeline">
              {order.history.map((h, i) => (
                <li key={i}>
                  <Badge value={h.status} label={ORDER_STATUS_AR[h.status]} /> <span className="muted num">{date(h.at)}</span>
                  {h.note && <div className="small">{h.note}</div>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div>
          <Card title="تغيير الحالة">
            {next.length === 0 ? <p className="muted">الطلب مغلق ({ORDER_STATUS_AR[order.status]}).</p> : (
              <>
                <input placeholder="ملاحظة (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} className="block" />
                <div className="row wrap" style={{ marginTop: 10 }}>
                  {next.map((s) => (
                    <button key={s} disabled={busy} className={`btn ${s === "cancelled" || s === "returned" ? "danger" : "primary"}`} onClick={() => setStatus(s)}>
                      {ACTION_AR[s]}
                    </button>
                  ))}
                </div>
              </>
            )}
            {order.paymentStatus === "unpaid" && order.paymentMethod !== "cod" && !["cancelled", "returned"].includes(order.status) && (
              <button className="btn" disabled={busy} style={{ marginTop: 10 }} onClick={() => run(() => api("POST", `/orders/${order.id}/paid`), reload)}>
                تسجيل الدفع
              </button>
            )}
            <ErrorBox error={actionError} />
            {order.status === "delivered" && order.releaseAt && (
              <p className="muted small">العمولات معلّقة حتى {date(order.releaseAt)} (نهاية مدة الإرجاع)، ويمكن تسجيل المرتجع قبلها فقط.</p>
            )}
          </Card>
          <Card title="العميل والتوصيل">
            <dl className="kv">
              <dt>العميل</dt><dd><a href={`#/members/${order.memberId}`}>{customer ? (customer.member.shopName ?? customer.member.name) : `عضو #${order.memberId}`}</a></dd>
              <dt>موبايل التواصل</dt><dd dir="ltr" className="num">{order.contactPhone}</dd>
              <dt>العنوان</dt><dd>{order.address}{order.governorate && ` — ${order.governorate}`}</dd>
              <dt>الدفع</dt><dd>{METHOD_AR[order.paymentMethod] ?? order.paymentMethod} · {PAY_AR[order.paymentStatus]}</dd>
              <dt>تاريخ الطلب</dt><dd className="num">{date(order.createdAt)}</dd>
              {order.deliveredAt && <><dt>تاريخ التسليم</dt><dd className="num">{date(order.deliveredAt)}</dd></>}
              {order.notes && <><dt>ملاحظات</dt><dd>{order.notes}</dd></>}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
