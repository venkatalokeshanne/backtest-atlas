import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import SymbolView from "@/components/SymbolView";

type Summary = { symbol: string; name: string };
function symbols(): Summary[] {
  const f = path.join(process.cwd(), "public", "data", "symbols.json");
  return JSON.parse(fs.readFileSync(f, "utf-8")).symbols;
}

// one prebuilt page per stock in the data
export function generateStaticParams() {
  return symbols().map((s) => ({ symbol: s.symbol }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const { symbol } = await params;
  const s = symbols().find((x) => x.symbol === symbol);
  return { title: s ? `${s.name} (${s.symbol}) — best backtested strategies` : symbol };
}

export default async function SymbolPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return <SymbolView symbol={symbol} />;
}
