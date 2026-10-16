"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { getImageProps } from "next/image";
import { RadioMark } from "@/components/radio-mark";

const scenes = [
  { mobileImage: "mobile-companion-v3.png", mobileTitle: "留一点时间，给彼此。", image: "messages-across-the-rain.png", label: "温暖陪伴", title: "窗外下着雨，心里有回音。", description: "从一句问候开始，多一个愿意倾听的朋友。", alt: "雨夜窗边，两个人通过消息分享日常、彼此陪伴" },
  { mobileImage: "mobile-radio-v3.png", mobileTitle: "好声音，一直都在。", image: "radio-host.jpg", label: "深夜电台", title: "把心事，调到同一个频率。", description: "听一个声音，分享一段日常。总有故事正在发生。", alt: "暖灯与雨夜窗景中的电台主播" },
  { mobileImage: "mobile-reading-v2.png", mobileTitle: "翻一页，慢下来。", image: "reading-rainy-window.png", label: "故事漫游", title: "翻开一页，走进另一种生活。", description: "读几页书，让想象慢下来。下一段故事，从此刻开始。", alt: "雨夜窗边，暖灯照亮桌上翻开的书与茶杯" },
];
const interval = 5000;

const images = scenes.map((item, index) => ({
  mobile: getImageProps({ src: `/images/radio-friday/${index === 0 ? 'conversation.jpg' : item.image}`, alt: '', fill: true, sizes: '(max-width: 480px) 100vw, 480px' }).props,
  desktop: getImageProps({ src: `/images/radio-friday/${item.image}`, alt: '', fill: true, sizes: '55vw' }).props,
}));

export function AuthStory() {
  const [scene, setScene] = useState(0);
  const [restart, setRestart] = useState(0);
  const [requested, setRequested] = useState([0]);
  const [loaded, setLoaded] = useState<number[]>([]);
  const [reducedMotion, setReducedMotion] = useState(false);
  const markLoaded = useCallback((index: number) => {
    setLoaded(previous => previous.includes(index) ? previous : [...previous, index]);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setTimeout(() => setScene(current => (current + 1) % scenes.length), interval);
    return () => window.clearTimeout(timer);
  }, [scene, restart, reducedMotion]);
  useEffect(() => {
    // Decode the current image before requesting the next one. Off-screen
    // preload completion must not cascade into downloading the whole carousel.
    const next = [scene, ...(loaded.includes(scene) && !reducedMotion ? [(scene + 1) % scenes.length] : [])];
    setRequested(previous => next.every(index => previous.includes(index)) ? previous : [...new Set([...previous, ...next])]);
  }, [scene, loaded, reducedMotion]);

  return <aside className="auth-story auth-mobile-background" aria-label="发现 Radio Friday" aria-roledescription="轮播" style={{ "--scene-duration": `${interval}ms` } as CSSProperties}>
    <div className="auth-story-visual">
      {scenes.map((item, index) => <div key={item.image} className={`auth-scene auth-mobile-scene ${scene === index ? "is-active" : ""}`} aria-hidden={scene !== index}>
        {requested.includes(index) && <SceneImage index={index} active={index === scene} onLoaded={markLoaded} />}
      </div>)}
      <div className="auth-story-shade auth-mobile-background-shade" />
    </div>
    <div className="auth-story-top"><span className="auth-frequency"><RadioMark /> 此刻，同频</span><span className="auth-edition">Friday, every day.</span></div>
    <div className="auth-story-bottom">
      <div className="auth-story-copy" key={scene} aria-live="off" aria-atomic="true"><h2><span className="auth-story-desktop-title">{scenes[scene].title}</span><span className="auth-story-mobile-title">{scenes[scene].mobileTitle.split("，").map((line, index) => <span key={line}>{line}{index === 0 ? "，" : ""}</span>)}</span></h2><p>{scenes[scene].description}</p></div>
      <div className="auth-carousel-controls">
        <div className="auth-scene-nav" role="group" aria-label="切换场景">{scenes.map((item, index) => <button key={item.label} type="button" aria-pressed={scene === index} onClick={() => { setScene(index); setRestart(current => current + 1); }}><span className="auth-scene-line" aria-hidden="true">{scene === index && <span key={restart} className="auth-scene-progress" />}</span>{item.label}</button>)}</div>
      </div>
    </div>
  </aside>;
}

function SceneImage({ index, active, onLoaded }: { index: number; active: boolean; onLoaded: (index: number) => void }) {
  const imageRef = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth) onLoaded(index);
  }, [index, onLoaded]);
  return <picture>
    <source media="(min-width: 761px)" srcSet={images[index].desktop.srcSet} sizes={images[index].desktop.sizes} />
    <img {...images[index].mobile} alt="" loading="eager" fetchPriority={active ? 'high' : 'low'}
      ref={imageRef} onLoad={() => onLoaded(index)} />
  </picture>;
}
