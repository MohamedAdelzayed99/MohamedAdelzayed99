import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Product } from "./api";
import { cache } from "./storage";

export interface CartLine { product: Product; qty: number }

interface CartState {
  lines: CartLine[];
  count: number;
  subtotal: number;
  add: (p: Product, qty?: number) => void;
  setQty: (productId: number, qty: number) => void;
  remove: (productId: number) => void;
  clear: () => void;
}

const Ctx = createContext<CartState | null>(null);

/** Minimum quantity for a product (wholesale min qty, 1 for retail). */
export const minQty = (p: Product) => Math.max(1, p.minQty ?? 1);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    cache.get<CartLine[]>("cart").then((c) => {
      if (Array.isArray(c)) setLines(c);
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (loaded) cache.set("cart", lines);
  }, [lines, loaded]);

  const add = useCallback((p: Product, qty?: number) => {
    setLines((ls) => {
      const existing = ls.find((l) => l.product.id === p.id);
      if (existing) return ls.map((l) => (l.product.id === p.id ? { ...l, qty: l.qty + (qty ?? 1) } : l));
      return [...ls, { product: p, qty: Math.max(qty ?? 1, minQty(p)) }];
    });
  }, []);
  const setQty = useCallback((id: number, qty: number) => {
    setLines((ls) => ls.map((l) => (l.product.id === id ? { ...l, qty: Math.max(qty, minQty(l.product)) } : l)));
  }, []);
  const remove = useCallback((id: number) => setLines((ls) => ls.filter((l) => l.product.id !== id)), []);
  const clear = useCallback(() => setLines([]), []);

  const value = useMemo(
    () => ({
      lines,
      count: lines.reduce((s, l) => s + l.qty, 0),
      subtotal: lines.reduce((s, l) => s + l.qty * l.product.price, 0),
      add, setQty, remove, clear,
    }),
    [lines, add, setQty, remove, clear],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
}
