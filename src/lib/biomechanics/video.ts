/**
 * Try to read the encoded frame rate from the video track (when exposed by the browser).
 * High capture rates (120–240 fps) are important for sprint kinematics per vision pipeline guidance.
 */
export async function inferVideoFrameRate(video: HTMLVideoElement): Promise<number | null> {
  try {
    if (typeof (video as any).captureStream !== "function") return null;
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) return null;

    const stream = (video as any).captureStream();
    const track = stream.getVideoTracks()[0];
    if (!track?.getSettings) return null;

    const settings = track.getSettings();
    const fr = settings.frameRate;
    if (typeof fr === "number" && fr > 0 && Number.isFinite(fr)) {
      return fr;
    }
  } catch {
    // captureStream can throw before enough frames are decoded
  }
  return null;
}
