"use client";
import Link from "next/link";
import { AudioLines } from "lucide-react";
import { useDialogScrollLock } from '@my-platform/web-ui/dialog-scroll-lock';
import { MobilePullToRefresh } from '@my-platform/mobile-web/pull-to-refresh';
import { Sheet } from "@/components/sheet";
import { useViewport } from "@/components/use-viewport";
import { LiveIcon } from "./live-icon";
import {
  useLiveLobby,
  type LiveLobbyProps,
  type LiveLobbyModel,
} from "./use-live-lobby";
import {
  DesktopLiveLobbyFrame,
  MobileLiveLobbyFrame,
  LiveDirectoryFrame,
  LiveLobbyLoadingContent,
  LiveDirectorySkeleton,
} from "./live-lobby-frame";
import {
  MobileLiveDirectory,
  MobileCreateRoomPanel,
} from "@my-platform/mobile-web/live-lobby";
import type { ReactNode } from "react";

const renderMobileLink = (
  href: string,
  children: ReactNode,
  className: string,
) => (
  <Link href={href} className={className}>
    {children}
  </Link>
);

export function LiveLobbyClient(props: LiveLobbyProps) {
  const model = useLiveLobby(props);
  const viewport = useViewport();
  const { creating, setCreating } = model;
  return (
    <>
      <MobilePullToRefresh enabled={viewport === 'mobile'} busy={model.isMutating || model.roomsQuery.isFetching} onRefresh={model.refreshMobileRooms} label="直播间列表" />
      {!viewport ? (
        <LiveLobbyLoadingContent />
      ) : viewport === "desktop" ? (
        <DesktopLiveLobby model={model} />
      ) : (
        <MobileLiveLobby model={model} onCreate={() => setCreating(true)} />
      )}
      <Sheet
        open={creating && !!viewport}
        onClose={() => setCreating(false)}
        desktopCentered
        title={viewport === "mobile" ? "我的直播间" : "今晚，开场"}
        className={viewport === "desktop" ? "live-page live-create-sheet" : ""}
      >
        {viewport === "desktop" ? (
          <CreateRoomPanel model={model} />
        ) : (
          <MobileCreateRoomPanel
            hasOwnedRoom={!!model.ownedRoom}
            title={model.title}
            onTitle={(value) => {
              model.setTitle(value);
              model.setError(null);
            }}
            inputRef={model.titleRef}
            isLoggedIn={model.isLoggedIn}
            pending={model.roomsQuery.isPending}
            failed={model.roomsQuery.isError}
            isMutating={model.isMutating}
            isCreating={model.isCreating}
            error={model.error}
            onCreate={() => void model.createRoom()}
            renderLink={renderMobileLink}
          />
        )}
      </Sheet>
      <CloseRoomDialog model={model} />
    </>
  );
}
function DesktopLiveLobby({ model }: { model: LiveLobbyModel }) {
  return (
    <DesktopLiveLobbyFrame
      directory={
        <LobbyDirectory
          model={model}
          action={
            model.ownedRoom ? (
              <Link
                href={`/live/${encodeURIComponent(model.ownedRoom.id)}`}
                className="live-lobby-start"
              >
                我的直播间
                <LiveIcon name="arrow" size={16} />
              </Link>
            ) : (
              <button
                type="button"
                className="live-lobby-start"
                disabled={model.roomsQuery.isPending}
                onClick={() => model.setCreating(true)}
              >
                <LiveIcon name="plus" size={16} />
                我要开播
              </button>
            )
          }
        />
      }
    />
  );
}
function MobileLiveLobby({
  model,
  onCreate,
}: {
  model: LiveLobbyModel;
  onCreate: () => void;
}) {
  return (
    <MobileLiveLobbyFrame
      liveCount={model.roomsQuery.isPending ? undefined : model.liveCount}
      actions={
        model.roomsQuery.isPending ? (
          <button type="button" className="btn-primary" disabled>
            我的直播间
          </button>
        ) : model.ownedRoom ? (
          <Link
            href={`/live/${encodeURIComponent(model.ownedRoom.id)}`}
            className="btn-primary"
          >
            我的直播间
          </Link>
        ) : model.isLoggedIn ? (
          <button type="button" onClick={onCreate} className="btn-primary">
            开播
          </button>
        ) : (
          <Link href="/login" className="btn-secondary">
            登录开播
          </Link>
        )
      }
    >
      <MobileLiveDirectory
        rooms={model.visibleRooms}
        total={model.rooms.length}
        liveCount={model.roomsQuery.isPending ? undefined : model.liveCount}
        waitingCount={
          model.roomsQuery.isPending ? undefined : model.waitingCount
        }
        search={model.search}
        filter={model.filter}
        loading={model.roomsQuery.isPending}
        refreshing={model.roomsQuery.isFetching || model.isRefreshing}
        refreshDisabled={model.isMutating}
        updatesLabel={model.updatesLabel}
        error={model.listError}
        isLoggedIn={model.isLoggedIn}
        isMutating={model.isMutating}
        onSearch={model.setSearch}
        onFilter={model.setFilter}
        onRefresh={() => void model.refreshRooms()}
        onCloseRoom={(room) => {
          model.setCloseError(null);
          model.setRoomToClose(room);
        }}
        renderLink={renderMobileLink}
      />
    </MobileLiveLobbyFrame>
  );
}

