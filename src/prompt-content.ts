import { RequestError } from "@agentclientprotocol/sdk";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { Model, ImageContent } from "@mariozechner/pi-ai";

const MAX_SESSION_NAME_LENGTH = 50;

/**
 * Converts ACP ContentBlock[] into text + images for Pi session.prompt().
 *
 * - `text` blocks → concatenated into the prompt string
 * - `image` blocks → added to the images array (rejected if model lacks vision)
 * - `resource` (text) → embedded as a fenced code block in prompt text
 * - `resource` (blob, image mime) → added to the images array
 * - `resource` (blob, non-image mime) → placeholder text in prompt string
 * - `resource_link` → placeholder text in prompt string
 */
export function convertPromptContent(
  content: ContentBlock[],
  model: Model<any> | undefined,
): { text: string; images: ImageContent[] } {
  const textParts: string[] = [];
  const images: ImageContent[] = [];
  const supportsImage = model?.input.includes("image");

  for (const block of content) {
    switch (block.type) {
      case "text": {
        textParts.push(block.text);
        break;
      }
      case "image": {
        if (!supportsImage) {
          throw RequestError.invalidParams(
            `Current model (${model?.id ?? "unknown"}) does not support images`,
          );
        }
        images.push({ type: "image", data: stripDataUri(block.data), mimeType: block.mimeType });
        break;
      }
      case "audio": {
        // Out of scope — include as placeholder text
        textParts.push(`[Audio: ${block.mimeType}]`);
        break;
      }
      case "resource_link": {
        textParts.push(`[Resource: ${block.uri}]`);
        break;
      }
      case "resource": {
        const res = block.resource;
        if ("text" in res && typeof res.text === "string") {
          textParts.push(`\`\`\`${res.mimeType ?? ""}\n${res.text}\n\`\`\``);
        } else if ("blob" in res && typeof res.blob === "string") {
          if (res.mimeType?.startsWith("image/")) {
            if (!supportsImage) {
              throw RequestError.invalidParams(
                `Current model (${model?.id ?? "unknown"}) does not support images`,
              );
            }
            images.push({ type: "image", data: stripDataUri(res.blob), mimeType: res.mimeType });
          } else {
            textParts.push(`[Binary resource: ${res.uri}]`);
          }
        } else {
          textParts.push(`[Binary resource: ${res.uri}]`);
        }
        break;
      }
    }
  }

  return { text: textParts.join("\n"), images };
}

/**
 * Strip data: URI prefix if present, returning raw base64.
 * ACP spec says data is raw base64, but some clients send full data URIs.
 */
function stripDataUri(data: string): string {
  const idx = data.indexOf(",");
  if (idx > 0 && data.startsWith("data:")) {
    return data.slice(idx + 1);
  }
  return data;
}

/**
 * Derives a session name from the first line of a prompt text.
 * Returns undefined if the line is empty or starts with "/".
 */
export function deriveSessionName(content: ContentBlock[]): string | undefined {
  const cleanText = content
    .reduce((str, block) => str + getBlockText(block), "")
    .trim()
    .split("\n")[0];

  if (!cleanText || cleanText.startsWith("/")) {
    return undefined;
  }
  if (cleanText.length <= MAX_SESSION_NAME_LENGTH) {
    return cleanText;
  }
  return cleanText.slice(0, MAX_SESSION_NAME_LENGTH).trimEnd() + "...";
}

function getBlockText(block: ContentBlock): string {
  let text: string | null | undefined;

  switch (block.type) {
    case "text":
      return block.text;
    case "image":
      text = getFileNameFromURI(block.uri) || block.mimeType;
      break;
    case "audio":
      text = block.mimeType;
      break;
    case "resource_link":
      text = getFileNameFromURI(block.uri);
      break;
    case "resource":
      text = getFileNameFromURI(block.resource.uri);
      break;
  }

  return `[${text || block.type}]`;
}

function getFileNameFromURI(uri?: string | null) {
  return uri?.split("/").at(-1);
}
