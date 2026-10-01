"use client";

import { useState } from "react";
import { useCart } from "./cart";
import { PRODUCTS } from "./products";
import styles from "./shop.module.css";

export default function ShopPage() {
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string>();
  const { add } = useCart();
  const shown = PRODUCTS.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <>
      <section className={styles.hero}>
        <h1>Furniture for focused people</h1>
        <p className="muted">
          Add a few things to the cart, then try to pay. The payment provider is having a bad day.
        </p>
        <input
          className={styles.search}
          type="search"
          placeholder="Search products"
          aria-label="Search products"
          data-chronos-unmask
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </section>
      <ul className={styles.grid}>
        {shown.map((product) => (
          <li key={product.id} className={styles.card}>
            <img src={product.image} alt={product.name} width={200} height={200} />
            <h3>{product.name}</h3>
            <p className="muted">{product.blurb}</p>
            <div className={styles.row}>
              <strong>${product.price}</strong>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  add(product);
                  setToast(`${product.name} added`);
                  setTimeout(() => setToast(undefined), 1600);
                }}
              >
                Add to cart
              </button>
            </div>
          </li>
        ))}
        {shown.length === 0 && <li className="muted">No products match “{query}”.</li>}
      </ul>
      <div className="toast" data-show={toast ? "" : undefined} role="status">
        {toast}
      </div>
    </>
  );
}
