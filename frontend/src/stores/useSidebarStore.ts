/** 좌측 내비 사이드바 접힘 상태 스토어 (zustand + localStorage 영속화).
 *
 * 일반 사용자는 레포트만 보는 경우가 많아, 사이드바를 접어 화면을 넓게 쓰도록 한다.
 * 접힘 여부는 localStorage에 저장되어 페이지 이동/새로고침 후에도 유지된다.
 * 기본값은 펼침(false).
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SidebarState {
  collapsed: boolean
  toggle: () => void
  setCollapsed: (v: boolean) => void
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      collapsed: false,
      toggle: () => set((s) => ({ collapsed: !s.collapsed })),
      setCollapsed: (v) => set({ collapsed: v }),
    }),
    { name: 'bip-sidebar' },
  ),
)
