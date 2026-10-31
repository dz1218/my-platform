import { BookOpen } from 'lucide-react';

export function BookCover({ title, author, showBrand = true }: { title: string; author: string; showBrand?: boolean }) {
  return <div className="book-cover" aria-hidden="true">
    <BookOpen strokeWidth={1.25} className="relative z-10 size-5 opacity-75" />
    <div className={`relative z-10 py-5 ${showBrand ? '' : 'my-auto'}`}><p className="text-lg leading-relaxed font-medium md:text-2xl">{title}</p><p className="mt-4 text-xs text-muted">{author}</p></div>
    {showBrand && <span className="relative z-10 font-brand text-xs text-muted">Radio Friday</span>}
  </div>;
}
