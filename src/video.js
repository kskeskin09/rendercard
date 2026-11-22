import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  canEncodeVideo
} from 'mediabunny';

export async function encodeVideo(view, end, fps, renderFrame) {
  const scale = Math.min(1, 1280 / view.canvas.width, 720 / view.canvas.height);
  const even = (value) => Math.max(2, 2 * Math.floor(value / 2));
  const canvas = document.createElement('canvas');
  canvas.width = even(view.canvas.width * scale);
  canvas.height = even(view.canvas.height * scale);
  const context = canvas.getContext('2d', { alpha: false });
  const options = {
    width: canvas.width,
    height: canvas.height,
    bitrate: 3_000_000
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
      view.render(true);
      context.drawImage(view.canvas, 0, 0, canvas.width, canvas.height);
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
