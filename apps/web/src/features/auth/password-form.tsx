'use client';

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from 'react';
import Link from 'next/link';
import { Eye, EyeClosed } from 'lucide-react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createPasswordFormStore, type PasswordResult } from '@my-platform/client-core/auth';
import { useStoreInstance } from '@/stores/use-store-instance';
import { useAccountLifecycle } from '@/features/account/account-lifecycle';
import { changePasswordAction, resetPasswordAction, sendPasswordCodeAction, verifyPasswordCodeAction } from './password-actions';

const messages: Record<string, string> = {
  invalid_phone: '请输入正确的 11 位手机号。', invalid_code: '验证码不正确或已过期，请重新获取。',
  invalid_password: '密码需为 8–72 字节，中文和符号可能占多个字节。', mismatch: '两次输入的密码不一致。',
  current_password_required: '请输入原密码。', invalid_current_password: '原密码不正确。', same_password: '新密码不能与原密码相同。',
  verification_expired: '手机验证已过期，请返回上一步重新验证。', rate_limit: '操作太频繁，请稍后再试。',
  sms_unavailable: '短信发送暂不可用，请稍后再试。', sms_not_configured: '短信服务尚未配置完成，请稍后再试。',
  unauthorized: '登录已失效，请重新登录。', unavailable: '暂时连接不上，请稍后再试。',
};

