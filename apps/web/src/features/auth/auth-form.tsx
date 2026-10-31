"use client";
import { MobileAuthHeading } from "@my-platform/mobile-web/auth";
import { useDialogScrollLock } from '@my-platform/web-ui/dialog-scroll-lock';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useStoreInstance } from '@/stores/use-store-instance';
import { subscribeAuthCooldown } from '@/stores/auth/subscriptions';
import { createAuthFormStore, authFormSelectors } from '@/stores/auth';

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import { Eye, EyeClosed, X } from "lucide-react";
import Link from "next/link";
import { loginAction, registerAction, sendCodeAction, verifyCodeAction } from "@/lib/actions";
import { SubmitButton } from "@/components/submit-button";
import { InteractionNotice } from "@/components/interaction-notice";
import { GenderSelect } from "./gender-select";
import { GenderHelp } from "./gender-help";

const errors: Record<string, string> = {
  unavailable: "暂时连接不上，请稍后再试。", internal: "服务暂时不可用，请稍后再试。",
  rate_limit: "操作太频繁，请稍后再试。", invalid_request: "请检查填写内容。密码需为 8–72 字节。",
  invalid_phone: "请输入正确的 11 位手机号。", invalid: "手机号或密码不正确，请重新输入。",
  mismatch: "两次输入的密码不一致。", exists: "该手机号已被注册，请直接登录。",
  gender_required: "请选择性别，以便查看可继承的 AI 身份。",
  name_required: "请输入昵称。",
  invalid_code: "验证码不正确或已过期，请重新获取。", verification_expired: "手机号验证已过期，请返回上一步重新验证。",
  sms_unavailable: "短信发送暂不可用，请稍后再试。", sms_not_configured: "短信服务尚未配置完成，请稍后再试。",
};

