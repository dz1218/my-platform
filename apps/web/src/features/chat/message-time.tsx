const groupGapMs = 5 * 60 * 1000;
const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const fullTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZoneName: "short",
});

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function MessageTime({
  createdAt,
  previousCreatedAt,
}: {
  createdAt: string;
  previousCreatedAt?: string;
}) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;

  const previous = new Date(previousCreatedAt ?? "");
  if (
    sameDay(date, previous) &&
    date.getTime() - previous.getTime() < groupGapMs
  )
    return null;

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const time = timeFormat.format(date);
  let label = time;
  if (!sameDay(date, now)) {
    const day = sameDay(date, yesterday)
      ? "昨天"
      : `${date.getFullYear() === now.getFullYear() ? "" : `${date.getFullYear()}年`}${date.getMonth() + 1}月${date.getDate()}日`;
    label = `${day} ${time}`;
  }
  const fullTime = fullTimeFormat.format(date);

  return (
    <time
      dateTime={createdAt}
      title={fullTime}
      aria-label={fullTime}
      className="self-center text-xs leading-5 text-faint tabular-nums"
    >
      {label}
    </time>
  );
}
