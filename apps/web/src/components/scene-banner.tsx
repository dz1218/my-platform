import Image from 'next/image';
import { RadioMark } from './radio-mark';

const scenes = {
  companion: { image: 'messages-across-the-rain.png', label: '温暖陪伴' },
  live: { image: 'radio-host.jpg', label: '深夜电台' },
  reading: { image: 'reading-rainy-window.png', label: '故事漫游' },
};

/** Pure presentation, safe to use from server pages as well as client views. */
export function SceneBanner({ scene, title, description, compact = false }: {
  scene: keyof typeof scenes; title: string; description: string; compact?: boolean;
}) {
  const content = scenes[scene];
  return <section aria-label={content.label} className={`scene-banner ${compact ? 'scene-banner-compact' : ''}`}>
    <Image src={`/images/radio-friday/${content.image}`} alt="" fill sizes="(max-width: 767px) 100vw, 75vw" className="object-cover object-center" />
    <div className="scene-shade" />
    <div className="relative z-10 flex h-full max-w-xl flex-col justify-end p-6 md:p-9">
      <span className="mb-auto flex items-center gap-2 pb-6 text-xs text-photo-muted"><RadioMark />{content.label}</span>
      <h2 className="text-xl leading-snug font-medium text-photo-ink md:text-3xl">{title}</h2>
      <p className="mt-3 max-w-sm text-sm leading-7 text-photo-muted">{description}</p>
    </div>
  </section>;
}
