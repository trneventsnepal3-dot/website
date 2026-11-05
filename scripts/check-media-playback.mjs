import assert from 'node:assert/strict'
import { webkit } from '@playwright/test'

const browser = await webkit.launch()
try {
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:5173')
  await page.waitForTimeout(2000)
  const video = await page.locator('video').evaluate(v => ({ paused: v.paused, muted: v.muted, autoplay: v.autoplay, inline: v.playsInline, error: v.error?.message, time: v.currentTime }))
  assert.equal(video.paused, false)
  assert.equal(video.muted && video.autoplay && video.inline, true)
  assert.ok(video.time > 0)
  console.log('PASS: real hero video autoplays muted and inline in WebKit.')
  await page.close()

  const context = await browser.newContext()
  await context.addInitScript(() => {
    // Policy tests simulate media playback independently of host audio codecs.
    document.addEventListener('error', event => {
      if (event.target instanceof HTMLAudioElement) event.stopImmediatePropagation()
    }, true)
    let gesture = false
    for (const name of ['click', 'touchend', 'keydown']) window.addEventListener(name, () => {
      gesture = true
      setTimeout(() => { gesture = false }, 0)
    }, true)
    const paused = new WeakMap()
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', { get() { return paused.get(this) !== false } })
    HTMLMediaElement.prototype.play = function () {
      if (!gesture) return Promise.reject(new DOMException('Gesture required', 'NotAllowedError'))
      paused.set(this, false)
      this.dispatchEvent(new Event('play'))
      return Promise.resolve()
    }
    HTMLMediaElement.prototype.pause = function () {
      paused.set(this, true)
      this.dispatchEvent(new Event('pause'))
    }
  })
  const test = await context.newPage()
  await test.route('**/api/**', async route => {
    if (route.request().url().endsWith('/site-settings')) await route.fulfill({ json: {
      revision: 0, effectsEnabled: true, popupEnabled: false, audioEnabled: true, heroVideoEnabled: true,
      popup: null, hero: null, audio: { id: 'test-audio', url: '/test-audio.wav' }, audioVolume: .35, galleryBaseUrl: ''
    } })
    else await route.fulfill({ json: [] })
  })
  const wav = Buffer.alloc(44 + 16000)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(16000, 40)
  await test.route('**/test-audio.wav', route => route.fulfill({ contentType: 'audio/wav', body: wav }))
  await test.goto('http://127.0.0.1:5173')
  await test.locator('.music-control').waitFor()
  assert.equal(await test.locator('audio').evaluate(a => a.paused), true)
  await test.locator('.hero-copy p').click()
  assert.equal(await test.locator('audio').evaluate(a => a.paused), false)
  assert.equal(await test.locator('video').evaluate(v => v.paused), false)
  await test.locator('.music-control').click()
  await test.locator('.video-control').click()
  await test.locator('.hero-copy p').click()
  assert.equal(await test.locator('audio').evaluate(a => a.paused), true)
  assert.equal(await test.locator('video').evaluate(v => v.paused), true)
  await test.locator('.music-control').click()
  assert.equal(await test.locator('audio').evaluate(a => a.paused), false)
  await test.emulateMedia({ reducedMotion: 'reduce' })
  await test.locator('.hero-copy p').click()
  assert.equal(await test.locator('video').evaluate(v => v.paused), true)
  console.log('PASS: blocked autoplay retries on interaction, explicit pauses persist, music resumes manually, reduced motion stays paused.')
  await context.close()
} finally {
  await browser.close()
}
