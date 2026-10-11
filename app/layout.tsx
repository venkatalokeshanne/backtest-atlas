import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import Shell from "@/components/Shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Backtest Atlas", template: "%s · Backtest Atlas" },
  description: "Every TradingView and TrendSpider strategy we backtested, ranked per stock.",
};

// No page zoom on phones: the layout already fits the screen, and inputs are 16px so focusing one does not zoom.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0c0e12",
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
