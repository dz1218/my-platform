import { AudioLines } from "lucide-react";

export function RadioMark({ className = "" }: { className?: string }) {
  return <span className={`radio-mark ${className}`} aria-hidden="true"><AudioLines strokeWidth={1.75} /></span>;
}
