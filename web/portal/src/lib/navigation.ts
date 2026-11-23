import type { Component } from 'vue';
import {
  Compass, Film, Image as ImageIcon, LayoutGrid, MessageSquare, Music2, Video,
} from 'lucide-vue-next';

export type NavigationKey = 'chat' | 'image' | 'video' | 'music' | 'gallery' | 'library' | 'workflow';

export interface NavigationItem {
  key: NavigationKey;
  to: string;
  label: string;
  icon: Component;
}

/** One navigation order for the plaza, workspace rail and mobile drawer. */
export function primaryNavigation(shortFilm = false): NavigationItem[] {
  const items: NavigationItem[] = [
    { key: 'gallery', to: '/', label: '作品广场', icon: Compass },
    { key: 'chat', to: '/chat', label: 'AI 对话', icon: MessageSquare },
    { key: 'image', to: '/image', label: '图像', icon: ImageIcon },
    { key: 'video', to: '/video', label: '视频', icon: Video },
    { key: 'music', to: '/music', label: '音乐', icon: Music2 },
    { key: 'library', to: '/library', label: '我的库', icon: LayoutGrid },
  ];
  if (shortFilm) items.push({ key: 'workflow', to: '/workflow', label: '短片工坊', icon: Film });
  return items;
}

export function isNavigationActive(item: NavigationItem, path: string, routeName: unknown) {
  if (item.key === 'gallery') return routeName === 'home' || routeName === 'gallery';
  return path === item.to || path.startsWith(`${item.to}/`);
}
