import { PUBLIC_CONTENT_LAST_UPDATED, PUBLIC_SITE_ORIGIN } from "../lib/public-discovery.js";

const homepageUrl = `${PUBLIC_SITE_ORIGIN}/`;
const productDescription = "Checks whether a KiCad board is ready to fabricate, on every pull request.";

export const PUBLIC_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${PUBLIC_SITE_ORIGIN}/#website`,
      name: "BoardReadyOps",
      url: homepageUrl,
      description: productDescription,
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${PUBLIC_SITE_ORIGIN}/#software`,
      name: "BoardReadyOps",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      url: homepageUrl,
      description: productDescription,
    },
    {
      "@type": "WebPage",
      "@id": `${PUBLIC_SITE_ORIGIN}/#webpage`,
      headline: "Catch board mistakes before the fab does.",
      description: productDescription,
      url: homepageUrl,
      dateModified: PUBLIC_CONTENT_LAST_UPDATED,
      isPartOf: { "@id": `${PUBLIC_SITE_ORIGIN}/#website` },
      about: { "@id": `${PUBLIC_SITE_ORIGIN}/#software` },
      breadcrumb: { "@id": `${PUBLIC_SITE_ORIGIN}/#breadcrumbs` },
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${PUBLIC_SITE_ORIGIN}/#breadcrumbs`,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "BoardReadyOps",
          item: homepageUrl,
        },
      ],
    },
  ],
} as const;

export function PublicStructuredData() {
  const serialized = JSON.stringify(PUBLIC_STRUCTURED_DATA).replaceAll("<", String.raw`\u003c`);
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON is built entirely from repository-owned constants and escaped before insertion.
      dangerouslySetInnerHTML={{ __html: serialized }}
    />
  );
}