function LobbyDirectory({
  model,
  action,
}: {
  model: LiveLobbyModel;
  action: ReactNode;
}) {
  const {
    roomsQuery,
    rooms,
    search,
    setSearch,
    filter,
    setFilter,
    setRoomToClose,
    setCloseError,
    isMutating,
    liveCount,
    visibleRooms,
    isLoggedIn,
    refreshRooms,
    isRefreshing,
    listError,
    updatesLabel,
  } = model;
  return (
    <LiveDirectoryFrame
      action={action}
      count={roomsQuery.isPending ? undefined : rooms.length}
      liveCount={roomsQuery.isPending ? undefined : liveCount}
      waitingCount={roomsQuery.isPending ? undefined : model.waitingCount}
      filter={filter}
      search={search}
      onFilter={setFilter}
      onSearch={setSearch}
      updatesLabel={updatesLabel}
      result={
        !roomsQuery.isPending &&
        `${visibleRooms.length} 个直播间${search || filter !== "全部" ? `，共 ${rooms.length} 个` : ""}`
      }
    >
      {listError && (
        <div role="alert" className="live-notice live-notice-error">
          <LiveIcon name="info" />
          <p>直播间列表更新失败，{listError}。</p>
          <button
            type="button"
            className="live-button live-button-secondary"
            disabled={roomsQuery.isFetching || isMutating}
            onClick={() => void refreshRooms()}
          >
            {isRefreshing ? "正在加载…" : "重新加载"}
          </button>
        </div>
      )}
      {roomsQuery.isPending ? (
        <LiveDirectorySkeleton />
      ) : visibleRooms.length ? (
        <div className="live-room-grid">
          {visibleRooms.map((room) => (
            <article
              className="live-room-card"
              key={room.id}
              data-browse-anchor={`room:${room.id}`}
              aria-label={room.title}
            >
              <Link
                href={`/live/${encodeURIComponent(room.id)}`}
                className={`live-room-cover ${room.status === "直播中" ? "is-live" : ""}`}
                tabIndex={-1}
                aria-hidden="true"
              >
                <span
                  className={`live-status ${room.status === "直播中" ? "is-on" : ""}`}
                >
                  <i />
                  {room.status}
                </span>
                <div className="live-cover-symbol">
                  <LiveIcon
                    name={room.status === "直播中" ? "play" : "video"}
                    size={30}
                  />
                </div>
                <span className="live-cover-caption">
                  {room.status === "直播中"
                    ? "进入房间观看实时画面"
                    : "即将开始 · 欢迎入座"}
                </span>
                <span className="live-cover-viewers">
                  <LiveIcon name="users" size={13} />
                  {room.viewers}
                </span>
              </Link>
              <div className="live-room-card-body">
                <h3 title={room.title}>
                  <Link href={`/live/${encodeURIComponent(room.id)}`}>
                    {room.title}
                  </Link>
                </h3>
                <div className="live-room-card-actions">
                  <Link
                    href={`/live/${encodeURIComponent(room.id)}`}
                    className="live-enter-link"
                  >
                    {isLoggedIn && room.canManage ? "进入直播间" : "观看"}
                    <LiveIcon name="arrow" size={16} />
                  </Link>
                  {isLoggedIn && room.canManage && (
                    <button
                      type="button"
                      className="live-close-room"
                      disabled={isMutating}
                      aria-label={`关闭直播间：${room.title}`}
                      onClick={() => {
                        setCloseError(null);
                        setRoomToClose(room);
                      }}
                    >
                      关闭
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        !listError && (
          <div className="live-lobby-empty" role="status">
            <div
              className="mb-6 flex items-center gap-6 text-muted"
              aria-hidden="true"
            >
              <span className="h-px w-14 bg-line" />
              <AudioLines className="size-12" strokeWidth={1.25} />
              <span className="h-px w-14 bg-line" />
            </div>
            <h3 className="text-sm font-normal text-muted">暂无直播间</h3>
          </div>
        )
      )}
    </LiveDirectoryFrame>
  );
}

function CreateRoomPanel({ model }: { model: LiveLobbyModel }) {
  const {
    roomsQuery,
    ownedRoom,
    title,
    setTitle,
    isCreating,
    error,
    setError,
    titleRef,
    isMutating,
    createRoom,
    isLoggedIn,
    setCreating,
  } = model;
  return (
    <>
      {isLoggedIn ? (
        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void createRoom();
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-4 text-xs text-muted">
            <label htmlFor="room-title">房间名称</label>
            <span id="room-name-hint">1–100 字</span>
          </div>
          <input
            id="room-title"
            aria-label="房间名称"
            required
            aria-invalid={!!error}
            aria-describedby={error ? "room-name-error" : "room-name-hint"}
            ref={titleRef}
            name="roomTitle"
            autoComplete="off"
            maxLength={100}
            disabled={
              !!ownedRoom ||
              isMutating ||
              roomsQuery.isPending ||
              roomsQuery.isError
            }
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.nativeEvent.isComposing || event.keyCode === 229)
              )
                event.preventDefault();
            }}
            placeholder="为房间起个名字"
            className="live-create-name"
          />
          {error && (
            <p
              id="room-name-error"
              role="alert"
              className="pt-3 text-sm leading-6 text-danger"
            >
              {error}
            </p>
          )}
          <div className="mt-5 ml-auto grid w-fit grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="btn-solid min-w-26 bg-ink/5 text-muted hover:bg-ink/10 hover:text-ink"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={
                !!ownedRoom ||
                isMutating ||
                roomsQuery.isPending ||
                roomsQuery.isError
              }
              className="btn-primary min-w-26"
            >
              {isCreating ? "创建中…" : "创建直播间"}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="text-xs text-muted">登录后，开启你的直播。</p>
          <Link href="/login" className="live-lobby-start">
            登录后创建
            <LiveIcon name="arrow" size={16} />
          </Link>
        </div>
      )}
    </>
  );
}

