"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Image, { getImageProps } from "next/image";
import { RadioMark } from "@/components/radio-mark";

const scenes = [
  { mobileImage: "mobile-companion-v3.png", mobileTitle: "留一点时间，给彼此。", image: "messages-across-the-rain.png", label: "温暖陪伴", title: "窗外下着雨，心里有回音。", description: "从一句问候开始，多一个愿意倾听的朋友。", alt: "雨夜窗边，两个人通过消息分享日常、彼此陪伴" },
  { mobileImage: "mobile-radio-v3.png", mobileTitle: "好声音，一直都在。", image: "radio-host.jpg", label: "深夜电台", title: "把心事，调到同一个频率。", description: "听一个声音，分享一段日常。总有故事正在发生。", alt: "暖灯与雨夜窗景中的电台主播" },
  { mobileImage: "mobile-reading-v2.png", mobileTitle: "翻一页，慢下来。", image: "reading-rainy-window.png", label: "故事漫游", title: "翻开一页，走进另一种生活。", description: "读几页书，让想象慢下来。下一段故事，从此刻开始。", alt: "雨夜窗边，暖灯照亮桌上翻开的书与茶杯" },
];
const interval = 5000;

const mobileImages = scenes.map(item => getImageProps({
  src: `/images/radio-friday/${item.mobileImage}`, alt: "", fill: true, sizes: "(max-width: 480px) 100vw, 432px",
}).props);

export function AuthStory() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const viewport = window.matchMedia("(min-width: 761px)");
    const syncViewport = () => setDesktop(viewport.matches);
    syncViewport();
    viewport.addEventListener("change", syncViewport);
    return () => viewport.removeEventListener("change", syncViewport);
  }, []);
  return desktop ? <DesktopAuthStory /> : <MobileAuthBackground />;
}

function MobileAuthBackground() {
  const [scene, setScene] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setScene(current => (current + 1) % scenes.length), interval);
    return () => window.clearInterval(timer);
  }, []);

  return <div className="auth-mobile-background" aria-hidden="true">
    {scenes.map((item, index) => <div key={item.image} className={`auth-mobile-scene ${scene === index ? "is-active" : ""}`}>
      <Image src={`/images/radio-friday/${index === 0 ? "conversation.jpg" : item.image}`} alt="" fill
        priority={index === 0} loading={index === 0 ? undefined : "eager"} sizes="(max-width: 480px) 100vw, 480px" />
    </div>)}
    <div className="auth-mobile-background-shade" />
  </div>;
}

function DesktopAuthStory() {
  const [scene, setScene] = useState(0);
  const [restart, setRestart] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setScene(current => (current + 1) % scenes.length), interval);
    return () => window.clearTimeout(timer);
  }, [scene, restart]);

  return <aside className="auth-story" aria-label="发现 Radio Friday" aria-roledescription="轮播" style={{ "--scene-duration": `${interval}ms` } as CSSProperties}>
    <div className="auth-story-visual">
      {scenes.map((item, index) => <div key={item.image} className={`auth-scene ${scene === index ? "is-active" : ""}`} aria-hidden={scene !== index}>
        <picture>
          <source media="(max-width: 760px)" srcSet={mobileImages[index].srcSet} sizes={mobileImages[index].sizes} />
          <Image src={`/images/radio-friday/${item.image}`} alt="" fill priority={index === 0} sizes="(max-width: 760px) 100vw, 55vw" />
        </picture>
      </div>)}
      <div className="auth-story-shade" />
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
