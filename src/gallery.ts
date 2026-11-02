import { useEffect, useState } from 'react'
import { api } from './settings'
export type GalleryPhoto = { id: string; revision: number; mediaId: string; albumId: string | null; url: string; name: string; caption: string; alt: string }
export type GalleryAlbum = { id: string; revision: number; name: string; coverId: string; coverUrl: string; photos: GalleryPhoto[] }
export function useAlbums() {
  const [albums, setAlbums] = useState<GalleryAlbum[] | null>(null)
  useEffect(() => {
    let active = true
    const refresh = () => { if (!document.hidden) void api<GalleryAlbum[]>('albums').then(value => { if (active) setAlbums(value) }).catch(() => {}) }
    refresh(); const timer = window.setInterval(refresh, 30000); window.addEventListener('focus', refresh)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [])
  return albums
}
