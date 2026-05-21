// Bridges the ingress->notifier gap: ingress sees language_code per update,
// notifier only has update_id. Entries are keyed by update_id and removed on
// recall, so memory is bounded by in-flight updates.
//
// Persistence across restarts (e.g. SQLite KV) is a future upgrade; bot
// restarts are infrequent and fallback to English is acceptable.
//
// Callers depend on the interface, not the class -- tests can pass a fake
// without a structural mismatch on the private map.
export interface LanguageStore {
  remember(updateId: number, lang: string | undefined): void;
  recall(updateId: number): string | undefined;
}

export class InMemoryLanguageStore implements LanguageStore {
  private readonly map = new Map<number, string>();

  remember(updateId: number, lang: string | undefined): void {
    if (lang !== undefined) {
      this.map.set(updateId, lang);
    }
  }

  recall(updateId: number): string | undefined {
    const lang = this.map.get(updateId);
    this.map.delete(updateId);
    return lang;
  }
}
