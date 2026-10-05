"use client";

import { useEffect, type ReactNode, type RefObject } from "react";

export function ChatSettings({
  dialogRef,
  identityName,
  children,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  identityName: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const compact = window.matchMedia("(max-width: 1099px)");
    const updateLayout = () => {
      if (dialog.open) dialog.close();
      if (!compact.matches) dialog.show();
    };
    updateLayout();
    compact.addEventListener("change", updateLayout);
    return () => compact.removeEventListener("change", updateLayout);
  }, [dialogRef]);

  return (
    <dialog
      ref={dialogRef}
      id="conversation-settings"
      aria-labelledby="conversation-settings-title"
      className="chat-settings"
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
          event.currentTarget.close();
        }
      }}
    >
      <div className="chat-settings-heading">
        <div>
          <h2 id="conversation-settings-title">会话设置</h2>
          <p>以{identityName}的身份参与对话</p>
        </div>
        <button
          type="button"
          className="chat-settings-close"
          aria-label="关闭会话设置"
          onClick={() => dialogRef.current?.close()}
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="m6 6 12 12M6 18 18 6" /></svg>
        </button>
      </div>
      <div className="chat-settings-content">{children}</div>
    </dialog>
  );
}
