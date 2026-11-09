export const MAX_IMAGE_EDGE = 1280;
export const JPEG_QUALITY = 0.7;

/**
 * Grab the current video frame, scale the long edge to 1280 px and encode it
 * as a compact JPEG. This mirrors the server-side compression.
 */
export async function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    throw new Error('The camera frame is not ready yet');
  }

  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas is not available');
  }
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
  });

  if (!blob) {
    throw new Error('Could not encode the photo');
  }
  return blob;
}
