import { describe, expect, it } from "bun:test";
import { RequestError } from "@agentclientprotocol/sdk";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { convertPromptContent, deriveSessionName } from "../src/prompt-content";
import type { Model } from "@mariozechner/pi-ai";

function createMockModel(overrides?: Partial<Model<any>>): Model<any> {
  return {
    id: "test-model",
    name: "Test Model",
    api: "openai-completions",
    provider: "openai",
    baseUrl: "https://api.openai.com",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
    ...overrides,
  } as Model<any>;
}

describe("convertPromptContent", () => {
  const visionModel = createMockModel({
    id: "gpt-4o",
    provider: "openai",
    input: ["text", "image"],
  });
  const textOnlyModel = createMockModel({
    id: "gpt-4-mini",
    provider: "openai",
    input: ["text"],
  });

  it("extracts text from text blocks", () => {
    const blocks: ContentBlock[] = [
      { text: "Hello ", type: "text" },
      { text: "world", type: "text" },
    ];
    const result = convertPromptContent(blocks, visionModel);
    expect(result.text).toBe("Hello \nworld");
    expect(result.images).toHaveLength(0);
  });

  it("converts image blocks when model supports vision", () => {
    const blocks: ContentBlock[] = [
      { text: "Look at this:", type: "text" },
      {
        type: "image",
        data: "base64data",
        mimeType: "image/png",
      },
    ];
    const result = convertPromptContent(blocks, visionModel);
    expect(result.text).toBe("Look at this:");
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toEqual({
      type: "image",
      data: "base64data",
      mimeType: "image/png",
    });
  });

  it("strips data: URI prefix from image block data", () => {
    const blocks: ContentBlock[] = [
      {
        type: "image",
        data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE",
        mimeType: "image/png",
      },
    ];
    const result = convertPromptContent(blocks, visionModel);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toEqual({
      type: "image",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAE",
      mimeType: "image/png",
    });
  });

  it("strips data: URI prefix from image blob resource", () => {
    const blocks: ContentBlock[] = [
      {
        type: "resource",
        resource: {
          uri: "file:///photo.jpg",
          mimeType: "image/jpeg",
          blob: "data:image/jpeg;base64,/9j/4AAQSkZJRg",
        },
      },
    ];
    const result = convertPromptContent(blocks, visionModel);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toEqual({
      type: "image",
      data: "/9j/4AAQSkZJRg",
      mimeType: "image/jpeg",
    });
  });

  it("throws when model does not support images", () => {
    const blocks: ContentBlock[] = [
      {
        type: "image",
        data: "base64data",
        mimeType: "image/png",
      },
    ];
    expect(() => convertPromptContent(blocks, textOnlyModel)).toThrow(RequestError);
    expect(() => convertPromptContent(blocks, undefined)).toThrow(RequestError);
  });

  it("embeds text resource as fenced code block", () => {
    const blocks: ContentBlock[] = [
      {
        type: "resource",
        resource: {
          uri: "file:///src/code.ts",
          mimeType: "text/typescript",
          text: "const x = 1;",
        },
      },
    ];
    const result = convertPromptContent(blocks, visionModel);
    expect(result.text).toContain("```text/typescript");
    expect(result.text).toContain("const x = 1;");
    expect(result.images).toHaveLength(0);
  });

  it("converts image blob resource to ImageContent", () => {
    const blocks: ContentBlock[] = [
      {
        type: "resource",
        resource: {
          uri: "file:///photo.jpg",
          mimeType: "image/jpeg",
          blob: "jpegBase64Data",
        },
      },
    ];
    const result = convertPromptContent(blocks, visionModel);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toEqual({
      type: "image",
      data: "jpegBase64Data",
      mimeType: "image/jpeg",
    });
  });

  it("throws for image blob resource when model lacks vision", () => {
    const blocks: ContentBlock[] = [
      {
        type: "resource",
        resource: {
          uri: "file:///photo.jpg",
          mimeType: "image/jpeg",
          blob: "jpegBase64Data",
        },
      },
    ];
    expect(() => convertPromptContent(blocks, textOnlyModel)).toThrow(RequestError);
  });

  it("converts non-image blob resource to placeholder", () => {
    const blocks: ContentBlock[] = [
      {
        type: "resource",
        resource: {
          uri: "file:///doc.pdf",
          mimeType: "application/pdf",
          blob: "pdfBase64Data",
        },
      },
    ];
    const result = convertPromptContent(blocks, visionModel);
    expect(result.text).toBe("[Binary resource: file:///doc.pdf]");
    expect(result.images).toHaveLength(0);
  });

  it("converts resource_link to placeholder", () => {
    const blocks: ContentBlock[] = [
      {
        type: "resource_link",
        name: "README.md",
        uri: "file:///README.md",
      },
    ];
    const result = convertPromptContent(blocks, visionModel);
    expect(result.text).toBe("[Resource: file:///README.md]");
    expect(result.images).toHaveLength(0);
  });

  it("converts audio block to placeholder text", () => {
    const blocks: ContentBlock[] = [
      {
        type: "audio",
        data: "audioBase64",
        mimeType: "audio/wav",
      },
    ];
    const result = convertPromptContent(blocks, visionModel);
    expect(result.text).toBe("[Audio: audio/wav]");
    expect(result.images).toHaveLength(0);
  });

  it("handles mixed content blocks in order", () => {
    const blocks: ContentBlock[] = [
      { text: "Analyze this code:", type: "text" },
      {
        type: "resource",
        resource: {
          uri: "file:///src/app.ts",
          mimeType: "text/typescript",
          text: "export const app = {};",
        },
      },
      { text: "And this screenshot:", type: "text" },
      {
        type: "image",
        data: "screenshotBase64",
        mimeType: "image/png",
      },
    ];
    const result = convertPromptContent(blocks, visionModel);
    expect(result.text).toContain("Analyze this code:");
    expect(result.text).toContain("```text/typescript");
    expect(result.text).toContain("export const app = {};");
    expect(result.text).toContain("And this screenshot:");
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toEqual({
      type: "image",
      data: "screenshotBase64",
      mimeType: "image/png",
    });
  });

  it("handles empty content array", () => {
    const result = convertPromptContent([], visionModel);
    expect(result.text).toBe("");
    expect(result.images).toHaveLength(0);
  });
});

