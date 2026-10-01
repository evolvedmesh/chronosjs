"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { PRODUCTS, type Product } from "./products";

interface Cart {
  lines: { product: Product; quantity: number }[];
  count: number;
  total: number;
  open: boolean;
  setOpen: (open: boolean) => void;
  add: (product: Product) => void;
  remove: (id: string) => void;
}

const CartContext = createContext<Cart | null>(null);

export function useCart(): Cart {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("useCart outside CartProvider");
  return cart;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const cart = useMemo<Cart>(() => {
    const lines = PRODUCTS.filter((p) => quantities[p.id]).map((product) => ({
      product,
      quantity: quantities[product.id],
    }));
    return {
      lines,
      count: lines.reduce((sum, line) => sum + line.quantity, 0),
      total: lines.reduce((sum, line) => sum + line.quantity * line.product.price, 0),
      open,
      setOpen,
      add: (product) => setQuantities((q) => ({ ...q, [product.id]: (q[product.id] ?? 0) + 1 })),
      remove: (id) => setQuantities((q) => ({ ...q, [id]: 0 })),
    };
  }, [quantities, open]);
  return <CartContext.Provider value={cart}>{children}</CartContext.Provider>;
}

/**
 * Inserts its rules with `CSSStyleSheet.insertRule`, the way CSS-in-JS
 * libraries (emotion, styled-components) do in production: the <style> stays
 * empty, so a recorder that only copies the DOM would lose them.
 */
function useCssomRules() {
  useEffect(() => {
    if (document.querySelector("style[data-cssom]")) return;
    const style = document.createElement("style");
    style.dataset.cssom = "";
    document.head.appendChild(style);
    const sheet = style.sheet as CSSStyleSheet;
    sheet.insertRule(
      "@keyframes bump { 0% { transform: scale(1) } 40% { transform: scale(1.45) } 100% { transform: scale(1) } }",
    );
    sheet.insertRule(
      ".badge { background: #e4572e; color: #fff; border-radius: 999px; min-width: 22px; height: 22px; padding: 0 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; }",
      sheet.cssRules.length,
    );
    sheet.insertRule(".badge-bump { animation: bump 380ms ease-out; }", sheet.cssRules.length);
  }, []);
}

export function CartButton() {
  const { count, setOpen } = useCart();
  const badge = useRef<HTMLSpanElement>(null);
  useCssomRules();
  useEffect(() => {
    const el = badge.current;
    if (!el || !count) return;
    el.classList.remove("badge-bump");
    void el.offsetWidth;
    el.classList.add("badge-bump");
  }, [count]);
  return (
    <button type="button" className="cart-button" onClick={() => setOpen(true)} aria-label={`Cart, ${count} items`}>
      Cart{" "}
      <span ref={badge} className="badge">
        {count}
      </span>
    </button>
  );
}

export function CartDrawer() {
  const { lines, total, open, setOpen, remove } = useCart();
  return (
    <>
      <div className="scrim" data-open={open || undefined} onClick={() => setOpen(false)} aria-hidden="true" />
      <aside className="drawer" data-open={open || undefined} aria-label="Cart" aria-hidden={!open}>
        <header>
          <h2>Your cart</h2>
          <button type="button" className="ghost" onClick={() => setOpen(false)} aria-label="Close cart">
            ✕
          </button>
        </header>
        {lines.length === 0 ? (
          <p className="muted">Nothing here yet.</p>
        ) : (
          <ul className="lines">
            {lines.map(({ product, quantity }) => (
              <li key={product.id}>
                <img src={product.image} alt="" width={48} height={48} />
                <span>
                  {product.name} × {quantity}
                </span>
                <strong>${(product.price * quantity).toFixed(2)}</strong>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => remove(product.id)}
                  aria-label={`Remove ${product.name}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <footer>
          <span>Total</span>
          <strong>${total.toFixed(2)}</strong>
        </footer>
        <Link className="primary" href="/checkout" onClick={() => setOpen(false)}>
          Go to checkout
        </Link>
      </aside>
    </>
  );
}
