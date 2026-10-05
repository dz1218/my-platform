import type { CSSProperties } from 'react';

const paths = {
  video: 'M15 8l6-3v14l-6-3 M3 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  videoOff: 'M2 2l20 20 M9 5h4a2 2 0 0 1 2 2v1l6-3v14l-6-3 M15 15v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2',
  mic: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5Z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8',
  micOff: 'M2 2l20 20 M9 5a3 3 0 0 1 6 0v5 M9 9v3a3 3 0 0 0 5 2 M5 10v2a7 7 0 0 0 12 5 M19 10v2 M12 19v3 M8 22h8',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z M17 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87',
  arrow: 'M5 12h14 M12 5l7 7-7 7',
  back: 'M19 12H5 M12 5l-7 7 7 7',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  refresh: 'M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 13 3 M5 15a8 8 0 0 0 13 3',
  plus: 'M12 5v14 M5 12h14',
  close: 'M6 6l12 12 M6 18L18 6',
  play: 'M9 5l11 7-11 7V5Z',
  screen: 'M4 3h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M8 23h8 M12 19v4',
  chat: 'M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5Z M8 11h8',
  send: 'M22 2L9 15 M22 2l-7 20-6-7-7-6 20-7Z',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  expand: 'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M3 16v5h5',
  leave: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  info: 'M12 8h.01 M12 11v6 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  check: 'M5 12l4 4L19 6',
  robot: 'M12 3v3 M10 3h4 M5 6h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z M7 11h.01 M17 11h.01 M8 16h8',
  volume: 'M11 5L6 9H2v6h4l5 4V5Z M15 8a6 6 0 0 1 0 8 M18 5a10 10 0 0 1 0 14',
} as const;

export function LiveIcon({ name, size = 18, className, style }: { name: keyof typeof paths; size?: number; className?: string; style?: CSSProperties }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}><path d={paths[name]} /></svg>;
}
