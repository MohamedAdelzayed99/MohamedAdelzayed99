import { useState } from "react";
import { api } from "../api";
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, money, toEGP, toPiastres, useAction, useApi } from "../ui";

interface Product {
  id: number;
  categoryId: number | null;
  name: string;
  description: string;
  imageUrl: string | null;
  retailPrice: number;
  retailOfferPrice: number | null;
  wholesalePrice: number;
  wholesaleMinQty: number;
  stock: number;
  active: boolean;
}
interface Category { id: number; name: string; sort: number }

export function Products() {
  const [products, error, reload] = useApi(() => api<Product[]>("GET", "/products"), []);
  const [cats, catError, reloadCats] = useApi(() => api<Category[]>("GET", "/categories"), []);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [filter, setFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const catName = (id: number | null) => cats?.find((c) => c.id === id)?.name ?? "—";

  const shown = (products ?? []).filter(
    (p) => (!filter || p.name.includes(filter)) && (!catFilter || String(p.categoryId) === catFilter),
  );

  return (
    <div className="page">
      <header className="page-head">
        <h1>المنتجات</h1>
        <button className="btn primary" onClick={() => setEditing("new")}>+ منتج جديد</button>
      </header>
      <ErrorBox error={error ?? catError} />
      <div className="grid-side">
        <Card
          title={`كل المنتجات (${products?.length ?? 0})`}
          actions={
            <>
              <input placeholder="بحث بالاسم" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
                <option value="">كل الأقسام</option>
                {cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </>
          }
        >
          {!products ? <Loading /> : shown.length === 0 ? <Empty /> : (
            <table>
              <thead>
                <tr><th></th><th>المنتج</th><th>القسم</th><th>سعر القطاعي</th><th>سعر الجملة</th><th>أقل كمية جملة</th><th>المخزون</th><th>الحالة</th><th></th></tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td>{p.imageUrl ? <img className="thumb" src={p.imageUrl} alt="" /> : <div className="thumb ph">📦</div>}</td>
                    <td><b>{p.name}</b></td>
                    <td>{catName(p.categoryId)}</td>
                    <td>
                      {p.retailOfferPrice != null ? (
                        <><b>{money(p.retailOfferPrice)}</b> <s className="muted">{money(p.retailPrice)}</s> <Badge value="amber" label="عرض" /></>
                      ) : money(p.retailPrice)}
                    </td>
                    <td>{money(p.wholesalePrice)}</td>
                    <td>{p.wholesaleMinQty}</td>
                    <td className={p.stock <= 10 ? "warn-text" : ""}>{p.stock}</td>
                    <td>{p.active ? <Badge value="active" label="ظاهر" /> : <Badge value="gray" label="مخفي" />}</td>
                    <td><button className="btn small" onClick={() => setEditing(p)}>تعديل</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Categories cats={cats} reload={reloadCats} />
      </div>
      {editing && (
        <ProductForm
          product={editing === "new" ? null : editing}
          cats={cats ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

function ProductForm({ product, cats, onClose, onSaved }: { product: Product | null; cats: Category[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: product?.name ?? "",
    description: product?.description ?? "",
    imageUrl: product?.imageUrl ?? "",
    categoryId: product?.categoryId ? String(product.categoryId) : "",
    retailPrice: toEGP(product?.retailPrice),
    retailOfferPrice: toEGP(product?.retailOfferPrice),
    wholesalePrice: toEGP(product?.wholesalePrice),
    wholesaleMinQty: String(product?.wholesaleMinQty ?? 1),
    stock: String(product?.stock ?? 0),
    active: product?.active ?? true,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const { busy, error, run } = useAction();
  const save = () =>
    run(
      () =>
        api(product ? "PUT" : "POST", product ? `/products/${product.id}` : "/products", {
          name: f.name,
          description: f.description,
          imageUrl: f.imageUrl,
          categoryId: f.categoryId ? Number(f.categoryId) : null,
          retailPrice: toPiastres(f.retailPrice),
          retailOfferPrice: f.retailOfferPrice === "" ? null : toPiastres(f.retailOfferPrice),
          wholesalePrice: toPiastres(f.wholesalePrice),
          wholesaleMinQty: Number(f.wholesaleMinQty),
          stock: Number(f.stock),
          active: f.active,
        }),
      onSaved,
    );
  return (
    <Modal title={product ? `تعديل: ${product.name}` : "منتج جديد"} onClose={onClose}>
      <div className="form-grid">
        <Field label="اسم المنتج"><input value={f.name} onChange={set("name")} /></Field>
        <Field label="القسم">
          <select value={f.categoryId} onChange={set("categoryId")}>
            <option value="">بدون قسم</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="سعر القطاعي (جنيه)"><input type="number" min="0" step="0.01" value={f.retailPrice} onChange={set("retailPrice")} /></Field>
        <Field label="سعر العرض للقطاعي (جنيه)" hint="اتركه فارغًا لو لا يوجد عرض"><input type="number" min="0" step="0.01" value={f.retailOfferPrice} onChange={set("retailOfferPrice")} /></Field>
        <Field label="سعر الجملة (جنيه)" hint="لا يظهر أبدًا في تطبيق القطاعي"><input type="number" min="0" step="0.01" value={f.wholesalePrice} onChange={set("wholesalePrice")} /></Field>
        <Field label="أقل كمية للجملة"><input type="number" min="1" value={f.wholesaleMinQty} onChange={set("wholesaleMinQty")} /></Field>
        <Field label="المخزون"><input type="number" min="0" value={f.stock} onChange={set("stock")} /></Field>
        <Field label="رابط الصورة"><input dir="ltr" value={f.imageUrl} onChange={set("imageUrl")} placeholder="https://…" /></Field>
        <Field label="الوصف"><textarea rows={3} value={f.description} onChange={set("description")} /></Field>
        <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> ظاهر في التطبيقين</label>
      </div>
      <ErrorBox error={error} />
      <div className="row end">
        <button className="btn" onClick={onClose}>إلغاء</button>
        <button className="btn primary" disabled={busy} onClick={save}>{busy ? "جارِ الحفظ…" : "حفظ"}</button>
      </div>
    </Modal>
  );
}

function Categories({ cats, reload }: { cats?: Category[]; reload: () => void }) {
  const [name, setName] = useState("");
  const [edit, setEdit] = useState<{ id: number; name: string; sort: string } | null>(null);
  const { busy, error, run } = useAction();
  return (
    <Card title="الأقسام">
      {!cats ? <Loading /> : (
        <ul className="list">
          {cats.map((c) =>
            edit?.id === c.id ? (
              <li key={c.id} className="row">
                <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                <input className="w60" type="number" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: e.target.value })} title="الترتيب" />
                <button className="btn small primary" disabled={busy}
                  onClick={() => run(() => api("PUT", `/categories/${c.id}`, { name: edit.name, sort: Number(edit.sort) }), () => { setEdit(null); reload(); })}>حفظ</button>
              </li>
            ) : (
              <li key={c.id} className="row between">
                <span>{c.name} <small className="muted">#{c.sort}</small></span>
                <button className="btn small ghost" onClick={() => setEdit({ id: c.id, name: c.name, sort: String(c.sort) })}>تعديل</button>
              </li>
            ),
          )}
        </ul>
      )}
      <form className="row" onSubmit={(e) => { e.preventDefault(); run(() => api("POST", "/categories", { name, sort: cats?.length ?? 0 }), () => { setName(""); reload(); }); }}>
        <input placeholder="قسم جديد" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={busy || !name.trim()}>إضافة</button>
      </form>
      <ErrorBox error={error} />
    </Card>
  );
}
