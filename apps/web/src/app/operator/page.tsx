import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { OperatorConversations } from "@/features/chat/operator-conversations";
export default async function OperatorPage() {
  if (!(await getCurrentUser())) redirect('/login');
  return <OperatorConversations />;
}
