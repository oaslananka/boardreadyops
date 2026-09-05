import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { notFound } from "next/navigation";
import { DeliverySignoffCard } from "../../../components/delivery-signoff-card.js";
import { AppShell, Breadcrumbs, EmptyState } from "../../../components/ui.js";
import { resolveCloudPersistenceConfiguration } from "../../../lib/cloud-runtime-config.js";
import { verifyDeliveryToken } from "../../../lib/delivery-auth.js";

export interface DeliveryPageProps {
  params: Promise<{ token: string }>;
}

export default async function DeliveryPage({ params }: DeliveryPageProps) {
  const { token } = await params;
  const config = resolveCloudPersistenceConfiguration();

  if (config.mode !== "postgres") {
    return (
      <AppShell>
        <main className="shell compact-shell" id="main-content">
          <EmptyState title="Service Unavailable">
            <p>Delivery storage is currently unavailable.</p>
          </EmptyState>
        </main>
      </AppShell>
    );
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  let authResult: Awaited<ReturnType<typeof verifyDeliveryToken>>;
  try {
    authResult = await verifyDeliveryToken(token, executor);
  } finally {
    await executor.close();
  }

  if (!authResult.ok) {
    if (authResult.status === 410) {
      return (
        <AppShell>
          <main className="shell compact-shell" id="main-content">
            <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Expired Delivery" }]} />
            <section className="run-state-surface">
              <EmptyState title="Delivery link has expired">
                <p>
                  This secure delivery package was time-limited and has expired. Contact the sender to request a renewed
                  link.
                </p>
              </EmptyState>
            </section>
          </main>
        </AppShell>
      );
    }
    notFound();
  }

  const delivery = authResult.delivery;
  if (!delivery) {
    notFound();
  }

  return (
    <AppShell>
      <main className="shell compact-shell" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Secure Hardware Package Delivery" }]} />
        <section className="run-state-surface">
          <DeliverySignoffCard
            revisionId={delivery.revisionId}
            signedArchiveUrl={delivery.signedArchiveUrl}
            recipientNotes={delivery.recipientNotes ?? undefined}
            expiresAt={new Date(delivery.expiresAt).toISOString()}
          />
        </section>
      </main>
    </AppShell>
  );
}
