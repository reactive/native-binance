/** Which stream URLs are down. Not store data: a silent socket writes no payload. */
export class StreamStatus {
  private readonly down = new Set<string>();
  private readonly listeners = new Set<() => void>();

  setDown(url: string, isDown: boolean): void {
    const wasDown = this.down.has(url);
    if (wasDown === isDown) return;
    if (isDown) this.down.add(url);
    else this.down.delete(url);
    for (const listener of [...this.listeners]) listener();
  }

  isDown(url: string): boolean {
    return this.down.has(url);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export const streamStatus = new StreamStatus();
