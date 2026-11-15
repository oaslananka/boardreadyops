import { Skeleton } from "../../components/ui/skeleton.js";

export default function Loading() {
  // The parent SettingsLayout already renders AppShell, the page heading,
  // the Settings navigation, and the sole main landmark.
  return (
    <div className="flex min-w-0 w-full flex-col gap-5" aria-busy="true">
      <p className="sr-only" role="status">
        Loading settings section
      </p>
      <Skeleton className="h-6 w-full max-w-56" />
      <Skeleton className="h-4 w-full max-w-80" />
      <Skeleton className="h-10 w-full rounded-md" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3].map((slot) => (
          <Skeleton key={slot} className="h-14 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}
