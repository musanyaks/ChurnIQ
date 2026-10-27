import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AppShell } from "@/components/shell";

export const metadata: Metadata = {
  title: "ChurnIQ — Real-Time Customer Churn & Retention Intelligence",
  description:
    "Production-grade churn intelligence platform: synthetic Kenyan insurance book, feature store, gradient-boosted churn models, SHAP-style explanations, real-time event streaming and retention decisioning.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-ink-950 text-ivory antialiased">
        <div className="ciq-backdrop" aria-hidden />
        <div className="ciq-grid" aria-hidden />
        <div className="ciq-scan" aria-hidden />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
