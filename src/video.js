import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  canEncodeVideo
} from 'mediabunny';

export async function encodeVideo(view, size, end, fps, renderFrame) {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { alpha: false });
  const options = {
    width: canvas.width,
    height: canvas.height,
    bitrate: Math.max(1_000_000, Math.min(30_000_000, Math.round(canvas.width * canvas.height * 3.5)))
  };
  const codec = (await canEncodeVideo('vp8', options))
    ? 'vp8'
    : (await canEncodeVideo('avc', options))
      ? 'avc'
      : null;
  if (!codec || !context) {
    throw new Error('Bu tarayıcı desteklenen bir video kodlayıcısı sunmuyor.');
  }
  const webm = codec === 'vp8';
  const target = new BufferTarget();
  const output = new Output({
    format: webm ? new WebMOutputFormat() : new Mp4OutputFormat(),
    target
  });
  const source = new CanvasSource(canvas, { codec, bitrate: options.bitrate });
  output.addVideoTrack(source, { frameRate: fps });
  try {
    await output.start();
    for (let frame = 0; frame <= end; frame++) {
      renderFrame(frame);
      context.drawImage(view.renderOutput(canvas.width, canvas.height), 0, 0);
      await source.add(frame / fps, 1 / fps);
      if (frame % 8 === 0)
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    source.close();
    await output.finalize();
  } catch (error) {
    await output.cancel();
    throw error;
  }
  return {
    blob: new Blob([target.buffer], {
      type: webm ? 'video/webm' : 'video/mp4'
    }),
    name: webm ? 'rendercard.webm' : 'rendercard.mp4'
  };
}
