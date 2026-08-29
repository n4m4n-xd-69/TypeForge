/**
 * Streams the contents of one JSON string field as it arrives.
 *
 * The generation prompts ask for a JSON envelope — `{"text": "...", "label":
 * "..."}` — and the function streamed the model's raw output straight to the
 * client as `token` frames. So a passage loaded with `{"text": "` visible at
 * the front of it, and on any reply that failed the quality gate the envelope
 * was what the user ended up typing, because the client falls back to the
 * stream when the parsed body is absent.
 *
 * Buffering until the reply completed would have fixed it and thrown away the
 * streaming. This keeps both: it watches for the field it wants, then emits
 * that string's decoded characters as they arrive and nothing else.
 *
 * If the model ignores the envelope and answers in plain prose, that is not a
 * failure — `passthrough` turns the whole stream back on, so a provider that
 * does not follow the format still produces something readable.
 */
export class JsonFieldStreamer {
  private buf = '';
  private state: 'seeking' | 'inValue' | 'finished' | 'passthrough' = 'seeking';
  private escaped = false;
  /** Unicode escapes arrive in pieces; hold them until all six chars are in. */
  private pendingEscape = '';

  constructor(private readonly field: string, private readonly giveUpAfter = 240) {}

  push(delta: string): string {
    if (!delta) return '';

    if (this.state === 'passthrough') return delta;
    if (this.state === 'finished') return '';

    if (this.state === 'seeking') {
      this.buf += delta;
      const opened = this.findValueStart();
      if (opened === -1) {
        // No envelope in sight after a reasonable amount of output: this reply
        // is prose, so release what was held and stop filtering.
        if (this.buf.length > this.giveUpAfter && !this.buf.trimStart().startsWith('{')) {
          this.state = 'passthrough';
          const held = this.buf;
          this.buf = '';
          return held;
        }
        return '';
      }
      this.state = 'inValue';
      const rest = this.buf.slice(opened);
      this.buf = '';
      return this.consume(rest);
    }

    return this.consume(delta);
  }

  /** Anything still held back — always safe to call, may return ''. */
  flush(): string {
    if (this.state === 'passthrough') {
      const held = this.buf;
      this.buf = '';
      return held;
    }
    // Held bytes while still seeking are envelope, not content; drop them.
    this.buf = '';
    return '';
  }

  /** True when the field was located, so the caller knows filtering happened. */
  get matched(): boolean {
    return this.state === 'inValue' || this.state === 'finished';
  }

  /** Index just past the opening quote of the field's value, or -1. */
  private findValueStart(): number {
    const key = `"${this.field}"`;
    const at = this.buf.indexOf(key);
    if (at === -1) return -1;
    let i = at + key.length;
    while (i < this.buf.length && /\s/.test(this.buf[i])) i += 1;
    if (this.buf[i] !== ':') return -1;
    i += 1;
    while (i < this.buf.length && /\s/.test(this.buf[i])) i += 1;
    if (this.buf[i] !== '"') return -1;
    return i + 1;
  }

  /** Decodes characters of the value until its closing quote. */
  private consume(chunk: string): string {
    let out = '';
    for (let i = 0; i < chunk.length; i += 1) {
      const c = chunk[i];

      if (this.pendingEscape) {
        this.pendingEscape += c;
        if (this.pendingEscape.length === 5) {
          const code = Number.parseInt(this.pendingEscape.slice(1), 16);
          out += Number.isNaN(code) ? '' : String.fromCharCode(code);
          this.pendingEscape = '';
        }
        continue;
      }

      if (this.escaped) {
        this.escaped = false;
        if (c === 'u') this.pendingEscape = 'u';
        else if (c === 'n') out += '\n';
        else if (c === 't') out += '\t';
        else if (c === 'r') out += '\r';
        else if (c === 'b' || c === 'f') out += '';
        else out += c; // \" \\ \/ and anything else stands for itself
        continue;
      }

      if (c === '\\') {
        this.escaped = true;
        continue;
      }

      if (c === '"') {
        this.state = 'finished';
        return out;
      }

      out += c;
    }
    return out;
  }
}

/** The field each generation kind carries its body in. */
export function bodyFieldFor(kind: string): string {
  return kind === 'snippet' ? 'code' : 'text';
}
