import type { Metadata } from "next";

import { SampleWizard } from "@/components/sample/sample-wizard";

export const metadata: Metadata = {
  title: "Price a Sample — Hood Container Dieline Studio",
  description: "Measure a flat corrugated blank and get inside box dimensions",
};

export default function SamplePage() {
  return <SampleWizard />;
}
