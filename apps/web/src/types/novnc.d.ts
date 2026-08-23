declare module "@novnc/novnc" {
  export type RfbOptions = {
    shared?: boolean;
    credentials?: Record<string, string>;
  };

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | WebSocket | RTCDataChannel, options?: RfbOptions);
    clipViewport: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    background: string;
    getImageData(): ImageData;
    focus(): void;
    disconnect(): void;
  }
}
