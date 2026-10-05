import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { OperatorConversations } from "@/features/chat/operator-conversations";
export default async function OperatorPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!user.inheritedIdentity) redirect('/choose-identity');
  return <OperatorConversations identity={user.inheritedIdentity} />;
}
