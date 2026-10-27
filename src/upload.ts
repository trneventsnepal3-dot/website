import { api, type Media } from './settings'
type UploadTicket = { pathname: string; url: string; method: string; headers: Record<string, string> }
export async function uploadMedia(kind: Media['kind'], file: File, onProgress: (percentage: number) => void) {
  const ticket = await api<UploadTicket>('admin/uploads', 'POST', { kind, name: file.name, contentType: file.type, size: file.size })
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open(ticket.method, ticket.url)
    for (const [key, value] of Object.entries(ticket.headers)) request.setRequestHeader(key, value)
    request.timeout = 10 * 60 * 1000
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)) }
    request.onerror = () => reject(new Error('Upload failed. Check your connection and the bucket’s CORS settings.'))
    request.ontimeout = () => reject(new Error('Upload timed out. Try a smaller file or a faster connection.'))
    request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error('Neon storage rejected the upload. Check bucket permissions and try again.'))
    request.send(file)
  })
  return api<Media>('admin/media', 'POST', { pathname: ticket.pathname })
}
