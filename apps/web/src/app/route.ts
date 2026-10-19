import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Resolve the entry route before rendering a document. A page inside the root
// layout can stream its account fallback before the redirect is ready.
export async function GET() {
  const user = await getCurrentUser();
  return new Response(null, {
    status: 307,
    headers: {
      Location: user ? '/companion' : '/login',
      'Cache-Control': 'private, no-store',
    },
  });
}
