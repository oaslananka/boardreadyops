import { type FilteredRunPageProps, renderFilteredRunPage, resolveFilteredRunMetadata } from "../filtered-run-page.js";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: FilteredRunPageProps) {
  return resolveFilteredRunMetadata(params, "Findings");
}

export default async function FindingsPage(props: FilteredRunPageProps) {
  return renderFilteredRunPage({ ...props, active: "findings" });
}
