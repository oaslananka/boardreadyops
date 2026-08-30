import type { MetadataRoute } from "next";
import { PUBLIC_SITE_ORIGIN } from "../lib/public-discovery.js";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/setup",
        "/dashboard",
        "/work",
        "/evidence",
        "/insights",
        "/policies",
        "/repositories/",
        "/reviews/",
        "/runs/",
        "/settings/",
      ],
    },
    sitemap: [`${PUBLIC_SITE_ORIGIN}/sitemap.xml`, `${PUBLIC_SITE_ORIGIN}/sitemap.md`],
  };
}
