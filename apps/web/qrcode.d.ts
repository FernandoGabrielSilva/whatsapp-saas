declare module 'qrcode' {
  export function toDataURL(text: string): Promise<string>;
  export function toString(text: string): Promise<string>;
  export function toFile(path: string, text: string): Promise<void>;
  export function toCanvas(canvas: HTMLCanvasElement, text: string): Promise<void>;
  export function toBuffer(text: string): Promise<Buffer>;
}
