import { Suspense } from "react";
import SymbolExplorer from "@/components/SymbolExplorer";

// The site opens on the symbol explorer (a static site has no server to redirect with).
export default function Home() {
  return <Suspense fallback={null}><SymbolExplorer /></Suspense>;
}
