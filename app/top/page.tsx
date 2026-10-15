import type { Metadata } from "next";
import TopStrategiesView from "@/components/TopStrategiesView";

export const metadata: Metadata = { title: "Top strategies" };

export default function TopPage() {
  return <TopStrategiesView />;
}
