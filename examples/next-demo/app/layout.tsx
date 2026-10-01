import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chronos demo shop",
  description: "A sample app recorded by chronosjs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
