// Browser-scoped test double; Node's MessageEvent belongs to a different realm than jsdom.
export class TestCheckoutChannel {
  static channels = new Set<TestCheckoutChannel>();
  onmessage: (() => void) | null = null;
  constructor(readonly name: string) {
    TestCheckoutChannel.channels.add(this);
  }
  postMessage() {
    for (const channel of TestCheckoutChannel.channels) {
      if (channel !== this && channel.name === this.name)
        queueMicrotask(() => {
          if (TestCheckoutChannel.channels.has(channel)) channel.onmessage?.();
        });
    }
  }
  close() {
    TestCheckoutChannel.channels.delete(this);
  }
}
