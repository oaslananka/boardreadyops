import { type FilteredRunPageProps, renderFilteredRunPage, resolveFilteredRunMetadata } from "../filtered-run-page.js";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: FilteredRunPageProps) {
  return resolveFilteredRunMetadata(params, "Artifacts");
}

export default async function ArtifactsPage(props: FilteredRunPageProps) {
  return renderFilteredRunPage({ ...props, active: "artifacts" });
}
