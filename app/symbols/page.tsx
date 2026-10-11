import type { Metadata } from "next";
import { Suspense } from "react";
import SymbolExplorer from "@/components/SymbolExplorer";

export const metadata: Metadata = { title: "Explore by symbol" };

export default function SymbolsPage() {
  return <Suspense fallback={null}><SymbolExplorer /></Suspense>;
}