function CloseRoomDialog({ model }: { model: LiveLobbyModel }) {
  useDialogScrollLock(model.dialogRef);
  const {
    title,
    closingRoomId,
    roomToClose,
    setRoomToClose,
    error,
    closeError,
    dialogRef,
    closeRoom,
  } = model;
  return (
    <dialog
      ref={dialogRef}
      className="live-dialog"
      aria-labelledby="close-room-title"
      aria-describedby="close-room-description"
      onCancel={(event) => {
        if (closingRoomId) event.preventDefault();
        else setRoomToClose(null);
      }}
      onClose={() => setRoomToClose(null)}
    >
      <h2 id="close-room-title">关闭这个直播间？</h2>
      <p id="close-room-description">
        关闭「{roomToClose?.title}
        」后，所有参与者将断开连接。之后可以创建新的直播间。
      </p>
      {closeError && (
        <p role="alert" className="live-form-error">
          {closeError}
        </p>
      )}
      <div className="live-dialog-actions">
        <button
          autoFocus
          type="button"
          className="live-button live-button-secondary"
          disabled={closingRoomId !== null}
          onClick={() => setRoomToClose(null)}
        >
          取消
        </button>
        <button
          type="button"
          className="live-button live-button-danger"
          disabled={closingRoomId !== null}
          onClick={() => void closeRoom()}
        >
          {closingRoomId ? "关闭中…" : "确认关闭"}
        </button>
      </div>
    </dialog>
  );
}