export function AuthForm({ register = false, passwordUpdated = false }: { register?: boolean; passwordUpdated?: boolean }) {
  const [state, formAction, pending] = useActionState(register ? registerAction : loginAction, {});
  const ui = useStoreInstance(() => createAuthFormStore({ sendCode: sendCodeAction, verifyCode: verifyCodeAction }));
  const { name, gender, consent, phone, code, ticket, password, confirm, confirmTouched, localError, notice, verifying, sending, cooldown, showPassword, noticeOpen } = useStore(ui, useShallow(authFormSelectors.view));
  const { setPhone, setCode, setPassword, setConfirm, setConfirmTouched, setShowPassword, setNoticeOpen, setName, setGender, setConsent, verifyPhone, credentialsMatch } = ui.getState();
  const confirmRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const noticeDialog = useRef<HTMLDialogElement>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const passwordStep = register && !!ticket;
  const switchingBlocked = pending || verifying || sending;
  const error = localError || state.error;
  const phoneError = !passwordStep && (error === "invalid_phone" || error === "exists") ? error : undefined;
  const codeError = register && !passwordStep && error === "invalid_code" ? error : undefined;
  const confirmError = passwordStep && (confirmTouched || error === "mismatch") && confirm && password !== confirm ? "mismatch" : undefined;
  useEffect(() => subscribeAuthCooldown(ui), [ui]);
  useEffect(() => {
    let frame = 0;
    const unsubscribe = ui.subscribe(s => s.ticket, ticket => {
      if (ticket) frame = requestAnimationFrame(() => stepHeading.current?.focus());
    });
    return () => { unsubscribe(); cancelAnimationFrame(frame); };
  }, [ui]);

  useEffect(() => {
    if (!noticeOpen) return;
    const dialog = noticeDialog.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, [noticeOpen]);
  useDialogScrollLock(noticeDialog);

  async function sendCode() {
    if (await ui.getState().sendCode() === 'invalid_phone') phoneRef.current?.focus();
  }
  const verify = (form: FormData) => verifyPhone(String(form.get('code') ?? ''));

  function submitCredentials(event: FormEvent<HTMLFormElement>) {
    if (register && !passwordStep) return;
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    if (passwordStep) {
      if (!credentialsMatch(String(form.get("password") ?? ""), String(form.get("confirm") ?? ""))) {
        confirmRef.current?.focus();
        return;
      }
    }
    // Dispatch explicitly: a returned error must not trigger React's automatic form reset.
    startTransition(() => formAction(form));
  }

  return <>
      <section className="auth-panel" aria-labelledby="auth-heading" data-auth-mode={register ? passwordStep ? "profile" : "register" : "login"}>
        <div className="auth-form-content">
          <h1 id="auth-heading" ref={stepHeading} tabIndex={-1}><span className="auth-desktop-heading">{register ? passwordStep ? "为相遇，设置一把钥匙。" : "从一句你好开始。" : "欢迎回到你的频率。"}</span><MobileAuthHeading register={register} passwordStep={passwordStep} /></h1>
          {!passwordStep && <p className="auth-intro">{register ? "留一点时间，听听彼此的日常。" : "登录 Radio Friday，接着上次没聊完的故事。"}</p>}
          {passwordUpdated && <p role="status" className="mb-4 text-sm leading-6 text-ink">密码已更新，请重新登录。</p>}
          <form action={register && !passwordStep ? verify : formAction} onSubmit={submitCredentials} className="auth-form" key={passwordStep ? "password" : "phone"}>
            <fieldset disabled={pending || verifying}>
              {passwordStep ? <><input type="hidden" name="phone" value={phone} /><input type="hidden" name="ticket" value={ticket} /></> :
                <div className="auth-label"><label htmlFor="auth-phone">手机号</label><div className="auth-phone-field"><span>+86</span><input ref={phoneRef} aria-invalid={!!phoneError} aria-describedby={phoneError ? "auth-phone-error" : undefined} id="auth-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel-national" required pattern="1[3-9][0-9]{9}" maxLength={11} placeholder="请输入手机号" value={phone} onChange={e => setPhone(e.target.value)} /></div>{phoneError && <p id="auth-phone-error" role="alert" className="auth-field-error">{errors[phoneError]}</p>}</div>}
              {register && !passwordStep ? <>
                <div className="auth-label"><label htmlFor="auth-code">短信验证码</label><div className="auth-code-field"><input aria-invalid={!!codeError} aria-describedby={codeError ? "auth-code-error" : notice ? "auth-code-notice" : undefined} id="auth-code" name="code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} placeholder="输入 6 位验证码" value={code} onChange={e => setCode(e.target.value)} /><button type="button" disabled={sending || cooldown > 0} aria-busy={sending} onClick={() => { void sendCode(); }}>{sending ? "发送中…" : cooldown > 0 ? `${cooldown}s 后重发` : "获取验证码"}</button></div>{codeError && <p id="auth-code-error" role="alert" className="auth-field-error">{errors[codeError]}</p>}</div>
                {notice && <p id="auth-code-notice" role="status" className="auth-code-notice">{notice}</p>}
              </> : <>
                {passwordStep && <div className="auth-profile-fields">
                  <label className="auth-label">昵称<input name="name" value={name} onChange={e => setName(e.target.value)} autoComplete="nickname" placeholder="怎么称呼你" required pattern={".*\\S.*"} title="请输入昵称，不能只填写空格" maxLength={40} className="auth-input" /></label>
                  <div className="auth-label">
                    <GenderHelp />
                    <GenderSelect value={gender} onChange={setGender} />
                  </div>
                </div>}
                <div className="auth-label"><div className="flex items-center justify-between gap-3"><label htmlFor="auth-password">密码</label>{!register && <Link href="/forgot-password" scroll={false} aria-disabled={switchingBlocked} onNavigate={event => { if (switchingBlocked) event.preventDefault(); }} className="inline-flex min-h-11 items-center rounded-control px-2 text-xs text-muted hover:bg-surface-soft hover:text-ink aria-disabled:opacity-50">忘记密码</Link>}</div><div className="auth-password-field"><input id="auth-password" name="password" type={showPassword ? "text" : "password"} required minLength={register ? 8 : undefined} autoComplete={register ? "new-password" : "current-password"} placeholder={register ? "设置至少 8 位密码" : "请输入密码"} value={password} onChange={e => setPassword(e.target.value)} /><button type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} aria-pressed={showPassword} onClick={() => setShowPassword(v => !v)}>{showPassword ? <EyeClosed size={19} strokeWidth={1.75} aria-hidden="true" /> : <Eye size={19} strokeWidth={1.75} aria-hidden="true" />}</button></div></div>
                {passwordStep && <>
                  <div className="auth-label">
                    <label htmlFor="auth-confirm">确认密码</label>
                    <input ref={confirmRef} id="auth-confirm" name="confirm" type="password" required autoComplete="new-password" placeholder="再次输入密码" className="auth-input" value={confirm} onChange={e => setConfirm(e.target.value)} onBlur={() => setConfirmTouched(true)} aria-invalid={!!confirmError} aria-describedby={confirmError ? "auth-confirm-error" : undefined} />
                    {/* Reserve the error line so blur validation cannot move the consent checkbox during a click. */}
                    <div className="min-h-5">{confirmError && <p id="auth-confirm-error" role="alert" className="auth-field-error">{errors[confirmError]}</p>}</div>
                  </div>
                  <label className="auth-consent"><input type="checkbox" name="consent" required checked={consent} onChange={e => setConsent(e.target.checked)} /><span>我已阅读并同意<button type="button" aria-haspopup="dialog" onClick={() => setNoticeOpen(true)}>平台互动说明</button>，了解 AI 身份可能由真实用户参与互动。</span></label>
                </>}
              </>}
              {error && error !== "mismatch" && !phoneError && !codeError && <p role="alert" className="auth-field-error">{errors[error] ?? "操作失败，请稍后再试。"}</p>}
              <SubmitButton pendingLabel={register ? "正在处理…" : "正在登录…"} className="auth-submit">{register ? passwordStep ? "完成注册" : "验证并继续" : "登录"}</SubmitButton>
            </fieldset>
          </form>
          <p className="auth-switch">{register ? "已经有账号？" : "第一次来到这里？"}<Link href={register ? "/login" : "/register"} scroll={false}
            aria-disabled={switchingBlocked} className="aria-disabled:cursor-wait aria-disabled:opacity-50"
            onNavigate={event => {
              // A competing route can discard the server action's session redirect.
              if (switchingBlocked) event.preventDefault();
            }}>{register ? "返回登录" : "手机号注册"}</Link></p>
        </div>
        <footer className="auth-footer"><span>让每一次相遇，都有回音。</span><button type="button" aria-haspopup="dialog" onClick={() => setNoticeOpen(true)}>隐私与互动说明</button></footer>
      </section>
    <dialog ref={noticeDialog} className="auth-notice-dialog" aria-labelledby="auth-notice-title" onClose={() => setNoticeOpen(false)} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
    }}>
      <header className="auth-notice-header">
        <h2 id="auth-notice-title">隐私与互动说明</h2>
        <button type="button" autoFocus aria-label="关闭说明" onClick={() => noticeDialog.current?.close()}><X size={20} aria-hidden="true" /></button>
      </header>
      <div className="auth-notice-content"><InteractionNotice /></div>
      <footer className="auth-notice-footer"><button type="button" className="auth-submit" onClick={() => noticeDialog.current?.close()}>我知道了</button></footer>
    </dialog>
  </>;
}
