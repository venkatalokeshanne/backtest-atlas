import type { Metadata } from "next";
import AllBacktestsView from "@/components/AllBacktestsView";

export const metadata: Metadata = { title: "All backtests" };

export default function BacktestsPage() {
  return <AllBacktestsView />;
}