export function PasswordForm({ mode, onBusyChange, onSwitchMode }: {
  mode: 'reset' | 'change';
  onBusyChange?: (busy: boolean) => void;
  onSwitchMode?: (mode: 'reset' | 'change') => void;
}) {
  const embedded = !!onSwitchMode;
  const ui = useStoreInstance(() => createPasswordFormStore({ sendCode: sendPasswordCodeAction, verifyCode: verifyPasswordCodeAction }));
  const state = useStore(ui, useShallow(s => ({ phone: s.phone, code: s.code, ticket: s.ticket, password: s.password, confirm: s.confirm,
    currentPassword: s.currentPassword, error: s.error, notice: s.notice, sending: s.sending, verifying: s.verifying,
    submitting: s.submitting, cooldown: s.cooldown, showPassword: s.showPassword, confirmTouched: s.confirmTouched })));
  const { setField, togglePassword, touchConfirm, sendCode, verifyPhone, back } = ui.getState();
  const formRef = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const { leaveAccount, deferSessionVerification } = useAccountLifecycle();
  const [, submit, pending] = useActionState(async (previous: PasswordResult, form: FormData) => {
    const resumeVerification = deferSessionVerification();
    try {
      const result = await (mode === 'reset' ? resetPasswordAction : changePasswordAction)(previous, form);
      ui.getState().finishSubmit(result);
      if (result.success) leaveAccount('/login?password=updated');
      return result;
    } catch {
      const result = { error: 'unavailable' };
      ui.getState().finishSubmit(result);
      return result;
    } finally { resumeVerification(); }
  }, {});
  const passwordStep = mode === 'change' || !!state.ticket;
  const busy = pending || state.submitting || state.verifying || state.sending;
  const confirmError = state.confirmTouched && !!state.confirm && state.password !== state.confirm ? 'mismatch' : state.error === 'mismatch' ? state.error : '';
  const fieldError = (field: string) => field === 'phone' ? state.error === 'invalid_phone' : field === 'code' ? state.error === 'invalid_code'
    : field === 'currentPassword' ? ['invalid_current_password', 'current_password_required'].includes(state.error)
      : field === 'password' ? ['invalid_password', 'same_password'].includes(state.error) : !!confirmError;
  const errorText = (field: string) => messages[field === 'confirm' ? confirmError : state.error];
  const fieldNames = ['phone', 'code', 'currentPassword', 'password', 'confirm'];
  const hasFieldError = fieldNames.some(fieldError);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = ui.subscribe(s => s.cooldown, cooldown => {
      clearTimeout(timer);
      if (cooldown > 0) timer = setTimeout(() => ui.getState().tickCooldown(), 1000);
    }, { fireImmediately: true });
    const resume = () => ui.getState().tickCooldown();
    document.addEventListener('visibilitychange', resume);
    return () => { unsubscribe(); clearTimeout(timer); document.removeEventListener('visibilitychange', resume); ui.getState().clear(); };
  }, [ui]);
  useEffect(() => ui.subscribe(s => s.ticket, () => heading.current?.focus()), [ui]);
  useEffect(() => {
    if (embedded) formRef.current?.querySelector<HTMLInputElement>('input:not([type="hidden"])')?.focus();
  }, [embedded]);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    if (state.error) formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
  }, [state.error]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!passwordStep) { void verifyPhone(); return; }
    if (!ui.getState().beginSubmit(mode)) return;
    const form = new FormData(event.currentTarget);
    startTransition(() => submit(form));
  }
  const inputClass = 'input-field min-w-0';
  const errorLine = (field: string) => fieldError(field) && <p id={`password-${field}-error`} role="alert" className="text-xs leading-5 text-danger">{errorText(field)}</p>;
  const describedBy = (field: string) => fieldError(field) ? `password-${field}-error` : undefined;
  const alternateClass = 'inline-flex min-h-11 items-center rounded-control px-3 text-sm text-muted hover:bg-surface-soft hover:text-ink disabled:opacity-50 aria-disabled:opacity-50';

  return <div>
    {mode === 'reset' && (embedded
      ? <h3 ref={heading} tabIndex={-1} className="sr-only">{passwordStep ? '设置新密码' : '验证手机号'}</h3>
      : <><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-ink">{passwordStep ? '设置新密码' : '找回密码'}</h1><p className="mt-3 text-sm leading-6 text-muted">{passwordStep ? '请设置一个新的登录密码。' : '验证注册手机号，重新设置密码。'}</p></>)}
    <form ref={formRef} action={submit} onSubmit={onSubmit} className={mode === 'reset' && !embedded ? 'mt-7' : ''}>
      <fieldset disabled={busy} className="flex min-w-0 flex-col gap-5 disabled:cursor-wait">
        {!passwordStep ? <>
          <div className="flex flex-col gap-2"><label htmlFor="password-phone" className="text-sm text-ink">手机号</label><div className="flex items-center gap-3"><span className="text-sm text-muted">+86</span><input id="password-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel-national" required pattern="1[3-9][0-9]{9}" maxLength={11} placeholder="请输入注册手机号" className={inputClass} value={state.phone} onChange={e => setField('phone', e.target.value)} aria-invalid={fieldError('phone')} aria-describedby={describedBy('phone')} /></div>{errorLine('phone')}</div>
          <div className="flex flex-col gap-2"><label htmlFor="password-code" className="text-sm text-ink">短信验证码</label><div className="flex gap-2"><input id="password-code" name="code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} placeholder="6 位验证码" className={inputClass} value={state.code} onChange={e => setField('code', e.target.value)} aria-invalid={fieldError('code')} aria-describedby={describedBy('code')} /><button type="button" disabled={state.cooldown > 0 || busy} onClick={() => void sendCode()} className="min-h-11 shrink-0 rounded-control px-3 text-sm text-muted hover:bg-surface-soft hover:text-ink disabled:opacity-50">{state.sending ? '发送中…' : state.cooldown > 0 ? `${state.cooldown}s 后重发` : '获取验证码'}</button></div>{errorLine('code')}{state.notice && <p role="status" className="text-xs leading-5 text-muted">{state.notice}</p>}</div>
        </> : <>
          {mode === 'reset' && <><input type="hidden" name="phone" value={state.phone} /><input type="hidden" name="ticket" value={state.ticket} /></>}
          {mode === 'change' && <div className="flex flex-col gap-2"><label htmlFor="password-currentPassword" className="text-sm text-ink">原密码</label><input id="password-currentPassword" name="currentPassword" type="password" autoComplete="current-password" required maxLength={256} className={inputClass} value={state.currentPassword} onChange={e => setField('currentPassword', e.target.value)} aria-invalid={fieldError('currentPassword')} aria-describedby={describedBy('currentPassword')} />{errorLine('currentPassword')}</div>}
          <div className="flex flex-col gap-2"><label htmlFor="password-password" className="text-sm text-ink">新密码</label><div className="relative"><input id="password-password" name="password" type={state.showPassword ? 'text' : 'password'} autoComplete="new-password" required placeholder="设置至少 8 位密码" className={`${inputClass} pr-12`} value={state.password} onChange={e => setField('password', e.target.value)} aria-invalid={fieldError('password')} aria-describedby={describedBy('password')} /><button type="button" aria-label={state.showPassword ? '隐藏新密码' : '显示新密码'} aria-pressed={state.showPassword} onClick={togglePassword} className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-control text-muted hover:text-ink">{state.showPassword ? <EyeClosed size={18} /> : <Eye size={18} />}</button></div>{errorLine('password')}</div>
          <div className="flex flex-col gap-2"><label htmlFor="password-confirm" className="text-sm text-ink">确认新密码</label><input id="password-confirm" name="confirm" type="password" autoComplete="new-password" required placeholder="再次输入密码" className={inputClass} value={state.confirm} onChange={e => setField('confirm', e.target.value)} onBlur={touchConfirm} aria-invalid={fieldError('confirm')} aria-describedby={describedBy('confirm')} />{errorLine('confirm')}</div>
        </>}
        {state.error && !hasFieldError && <p role="alert" className="text-xs leading-5 text-danger">{messages[state.error] ?? '操作失败，请稍后再试。'}</p>}
        <button type="submit" disabled={busy} aria-busy={busy} className="btn-primary min-h-11 w-full disabled:opacity-60">{state.submitting || pending ? '正在保存…' : state.verifying ? '正在验证…' : passwordStep ? '保存新密码' : '验证并继续'}</button>
        {passwordStep && mode === 'reset' && <button type="button" onClick={back} className="min-h-11 rounded-control text-sm text-muted hover:bg-surface-soft hover:text-ink">返回修改手机号</button>}
      </fieldset>
    </form>
    <div className="mt-4 flex min-h-11 items-center justify-center">{onSwitchMode
      ? <button type="button" disabled={busy} onClick={() => onSwitchMode(mode === 'change' ? 'reset' : 'change')} className={alternateClass}>{mode === 'reset' ? '使用原密码修改' : '忘记原密码？使用短信找回'}</button>
      : <Link href="/login" scroll={false} aria-disabled={busy} onNavigate={event => { if (busy) event.preventDefault(); }} className={alternateClass}>返回登录</Link>}</div>
  </div>;
}
