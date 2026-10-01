"use client";

import { useState } from "react";
import { useCart } from "../cart";

const COUPONS: Record<string, { percent: number }> = { WELCOME10: { percent: 10 } };

export default function CheckoutPage() {
  const { lines, total } = useCart();
  const [coupon, setCoupon] = useState("");
  const [discount, setDiscount] = useState(0);
  const [status, setStatus] = useState<"idle" | "paying" | "failed">("idle");
  const [message, setMessage] = useState("");

  function applyCoupon() {
    // Bug on purpose: an unknown code reads `.percent` of undefined and the
    // click handler throws. No error boundary sees it; the browser does.
    const code = coupon.trim().toUpperCase();
    setDiscount(COUPONS[code].percent);
  }

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    setStatus("paying");
    const response = await fetch("/api/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: total }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setStatus("failed");
      setMessage(body.error ?? `Payment failed (${response.status})`);
    }
  }

  const due = total * (1 - discount / 100);
  return (
    <div className="checkout">
      <form className="panel" onSubmit={pay}>
        <h1>Checkout</h1>
        <label>
          Full name
          <input name="name" autoComplete="name" required />
        </label>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Card number
          <input name="card" inputMode="numeric" autoComplete="cc-number" placeholder="1234 5678 9012 3456" required />
        </label>
        <div className="two">
          <label>
            Expiry
            <input name="expiry" placeholder="MM/YY" required />
          </label>
          <label>
            Country
            <select name="country" defaultValue="NO">
              <option value="NO">Norway</option>
              <option value="SE">Sweden</option>
              <option value="DK">Denmark</option>
              <option value="GB">United Kingdom</option>
            </select>
          </label>
        </div>
        <label className="check">
          <input type="checkbox" name="save" /> Save my details for next time
        </label>
        <div className="coupon">
          <input
            aria-label="Coupon code"
            placeholder="Coupon code"
            value={coupon}
            onChange={(e) => setCoupon(e.target.value)}
            data-chronos-unmask
          />
          <button type="button" className="ghost" onClick={applyCoupon}>
            Apply
          </button>
        </div>
        {status === "failed" && (
          <p className="alert" role="alert">
            <strong>Payment failed.</strong> {message}. You have not been charged.
          </p>
        )}
        <button type="submit" className="primary wide" disabled={status === "paying"}>
          {status === "paying" ? "Paying…" : `Pay $${due.toFixed(2)}`}
        </button>
      </form>
      <aside className="panel summary">
        <h2>Order</h2>
        {lines.length === 0 && <p className="muted">Your cart is empty.</p>}
        {lines.map(({ product, quantity }) => (
          <div key={product.id} className="summary-line">
            <span>
              {product.name} × {quantity}
            </span>
            <span>${(product.price * quantity).toFixed(2)}</span>
          </div>
        ))}
        {discount > 0 && (
          <div className="summary-line">
            <span>Coupon</span>
            <span>−{discount}%</span>
          </div>
        )}
        <div className="summary-line total">
          <span>Total</span>
          <span>${due.toFixed(2)}</span>
        </div>
      </aside>
    </div>
  );
}
