import Link from "next/link";
import { CartButton, CartDrawer, CartProvider } from "./cart";
import { Recorder } from "./recorder";

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <Recorder />
      <header className="topbar">
        <Link href="/" className="brand">
          ◷ Chronos shop
        </Link>
        <nav>
          <Link href="/">Shop</Link>
          <Link href="/checkout">Checkout</Link>
          <Link href="/reports">Reports</Link>
          <a href="/replays">Replays ↗</a>
        </nav>
        <CartButton />
      </header>
      <main className="page">{children}</main>
      <CartDrawer />
    </CartProvider>
  );
}
