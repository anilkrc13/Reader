import type { OpenAIResources, OpenAIFileEntrypointInput } from "@openai/mcp-extensions/app";
type File = OpenAIFileEntrypointInput["file"];

// One instance per iframe. Host URIs are identities, never filesystem paths.
export class DocumentSession {
  private generation = 0;
  private revision = 0;
  private file?: File;
  private subscribed?: string;
  private subscriptions: Promise<void> = Promise.resolve();
  private removeHandler: () => void;
  private disposed = false;
  constructor(private resources: OpenAIResources,
    private show: (text: string, file: File) => void,
    private error: (message: string) => void) {
    this.removeHandler = resources.addUpdateHandler(({params}) => {
      if (params.uri === this.file?.resourceUri) void this.refresh();
    });
  }
  open(file: File): void {
    if (this.disposed) return;
    if (this.file?.resourceUri === file.resourceUri) { this.file = file; void this.refresh(); return; }
    this.file = file;
    const generation = ++this.generation;
    void this.refresh();
    this.subscriptions = this.subscriptions.then(async () => {
      if (this.subscribed) {
        const uri = this.subscribed;
        this.subscribed = undefined;
        try { await this.resources.unsubscribe({uri}); } catch { /* host may have already closed it */ }
      }
      if (this.disposed || generation !== this.generation) return;
      try {
        await this.resources.subscribe({uri: file.resourceUri});
        this.subscribed = file.resourceUri;
        if (generation === this.generation && !this.disposed) void this.refresh();
      } catch {
        if (generation === this.generation && !this.disposed) this.error("Live updates are unavailable. Use Refresh to read again.");
      }
    });
  }
  clear(): void {
    this.file = undefined;
    ++this.generation;
    this.subscriptions = this.subscriptions.then(async () => {
      if (!this.subscribed) return;
      const uri = this.subscribed;
      this.subscribed = undefined;
      try { await this.resources.unsubscribe({uri}); } catch { /* resource may already be gone */ }
    });
  }
  async refresh(): Promise<void> {
    const file = this.file;
    if (!file || this.disposed) return;
    const generation = this.generation;
    const revision = ++this.revision;
    const current = () => !this.disposed && generation === this.generation && revision === this.revision;
    try {
      const result = await this.resources.read({uri: file.resourceUri, representation: "text"});
      if (!current()) return;
      const content = result.contents.find(item => item.uri === file.resourceUri);
      if (!content) throw new Error("The host returned no document content.");
      const text = "text" in content ? content.text :
        new TextDecoder("utf-8", {fatal: true}).decode(Uint8Array.from(atob(content.blob), ch => ch.charCodeAt(0)));
      this.show(text, file);
    } catch {
      if (current()) this.error("Could not read the document. Your last preview is still available. Use Refresh to retry.");
    }
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    this.removeHandler();
    await this.subscriptions;
    if (this.subscribed) {
      const uri = this.subscribed;
      this.subscribed = undefined;
      try { await this.resources.unsubscribe({uri}); } catch { /* shutdown is best effort */ }
    }
  }
}
