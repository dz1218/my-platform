import { publicMetadata } from '@/lib/seo';

export const metadata = {
  ...publicMetadata('Radio Friday — 语音直播与陪伴', '在 Radio Friday 直播大厅发现语音直播，听听大家的声音，参与聊天与连麦，也可以探索 AI 陪伴聊天和小说阅读。', '/'),
  title: { absolute: 'Radio Friday — 语音直播与陪伴' },
};

/** The browsing shell owns the lobby so route loading cannot replace cached rooms. */
export default function HomePage() {
  return null;
}
