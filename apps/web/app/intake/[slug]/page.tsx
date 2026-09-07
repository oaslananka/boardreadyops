import type { Metadata } from "next";
import { ManufacturerIntakeWidget } from "../../../components/intake/manufacturer-intake-widget.js";
import { AppShell } from "../../../components/ui.js";

export interface ManufacturerIntakePageProps {
  params: Promise<{ slug: string }>;
}

const PARTNER_DIRECTORY: Record<string, string> = {
  eurocircuits: "Eurocircuits Quick-Turn",
  jlcpcb: "JLCPCB SMT Production",
  pcbway: "PCBWay Fast Turnaround",
  aisler: "Aisler Powerful Hardware",
  custom: "Custom Quick-Turn Fabricator",
};

export async function generateMetadata({ params }: ManufacturerIntakePageProps): Promise<Metadata> {
  const { slug } = await params;
  const partnerName = PARTNER_DIRECTORY[slug.toLowerCase()] || `${slug.toUpperCase()} Fabrication`;

  return {
    title: `Pre-Flight Intake & Pre-Order Verification | ${partnerName}`,
    description: `Automated multi-CAD pre-flight review and Engineering Query (EQ) triage for ${partnerName}. Verify Gerbers, drill, and BOM before ordering.`,
  };
}

export default async function ManufacturerIntakePage({ params }: Readonly<ManufacturerIntakePageProps>) {
  const { slug } = await params;
  const partnerName = PARTNER_DIRECTORY[slug.toLowerCase()] || `${slug.toUpperCase()} Fabrication`;

  return (
    <AppShell
      breadcrumbs={[
        { href: "/", label: "Home" },
        { href: "/intake", label: "Manufacturer Intake" },
        { label: partnerName },
      ]}
    >
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <header>
          <h1 className="text-2xl font-bold text-foreground">Manufacturer Intake — {partnerName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Automated multi-CAD pre-flight review and Engineering Query triage before a fabrication order is placed.
          </p>
        </header>

        <ManufacturerIntakeWidget partnerSlug={slug} partnerName={partnerName} />
      </main>
    </AppShell>
  );
}
