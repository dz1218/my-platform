import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  // Keep pages crawlable so crawlers can read their noindex directives.
  return { rules: { userAgent: '*', allow: '/', disallow: ['/api/'] }, sitemap: new URL('/sitemap.xml', siteUrl).href };
}
