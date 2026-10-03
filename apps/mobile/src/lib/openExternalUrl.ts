import * as Schema from "effect/Schema";
import { Linking } from "react-native";

const ExternalUrlTarget = Schema.Literals([
  "file-preview",
  "markdown-link",
  "pull-request",
  "issue",
  "provider-auth",
]);

export type ExternalUrlTarget = typeof ExternalUrlTarget.Type;

/** Targets that are always web pages, so any other scheme is refused rather than handed to the OS. */
const WEB_ONLY_TARGETS: ReadonlySet<ExternalUrlTarget> = new Set(["issue"]);

export class ExternalUrlOpenError extends Schema.TaggedError<ExternalUrlOpenError>()(
  "ExternalUrlOpenError",
  {
    target: ExternalUrlTarget,
    scheme: Schema.String,
    host: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to open ${this.target} URL with the ${this.scheme} scheme.`;
  }
}

function externalUrlMetadata(url: string): { readonly scheme: string; readonly host?: string } {
  try {
    const parsed = new URL(url);
    return {
      scheme: parsed.protocol.replace(/:$/, "") || "unknown",
      host: parsed.hostname || undefined,
    };
  } catch {
    return {
      scheme: /^([a-z][a-z\d+.-]*):/i.exec(url)?.[1]?.toLowerCase() ?? "unknown",
    };
  }
}

export async function tryOpenExternalUrl(url: string, target: ExternalUrlTarget): Promise<boolean> {
  if (WEB_ONLY_TARGETS.has(target)) {
    const { scheme } = externalUrlMetadata(url);
    if (scheme !== "https" && scheme !== "http") return false;
  }
  try {
    await Linking.openURL(url);
    return true;
  } catch (cause) {
    const error = new ExternalUrlOpenError({ target, ...externalUrlMetadata(url), cause });
    console.error(error.message, {
      _tag: error._tag,
      target: error.target,
      scheme: error.scheme,
      host: error.host,
      stack: error.stack,
    });
    return false;
  }
}
