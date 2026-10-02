// session.ts
var DocumentSession = class {
  constructor(resources, show, error) {
    this.resources = resources;
    this.show = show;
    this.error = error;
    this.removeHandler = resources.addUpdateHandler(({ params }) => {
      if (params.uri === this.file?.resourceUri) void this.refresh();
    });
  }
  generation = 0;
  revision = 0;
  file;
  subscribed;
  subscriptions = Promise.resolve();
  removeHandler;
  disposed = false;
  open(file) {
    if (this.disposed) return;
    if (this.file?.resourceUri === file.resourceUri) {
      this.file = file;
      void this.refresh();
      return;
    }
    this.file = file;
    const generation = ++this.generation;
    void this.refresh();
    this.subscriptions = this.subscriptions.then(async () => {
      if (this.subscribed) {
        const uri = this.subscribed;
        this.subscribed = void 0;
        try {
          await this.resources.unsubscribe({ uri });
        } catch {
        }
      }
      if (this.disposed || generation !== this.generation) return;
      try {
        await this.resources.subscribe({ uri: file.resourceUri });
        this.subscribed = file.resourceUri;
        if (generation === this.generation && !this.disposed) void this.refresh();
      } catch {
        if (generation === this.generation && !this.disposed) this.error("Live updates are unavailable. Use Refresh to read again.");
      }
    });
  }
  clear() {
    this.file = void 0;
    ++this.generation;
    this.subscriptions = this.subscriptions.then(async () => {
      if (!this.subscribed) return;
      const uri = this.subscribed;
      this.subscribed = void 0;
      try {
        await this.resources.unsubscribe({ uri });
      } catch {
      }
    });
  }
  async refresh() {
    const file = this.file;
    if (!file || this.disposed) return;
    const generation = this.generation;
    const revision = ++this.revision;
    const current = () => !this.disposed && generation === this.generation && revision === this.revision;
    try {
      const result = await this.resources.read({ uri: file.resourceUri, representation: "text" });
      if (!current()) return;
      const content = result.contents.find((item) => item.uri === file.resourceUri);
      if (!content) throw new Error("The host returned no document content.");
      const text = "text" in content ? content.text : new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(content.blob), (ch) => ch.charCodeAt(0)));
      this.show(text, file);
    } catch {
      if (current()) this.error("Could not read the document. Your last preview is still available. Use Refresh to retry.");
    }
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    this.removeHandler();
    await this.subscriptions;
    if (this.subscribed) {
      const uri = this.subscribed;
      this.subscribed = void 0;
      try {
        await this.resources.unsubscribe({ uri });
      } catch {
      }
    }
  }
};
export {
  DocumentSession
};