describe("deriveSessionName", () => {
  const createTextPrompt = (text: string): ContentBlock[] => [{ type: "text", text }];

  it("returns the trimmed first line of text", () => {
    expect(deriveSessionName(createTextPrompt("Hello, how are you?"))).toBe("Hello, how are you?");
  });

  it("truncates text longer than 50 characters", () => {
    const longText = "a".repeat(100);
    expect(deriveSessionName(createTextPrompt(longText))).toBe("a".repeat(50) + "...");
  });

  it("uses only the first line for session name", () => {
    expect(deriveSessionName(createTextPrompt("First line\nSecond line"))).toBe("First line");
  });

  it("returns undefined for slash commands", () => {
    expect(deriveSessionName(createTextPrompt("/unknown arg"))).toBeUndefined();
  });

  it("returns undefined for empty text", () => {
    expect(deriveSessionName(createTextPrompt(""))).toBeUndefined();
  });

  it("returns undefined for whitespace-only text", () => {
    expect(deriveSessionName(createTextPrompt("   \n  "))).toBeUndefined();
  });

  it("trims leading and trailing whitespace from first line", () => {
    expect(deriveSessionName(createTextPrompt("  Hello world  "))).toBe("Hello world");
  });

  it("returns undefined when first line after trimming starts with /", () => {
    expect(deriveSessionName(createTextPrompt("/help me"))).toBeUndefined();
  });

  it("returns text at 51 chars with ellipsis", () => {
    expect(deriveSessionName(createTextPrompt("a".repeat(51)))).toBe("a".repeat(50) + "...");
  });

  it("parsed content type with uri as filename", () => {
    expect(
      deriveSessionName([
        { type: "text", text: "Read " },
        {
          type: "resource",
          resource: {
            text: '{ \n  "name":  "azpi", \n  "version":  "0.1.0", \n  "private":  true, \n  "type":  "module", \n  "scripts":  { \n    "prepare":  "husky", \n    "test":  "bun test", \n    "build":  "bun run build: binary && bun run build: assets", \n    "build: binary":  "bun build src/index.ts --compile --minify --outfile dist/azpi", \n    "build: assets":  "cp -r package.json node_modules/@mariozechner/pi-coding-agent/dist/core/export-html node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/theme ./dist/", \n    "format":  "oxfmt --write", \n    "lint":  "oxlint --fix", \n    "check":  "tsc --noEmit"\n   }, \n  "dependencies":  { \n    "@agentclientprotocol/sdk":  "^0.21.0", \n    "@mariozechner/pi-ai":  "^0.73.0", \n    "@mariozechner/pi-coding-agent":  "^0.73.0"\n   }, \n  "devDependencies":  { \n    "@types/bun":  "latest", \n    "husky":  "^9.1.7", \n    "lint-staged":  "^16.4.0", \n    "oxfmt":  "^0.47.0", \n    "oxlint":  "^1.62.0"\n   }, \n  "peerDependencies":  { \n    "typescript":  "^5"\n   }, \n  "lint-staged":  { \n    "*.{ ts, tsx, js, jsx, mjs, cjs }":  [\n      "oxlint --fix"\n    ], \n    "*":  [\n      "oxfmt --write"\n    ]\n   }\n }\n',
            uri: "file: ///home/lkz/Repositories/azpi/package.json",
          },
        },
        {
          type: "audio",
          data: "audioBase64",
          mimeType: "audio/wav",
        },
      ]),
    ).toBe("Read [package.json][audio/wav]");
  });
});
