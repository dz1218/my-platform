import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  // Only public, server-rendered editorial pages; never account data or drafts.
  return ["/", "/privacy"].map((path) => ({
    url: new URL(path, siteUrl).href,
  }));
}
