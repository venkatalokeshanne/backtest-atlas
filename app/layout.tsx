import type { Metadata } from "next";
import { Suspense } from "react";
import Shell from "@/components/Shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Backtest Atlas", template: "%s · Backtest Atlas" },
  description: "Every TradingView and TrendSpider strategy we backtested, ranked per stock.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={null}>
          <Shell>{children}</Shell>
        </Suspense>
      </body>
    </html>
  );
}
