/** Whether a branding-asset URL points at a video (standby slot only
 * accepts image or video files — nothing else needs this check). */
export function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return /\.(mp4|webm)(\?|$)/i.test(url)
}
