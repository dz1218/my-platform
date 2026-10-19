/** A Radio Friday record sleeve, drawn with the shared graphite scene tokens. */
export function LiveRecordArt({ compact = false }: { compact?: boolean }) {
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 480 440" className={compact ? 'h-full w-full' : 'h-auto w-full'}>
    <g className="live-record-disc">
      <circle cx="230" cy="220" r="198" className="fill-media-canvas stroke-line" strokeWidth="2" />
      <circle cx="230" cy="220" r="191" className="fill-canvas stroke-surface-selected" strokeWidth="3" />
      {Array.from({ length: 34 }, (_, index) => <circle key={index} cx="230" cy="220" r={84 + index * 3.05} fill="none" className={index % 5 === 0 ? 'stroke-control/40' : 'stroke-line/70'} strokeWidth={index % 5 === 0 ? 1.2 : .7} />)}
      <path d="M100 89 A185 185 0 0 1 360 89 M100 351 A185 185 0 0 0 360 351" fill="none" className="stroke-ink/15" strokeWidth="20" />
      <path d="M117 104 A164 164 0 0 1 343 104 M117 336 A164 164 0 0 0 343 336" fill="none" className="stroke-ink/10" strokeWidth="9" />
      <circle cx="230" cy="220" r="76" className="fill-ink" />
      <circle cx="230" cy="220" r="68" fill="none" className="stroke-on-action/20" />
      <text x="230" y="184" textAnchor="middle" className="fill-on-action font-sans text-[11px]">把此刻，留给声音</text>
      <text x="230" y="216" textAnchor="middle" className="fill-on-action font-brand text-[32px] italic">Friday</text>
      <circle cx="230" cy="235" r="5" className="fill-media-canvas" />
      <text x="230" y="266" textAnchor="middle" className="fill-on-action font-sans text-[11px]">Radio Friday</text>
    </g>
    {!compact && <g>
      <circle cx="423" cy="48" r="20" className="fill-surface-soft stroke-control" />
      <circle cx="423" cy="48" r="9" className="fill-control" />
      <path d="M423 48 L423 176 Q423 190 412 201 L365 248" fill="none" className="stroke-canvas" strokeWidth="12" strokeLinecap="round" />
      <path d="M423 48 L423 176 Q423 190 412 201 L365 248" fill="none" className="stroke-muted" strokeWidth="6" strokeLinecap="round" />
      <path d="M423 48 L423 176 Q423 190 412 201 L365 248" fill="none" className="stroke-ink" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="346" y="239" width="18" height="38" rx="3" transform="rotate(43 355 258)" className="fill-ink" />
      <path d="M344 270l-7 8" className="stroke-muted" strokeWidth="3" />
    </g>}
  </svg>;
}
