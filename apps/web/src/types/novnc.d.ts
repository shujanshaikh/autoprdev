declare module "@novnc/novnc" {
  export type RfbOptions = {
    shared?: boolean;
    credentials?: Record<string, string>;
  };

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | WebSocket | RTCDataChannel, options?: RfbOptions);
    scaleViewport: boolean;
    resizeSession: boolean;
    background: string;
    focus(): void;
    disconnect(): void;
  }
}
