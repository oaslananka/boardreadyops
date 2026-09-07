import { Skeleton } from "../../components/ui/skeleton.js";
import { AppShell } from "../../components/ui.js";

export default function Loading() {
  return (
    <AppShell breadcrumbs={[{ href: "/dashboard", label: "Dashboard" }, { label: "Settings" }]}>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8" id="main-content" aria-busy="true">
        <p className="sr-only">Loading settings</p>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full max-w-72" />
          <Skeleton className="h-4 w-full max-w-96" />
        </div>
        <Skeleton className="h-10 rounded-md" />
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((slot) => (
            <Skeleton key={slot} className="h-14 rounded-md" />
          ))}
        </div>
      </main>
    </AppShell>
  );
}
