export const defaultRenderSize = { width: 1280, height: 720 };
export const renderSizes = [
  [1280, 720], [1920, 1080], [1080, 1920], [1080, 1080], [2560, 1440], [3840, 2160]
];
export const maxRenderSide = 4096;
export const validRenderSize = size =>
  size && ['width', 'height'].every(axis =>
    Number.isInteger(size[axis]) && size[axis] >= 16 && size[axis] <= maxRenderSide);

export function fitRenderFrame(width, height, aspect) {
  const fitWidth = Math.min(width, height * aspect);
  return { width: fitWidth, height: fitWidth / aspect };
}
