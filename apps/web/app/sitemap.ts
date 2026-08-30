import type { MetadataRoute } from "next";
import { PUBLIC_CONTENT_LAST_UPDATED, PUBLIC_SITE_ORIGIN } from "../lib/public-discovery.js";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${PUBLIC_SITE_ORIGIN}/`,
      lastModified: new Date(`${PUBLIC_CONTENT_LAST_UPDATED}T00:00:00.000Z`),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
