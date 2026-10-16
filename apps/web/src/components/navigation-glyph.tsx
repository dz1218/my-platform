import type { ReactNode } from 'react';

// A small, shared family of radio-inspired desktop navigation symbols.
const glyphs = {
  companion: <>
    <path d="M19.5 17.5v1a4 4 0 0 1-4 4H12l-4 3v-3.5" />
    <path d="M6.5 5.5h13a5 5 0 0 1 5 5v3a5 5 0 0 1-5 5h-7l-5 3v-3a5 5 0 0 1-5-5v-3a5 5 0 0 1 4-4.9Z" fill="currentColor" fillOpacity=".08" />
    <path d="M9 11.5c0-2 2.8-2.7 4.5-.5 1.7-2.2 4.5-1.5 4.5.5 0 2-4.5 4.5-4.5 4.5S9 13.5 9 11.5Z" fill="currentColor" stroke="none" />
  </>,
  live: <>
    <path d="m11 6 9-3M5 7.5h18a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" fill="currentColor" fillOpacity=".08" />
    <circle cx="10" cy="16" r="4" />
    <circle cx="10" cy="16" r="1" fill="currentColor" stroke="none" />
    <path d="M18 12h3M18 16h3M18 20h1M7 24.5v1M21 24.5v1" />
  </>,
  novels: <>
    <path d="M14 7c-3-2-6-2.5-11-1.5v17c5-1 8-.5 11 1.5 3-2 6-2.5 11-1.5v-17C20 4.5 17 5 14 7Z" fill="currentColor" fillOpacity=".08" />
    <path d="M14 7v17M7 11l3 .5M7 15l3 .5M18 5.5v8l2-1.5 2 1.5v-8" />
  </>,
  account: <>
    <circle cx="14" cy="14" r="11" fill="currentColor" fillOpacity=".08" />
    <circle cx="14" cy="10.5" r="3.5" />
    <path d="M6 21.5c1-3.5 3.7-5 8-5s7 1.5 8 5" />
  </>,
} satisfies Record<string, ReactNode>;

export type NavigationGlyphName = keyof typeof glyphs;

export function NavigationGlyph({ name }: { name: NavigationGlyphName }) {
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="size-7 shrink-0">{glyphs[name]}</svg>;
}
