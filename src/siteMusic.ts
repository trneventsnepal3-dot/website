let eventMusicPlaying = false

/** True while an event dialog is playing its own music. */
export function eventMusicActive(): boolean {
  return eventMusicPlaying
}

/** Turn on when an event dialog starts its track, off when it closes. */
export function setEventMusicActive(value: boolean) {
  eventMusicPlaying = value
}
