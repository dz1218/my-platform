"use client";

import { useEffect, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";

export function GenderHelp() {
  const [open, setOpen] = useState(false);
  const help = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!help.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return <div className="auth-field-heading">
    <label htmlFor="register-gender">性别</label>
    <span ref={help} className="auth-help" onPointerEnter={event => {
      if (event.pointerType === "mouse") setOpen(true);
    }} onPointerLeave={() => {
      if (!help.current?.contains(document.activeElement)) setOpen(false);
    }} onBlur={() => setOpen(false)}>
      <button type="button" className="auth-help-trigger" aria-label="为什么需要选择性别" aria-describedby="register-gender-help" onFocus={() => setOpen(true)} onClick={() => setOpen(true)}>
        <CircleHelp size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <span id="register-gender-help" role="tooltip" className="auth-help-tooltip" hidden={!open}>
        <span>用于匹配 AI 身份，注册后可跳过继承。</span>
      </span>
    </span>
  </div>;
}
