import type { MetadataRoute } from "next";
import { siteUrl } from "./sitemap";

/** Les pages publiques s'indexent ; l'application, la connexion et les liens de consultation jamais. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/auth/",
          "/*/app",
          "/*/d/",
          "/*/invite",
          "/*/login",
          "/*/signup",
          "/*/no-access",
        ],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
