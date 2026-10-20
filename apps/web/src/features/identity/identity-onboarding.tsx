"use client";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useStoreInstance } from "@/stores/use-store-instance";
import { createIdentityStore, identitySelectors } from "@/stores/identity";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { getInheritance, inheritanceOptions } from "@/services/inheritance";
import {
  subscribeIdentitySelection,
  subscribeIdentityFilters,
} from "@/stores/identity/subscriptions";
import { APIError } from "@/services/api/client";
import { GenderSelect } from "@/features/auth/gender-select";
import type { Identity } from "@/types/companion";
import { Avatar } from "./avatar";
import { Sheet } from "@/components/sheet";
import { LoadingPlaceholder } from "@/components/page-skeleton";
import { ResponsiveCatalogFilters } from "@/features/catalog/catalog-filters";
import { IdentityMasonry } from "@/features/catalog/identity-masonry";
import { emptyCatalogFilters } from "@/services/catalog";

type Candidate = Identity & { available: boolean };
type ChoiceContext = {
  selectedId: string | null;
  busy: boolean;
  choose: (identity: Candidate) => void;
};
function ChoiceCard({
  data: identity,
  index,
  context,
}: {
  data: Candidate;
  index: number;
  context: ChoiceContext;
}) {
  const selected = context.selectedId === identity.id;
  return (
    <div className="p-2">
      <article
        data-identity-id={identity.id}
        data-identity-index={index}
        className={`group flex flex-col rounded-panel border bg-panel p-5 transition-colors motion-reduce:transition-none ${selected ? "border-focus" : "border-transparent hover:border-line focus-within:border-control"}`}
      >
        <div className="flex items-center gap-3">
          <Avatar identity={identity} large />
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">{identity.name}</h3>
            <p className="mt-1 text-xs text-muted">
              {identity.age} 岁{identity.city ? `，${identity.city}` : ""}
            </p>
          </div>
        </div>
        {identity.occupation && (
          <p className="mt-5 text-sm font-medium text-ink">
            {identity.occupation}
          </p>
        )}
        {identity.background && (
          <p className="mt-2 text-sm leading-7 text-muted">
            {identity.background}
          </p>
        )}
        <div className="mt-auto pt-5">
          <button
            type="button"
            aria-pressed={selected}
            className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-control px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:text-faint motion-reduce:transition-none ${selected ? "bg-action text-on-action" : "bg-surface-soft text-ink enabled:hover:bg-surface-hover"}`}
            disabled={!identity.available || context.busy}
            onClick={() => context.choose(identity)}
          >
            <span>
              {identity.available
                ? `选择${identity.name}`
                : `${identity.name}已被继承`}
            </span>
            {selected ? (
              <Check size={16} aria-hidden="true" />
            ) : identity.available ? (
              <ArrowUpRight
                size={16}
                aria-hidden="true"
                className="text-muted"
              />
            ) : null}
          </button>
        </div>
      </article>
    </div>
  );
}

function inheritanceError(error: Error) {
  if (error instanceof APIError && error.status === 409)
    return `${error.message} 已为你更新列表。`;
  return error.message;
}

export function IdentityOnboarding({
  accountId,
  accountName,
}: {
  accountId: string;
  accountName: string;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const ui = useStoreInstance(() =>
    createIdentityStore({
      client,
      accountId,
      refresh: () => router.refresh(),
      openHome: () => router.replace("/"),
    }),
  );
  const {
    selectedId,
    selectedSnapshot,
    filters,
    gender,
    pending,
    claimId,
    requestedGender,
    claimError,
    skipError,
    genderError,
  } = useStore(ui, useShallow(identitySelectors.view));
  const {
    clearSelection,
    chooseIdentity: choose,
    setFilters,
    setGender,
    inheritSelected,
    skip,
    saveGender,
  } = ui.getState();
  const stateKey = ["identity-inheritance", accountId];
  const state = useQuery({
    queryKey: stateKey,
    queryFn: ({ signal }) => getInheritance(ui.getState().selectedId, signal),
    refetchInterval: (query) =>
      query.state.error instanceof APIError && query.state.error.status === 404
        ? false
        : 20_000,
  });
  useEffect(
    () => subscribeIdentitySelection(ui, client, accountId),
    [ui, client, accountId],
  );
  useEffect(
    () =>
      subscribeIdentityFilters(ui, client, accountId, () => {
        document
          .getElementById("available-identities-heading")
          ?.scrollIntoView({ block: "start", behavior: "instant" });
      }),
    [ui, client, accountId],
  );
  const optionsKey = [
    "identity-options",
    accountId,
    state.data?.gender,
    filters,
  ];
  const options = useInfiniteQuery({
    queryKey: optionsKey,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      inheritanceOptions(filters, pageParam, signal),
    getNextPageParam: (page) => page.nextPage ?? undefined,
    enabled: !!state.data?.gender && !state.data?.identity,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const success = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let frame = 0;
    const unsubscribe = ui.subscribe(
      (s) => s.lastInheritedId,
      (id) => {
        if (id) frame = requestAnimationFrame(() => success.current?.focus());
      },
    );
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [ui]);
  const busy = pending !== null;
  const inherited = state.data?.identity;
  const candidates = useMemo(
    () => [
      ...new Map(
        (options.data?.pages.flatMap((page) => page.items) ?? [])
          .filter((item) => item.gender === state.data?.gender)
          .map((item) => [item.id, item]),
      ).values(),
    ],
    [options.data, state.data?.gender],
  );
  const selected = selectedId
    ? state.data?.selectedRequestId === selectedId
      ? (state.data.selected ??
        (selectedSnapshot ? { ...selectedSnapshot, available: false } : null))
      : selectedSnapshot
    : null;
  // A response can fail after the server has saved the operation. Only dismiss
  // its error when the current state confirms that operation's result.
  const error =
    (inherited?.id === claimId ? null : claimError) ??
    (state.data?.onboardingCompleted ? null : skipError) ??
    (state.data?.gender === requestedGender ? null : genderError) ??
    state.error ??
    (!options.data ? options.error : null);

  const cardContext = useMemo(
    () => ({ selectedId, busy, choose }),
    [selectedId, busy, choose],
  );
  const loadMore = useCallback(() => {
    if (!options.isFetching) void options.fetchNextPage();
  }, [options.isFetching, options.fetchNextPage]);

  return (
    <main id="main-content" tabIndex={-1} className="page-shell page-content">
      <div className="mx-auto max-w-[1040px]">
        <Link
          href="/me"
          className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-control text-sm text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          返回
        </Link>
        <header className="mb-7">
          <div>
            <h1 className="page-title">
              {inherited ? "现在，你有两个身份" : "要继承一个 AI 身份吗？"}
            </h1>
            <p className="mt-3 max-w-[640px] text-sm leading-7 text-muted">
              {inherited
                ? "本账户和 AI 身份各自保留，你可以随时切换聊天方式。"
                : "继承后，你可以以这个 AI 身份和其他真实用户聊天，也可以用本账户认识其他 AI 朋友。"}
            </p>
          </div>
        </header>
        {error && (
          <div
            role="alert"
            className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger-line bg-danger-soft p-4 text-sm leading-6 text-danger"
          >
            <p>{inheritanceError(error)}</p>
            <button
              type="button"
              disabled={busy || state.isFetching}
              className="btn-secondary"
              onClick={() => {
                void state.refetch();
                if (state.data?.gender && !inherited) void options.refetch();
              }}
            >
              重新加载
            </button>
          </div>
        )}
        {state.isPending && (
          <LoadingPlaceholder label="正在查看可以继承的身份…" />
        )}
        {state.data &&
          (inherited ? (
            <section
              ref={success}
              tabIndex={-1}
              aria-label="我的两个身份"
              className="grid gap-5 md:grid-cols-2"
            >
              <section className="content-panel">
                <h2 className="panel-heading">本账户</h2>
                <div className="p-6">
                  <p className="text-xl font-semibold">{accountName}</p>
                  <p className="mt-3 min-h-12 text-sm leading-6 text-muted">
                    以自己的身份和其他 AI
                    朋友聊天，你原来的账户与聊天记录继续保留。
                  </p>
                  <Link href="/companion" className="btn-secondary mt-6 w-full">
                    以本账户聊天
                  </Link>
                </div>
              </section>
              <section className="content-panel border-accent-line">
                <h2 className="panel-heading">我的 AI 身份</h2>
                <div className="p-6">
                  <div className="flex items-center gap-3">
                    <Avatar identity={inherited} />
                    <p className="text-xl font-semibold">{inherited.name}</p>
                  </div>
                  <p className="mt-3 min-h-12 text-sm leading-6 text-muted">
                    以{inherited.name}的身份回复其他真实用户，并设置 AI
                    托管、主动联系与虚拟日常。
                  </p>
                  <Link href="/operator" className="btn-primary mt-6 w-full">
                    以{inherited.name}的身份回复
                  </Link>
                </div>
              </section>
            </section>
          ) : (
            <div className="space-y-8">
              <aside
                className="grid items-center gap-x-6 rounded-panel bg-panel px-4 py-3 sm:px-5 lg:grid-cols-[minmax(180px,.8fr)_minmax(0,1.7fr)]"
                aria-labelledby="own-account-heading"
              >
                <div className="flex items-center gap-3 py-1">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-soft text-muted">
                    <UserRound aria-hidden="true" size={20} strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 id="own-account-heading" className="text-xs text-muted">
                      你的本账户
                    </h2>
                    <p className="mt-1 break-words text-sm font-medium">
                      {accountName}
                    </p>
                  </div>
                </div>
                <details className="group mt-2 border-t border-line pt-2 lg:mt-0 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-control text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center gap-2 text-xs">
                      <ShieldCheck
                        size={16}
                        aria-hidden="true"
                        className="shrink-0"
                      />
                      <span>
                        本账户始终保留
                        <span className="mt-1 hidden text-faint sm:block">
                          继承不会替换你的账号
                        </span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs">
                      继承须知
                      <ChevronDown
                        size={14}
                        aria-hidden="true"
                        className="transition-transform group-open:rotate-180 motion-reduce:transition-none"
                      />
                    </span>
                  </summary>
                  <div className="max-w-[720px] space-y-2 pb-2 pt-2 text-sm leading-7 text-muted">
                    <p>
                      继承不会替换你的账号。每个 AI
                      身份只能被继承一次，每个账户只能继承一个。继承后不可更换。
                    </p>
                    <p>
                      你只能继承与自己性别相同的 AI
                      身份。暂不继承也能继续使用，之后可从「我的」回来选择。
                    </p>
                  </div>
                </details>
              </aside>
              <section
                aria-labelledby="available-identities-heading"
                className="min-w-0"
              >
                {!state.data.gender ? (
                  <form
                    className="surface grid max-w-md gap-4 p-5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (gender) void saveGender();
                    }}
                  >
                    <h2
                      id="available-identities-heading"
                      className="text-lg font-semibold"
                    >
                      先补充你的性别
                    </h2>
                    <p
                      id="inheritance-gender-help"
                      className="text-sm leading-6 text-muted"
                    >
                      我们会展示与你性别相同、可以继承的 AI 身份。
                    </p>
                    <div className="grid gap-2 text-sm">
                      <label htmlFor="inheritance-gender">性别</label>
                      <GenderSelect
                        id="inheritance-gender"
                        describedBy="inheritance-gender-help"
                        value={gender}
                        onChange={setGender}
                        disabled={busy}
                      />
                    </div>
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={!gender || busy}
                    >
                      {pending === "gender"
                        ? "正在保存…"
                        : "保存性别，查看身份"}
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="mb-5 flex items-center justify-between gap-4">
                      <h2
                        id="available-identities-heading"
                        className="text-lg font-semibold"
                      >
                        {state.data.gender === "FEMALE"
                          ? "女性 AI 身份"
                          : "男性 AI 身份"}
                      </h2>
                      <span className="text-xs tabular-nums text-muted">
                        {options.isPending
                          ? "加载中…"
                          : `${options.data?.pages[0]?.availableTotal ?? 0} 位可继承`}
                      </span>
                    </div>
                    {(candidates.length > 0 ||
                      Object.values(filters).some(Boolean)) && (
                      <ResponsiveCatalogFilters
                        compact
                        key={JSON.stringify(filters)}
                        value={filters}
                        occupations={options.data?.pages[0]?.occupations ?? []}
                        onChange={setFilters}
                      />
                    )}
                    {options.isPending && (
                      <LoadingPlaceholder label="正在加载身份…" />
                    )}
                    {!options.isPending &&
                    !options.error &&
                    candidates.length === 0 ? (
                      <div className="flex min-h-[300px] flex-col items-center justify-center rounded-panel bg-panel px-6 py-12 text-center md:min-h-[340px]">
                        <div
                          aria-hidden="true"
                          className="relative mb-7 flex h-20 w-32 items-center justify-center"
                        >
                          <div className="absolute left-1 top-0 flex size-16 -rotate-12 items-center justify-center rounded-2xl border border-line bg-surface-soft text-faint">
                            <UserRound size={28} strokeWidth={1.25} />
                          </div>
                          <div className="absolute bottom-0 right-1 flex size-16 rotate-12 items-center justify-center rounded-2xl border border-control bg-panel text-muted">
                            <UsersRound size={28} strokeWidth={1.25} />
                          </div>
                        </div>
                        <h3 className="text-lg font-semibold text-ink">
                          {Object.values(filters).some(Boolean)
                            ? "没有符合条件的 AI 身份"
                            : state.data.gender === "MALE"
                              ? "男性 AI 身份暂未开放"
                              : "暂时没有可继承的女性 AI 身份"}
                        </h3>
                        <p className="mt-3 max-w-sm text-sm leading-7 text-muted">
                          {Object.values(filters).some(Boolean)
                            ? "试试其他筛选条件，看看还有谁在这里。"
                            : "你可以先以本账户和 AI 朋友聊天，之后再回来看看。"}
                        </p>
                        {Object.values(filters).some(Boolean) && (
                          <button
                            type="button"
                            className="btn-secondary mt-5"
                            onClick={() => setFilters(emptyCatalogFilters)}
                          >
                            清除筛选条件
                          </button>
                        )}
                      </div>
                    ) : null}
                    <IdentityMasonry
                      items={candidates}
                      context={cardContext}
                      ItemContent={ChoiceCard}
                      maxColumns={3}
                      autoLoad={!selectedId}
                      hasNextPage={options.hasNextPage}
                      loading={options.isFetchingNextPage}
                      error={options.data ? options.error : null}
                      loadMore={loadMore}
                    />
                    <Sheet
                      open={!!selected}
                      onClose={() => {
                        if (!busy) clearSelection();
                      }}
                      title={`确认继承${selected?.name ?? ""}`}
                      desktopCentered
                    >
                      {selected && (
                        <div>
                          <div className="mb-5 flex items-center gap-3">
                            <Avatar identity={selected} large />
                            <div>
                              <p className="text-lg font-semibold">
                                {selected.name}
                              </p>
                              <p className="mt-1 text-sm text-muted">
                                {selected.age} 岁
                                {selected.city ? `，${selected.city}` : ""}
                                {selected.occupation
                                  ? ` · ${selected.occupation}`
                                  : ""}
                              </p>
                            </div>
                          </div>
                          <p className="mt-3 text-sm leading-7">
                            确认后，{selected.name}将成为你唯一的 AI
                            身份，其他用户不能再继承。继承后不可更换，你的本账户仍然保留。
                          </p>
                          <p className="mt-2 text-sm leading-7 text-muted">
                            你可以以{selected.name}的身份回复对话，并管理 AI
                            托管。和其他 AI 朋友聊天时，使用你的本账户。
                          </p>
                          {!selected.available && (
                            <p
                              role="status"
                              className="mt-3 text-sm text-danger"
                            >
                              {selected.name}刚刚被其他用户继承，请重新选择。
                            </p>
                          )}
                          <div className="mt-5 flex flex-wrap gap-3">
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={busy || !selected.available}
                              onClick={() => void inheritSelected()}
                            >
                              {pending === "inherit"
                                ? "正在继承…"
                                : `确认继承${selected.name}`}
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={busy}
                              onClick={() => clearSelection()}
                            >
                              重新选择
                            </button>
                          </div>
                        </div>
                      )}
                    </Sheet>
                  </>
                )}
              </section>
              <footer className="flex flex-col items-center justify-between gap-4 border-t border-line pt-6 sm:flex-row">
                <p className="text-xs leading-6 text-muted">
                  暂不继承也能继续使用，之后可从「我的」回来选择。
                </p>
                <button
                  type="button"
                  className="btn-secondary w-full shrink-0 sm:w-auto"
                  disabled={busy}
                  onClick={() => void skip()}
                >
                  {pending === "skip" ? "正在进入…" : "暂不继承，以本账户继续"}
                </button>
              </footer>
            </div>
          ))}
      </div>
    </main>
  );
}
