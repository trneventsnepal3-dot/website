import { useEffect, useState } from 'react'
import { api } from './settings'
export type GalleryPhoto = { id:string; revision:number; mediaId:string; url:string; name:string; caption:string; alt:string }
export function useGallery() {
  const [photos,setPhotos]=useState<GalleryPhoto[] | null>(null)
  useEffect(()=>{
    let active=true
    const refresh=()=>{if(!document.hidden)void api<GalleryPhoto[]>('gallery').then(value=>{if(active)setPhotos(value)}).catch(()=>{})}
    refresh();const timer=window.setInterval(refresh,30000);window.addEventListener('focus',refresh)
    return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh)}
  },[])
  return photos
}
