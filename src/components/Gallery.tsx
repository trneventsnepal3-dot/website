import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, X } from '@phosphor-icons/react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGallery } from '../gallery'
import './gallery.css'

export default function Gallery() {
  const photos=useGallery()
  const scroll=useRef<HTMLDivElement>(null)
  const dialog=useRef<HTMLDialogElement>(null)
  const trigger=useRef<HTMLElement | null>(null)
  const [selected,setSelected]=useState<string | null>(null)
  const [edges,setEdges]=useState({start:true,end:true})
  const index=photos?.findIndex(photo=>photo.id===selected) ?? -1
  const active=photos?.[index]
  const open=(id:string)=>{trigger.current=document.activeElement as HTMLElement;setSelected(id)}
  const close=()=>{setSelected(null);trigger.current?.focus({preventScroll:true})}
  const move=(step:number)=>{if(photos?.length)setSelected(photos[(index+step+photos.length)%photos.length].id)}
  const updateEdges=()=>{const el=scroll.current;if(el)setEdges({start:el.scrollLeft<2,end:el.scrollLeft+el.clientWidth>=el.scrollWidth-2})}
  const slide=(direction:number)=>{const el=scroll.current;if(el)el.scrollBy({left:direction*el.clientWidth*.8,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}
  useEffect(()=>{
    const el=scroll.current;if(!el)return
    updateEdges();const observer=new ResizeObserver(updateEdges);observer.observe(el);ScrollTrigger.refresh()
    return()=>observer.disconnect()
  },[photos?.length])
  useEffect(()=>{
    const el=dialog.current
    if(active&&!el?.open)el?.showModal()
    if(!active&&el?.open)el.close()
  },[active?.id])
  useEffect(()=>{if(!active)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous}},[Boolean(active)])
  if(!photos?.length)return null
  const columns=Math.floor(photos.length/4)*3+[0,1,2,3][photos.length%4]
  const columnSizes=Array.from({length:columns},(_,i)=>i%3===0?'var(--gallery-wide)':'var(--gallery-narrow)').join(' ')
  return <>
    <section className="gallery section-pad" id="projects" aria-labelledby="gallery-title">
      <div className="section-heading"><h2 id="gallery-title">You had to be there.</h2><p>From the front row <br />to the final encore.</p></div>
      <div ref={scroll} className="gallery-scroll" role="region" aria-label="Concert photo gallery, scroll horizontally" tabIndex={0} onScroll={updateEdges} onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){event.preventDefault();slide(event.key==='ArrowLeft'?-1:1)}}}>
        <div className="gallery-mosaic" style={{gridTemplateColumns:columnSizes}}>{photos.map((photo,i)=>{
          const slot=i%4;const column=Math.floor(i/4)*3+(slot<2?slot+1:3)
          return <button className="gallery-photo gallery-tile" key={photo.id} style={{gridColumn:column,gridRow:slot<2||(slot===2&&i===photos.length-1)?'1 / 3':slot===2?'1':'2'}} onClick={()=>open(photo.id)} aria-label={`Open photo: ${photo.alt}`}>
            <img src={photo.url} alt={photo.alt} width={slot===0?1600:1000} height={slot===0?1067:1000} loading="lazy" /><span className="photo-open" aria-hidden="true"><ArrowUpRight size={24} /></span>
          </button>
        })}</div>
      </div>
      <div className="gallery-bottom"><p>On stage. In the crowd. All together.</p><div className="gallery-scroll-controls"><button className="icon-button" onClick={()=>slide(-1)} disabled={edges.start} aria-label="Scroll gallery left"><ArrowLeft size={22} /></button><button className="icon-button" onClick={()=>slide(1)} disabled={edges.end} aria-label="Scroll gallery right"><ArrowRight size={22} /></button></div></div>
    </section>
    <dialog ref={dialog} className="photo-dialog" aria-labelledby="photo-title" onCancel={close} onClose={()=>{if(selected)close()}} onClick={event=>{
      if(event.target===event.currentTarget){const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close()}
    }} onKeyDown={event=>{if(event.key==='ArrowRight'){event.preventDefault();move(1)}if(event.key==='ArrowLeft'){event.preventDefault();move(-1)}}}>
      {active&&<><button className="photo-close icon-button" onClick={close} aria-label="Close photo viewer" autoFocus><X size={24} /></button><img className="photo-dialog-image" src={active.url} alt={active.alt} /><div className="photo-dialog-bottom"><div aria-live="polite"><h2 id="photo-title">{active.caption||active.alt}</h2><p>{index+1} of {photos.length}</p></div><div className="photo-controls"><button className="icon-button" onClick={()=>move(-1)} aria-label="Previous photo"><ArrowLeft size={23} /></button><button className="icon-button" onClick={()=>move(1)} aria-label="Next photo"><ArrowRight size={23} /></button></div></div></>}
    </dialog>
  </>
}
