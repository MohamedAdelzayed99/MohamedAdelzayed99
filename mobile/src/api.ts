import { API_BASE } from "./config";

// ---- response shapes (mirror backend/hightech/api/presenters.py)

export interface Member {
  id: number;
  program: "retail" | "wholesale";
  phone: string;
  name: string;
  referralCode: string;
  shareLink: string;
  status: "active" | "pending_approval" | "suspended";
  shopName: string | null;
  shopAddress: string | null;
  payoutMethod: string | null;
  payoutAccount: string | null;
  createdAt: string;
}

export interface Category { id: number; name: string }

export interface Product {
  id: number;
  categoryId: number | null;
  name: string;
  description: string;
  imageUrl: string | null;
  price: number;
  originalPrice?: number | null;
  minQty?: number;
  inStock: boolean;
}

export interface Order {
  id: number;
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
}

export interface Wallet {
  available: number;
  pending: number;
  withdrawn: number;
  usedOnInvoices: number;
  lifetime: number;
  minWithdrawal: number;
  canWithdraw: boolean;
  withdrawalMethods: string[];
  earnings: { id: number; order_id: number; level: number; amount: number; status: string; release_at: string; created_at: string }[];
  withdrawals: { id: number; amount: number; method: string; account: string; status: string; note: string; created_at: string }[];
}

export interface NetworkLevel {
  level: number;
  count: number;
  earnedAvailable: number;
  earnedPending: number;
  members?: { id: number; name: string; phone: string; joinedAt: string }[];
}
export interface Network { totalMembers: number; levels: NetworkLevel[] }

export interface AppConfig { shippingFee: number; paymentMethods: string[]; returnWindowDays: number }

export interface Notification { id: number; title: string; body: string; read: number; created_at: string }

// ---- client

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;
export const setApiToken = (t: string | null) => { token = t; };
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network", "لا يوجد اتصال بالإنترنت");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    throw new ApiError(res.status, data.error ?? "error", data.message ?? "حدث خطأ، حاول مرة أخرى");
  }
  return data as T;
}

export const get = <T>(path: string) => api<T>("GET", path);
export const post = <T>(path: string, body?: unknown) => api<T>("POST", path, body ?? {});
export const patch = <T>(path: string, body?: unknown) => api<T>("PATCH", path, body ?? {});
