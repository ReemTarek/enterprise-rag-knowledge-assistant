/**
 * In-process stand-in for `BroadcastChannel`, installed globally by `src/test-setup.ts`. Node's real BroadcastChannel
 * delivers across worker threads, so specs running in parallel could sign each other out; this fake only connects
 * channels created in the same test file. Like the browser, it delivers asynchronously (a microtask here), never to
 * the sending instance, and only between open channels with the same name. Every posted message is recorded in
 * `FakeBroadcastChannel.posted` so specs can inspect exactly what would cross the tab boundary.
 */
export class FakeBroadcastChannel extends EventTarget {
  static readonly open = new Set<FakeBroadcastChannel>();
  static readonly posted: { name: string; data: unknown }[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  #closed = false;

  constructor(readonly name: string) {
    super();
    FakeBroadcastChannel.open.add(this);
  }

  /** Forgets the message log (open channels are closed by their owners' DestroyRef). */
  static reset(): void {
    FakeBroadcastChannel.posted.length = 0;
  }

  postMessage(data: unknown): void {
    if (this.#closed) throw new DOMException('BroadcastChannel is closed', 'InvalidStateError');
    // Structured clone in the browser; a JSON round trip is enough for the plain objects sent here.
    const copy = (): unknown => JSON.parse(JSON.stringify(data)) as unknown;
    FakeBroadcastChannel.posted.push({ name: this.name, data: copy() });
    const receivers = [...FakeBroadcastChannel.open].filter(
      (c) => c !== this && c.name === this.name,
    );
    queueMicrotask(() => {
      for (const receiver of receivers) {
        if (receiver.#closed) continue;
        const event = new MessageEvent('message', { data: copy() });
        receiver.dispatchEvent(event);
        receiver.onmessage?.(event);
      }
    });
  }

  close(): void {
    this.#closed = true;
    FakeBroadcastChannel.open.delete(this);
  }
}

export function installFakeBroadcastChannel(): void {
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = FakeBroadcastChannel;
}
