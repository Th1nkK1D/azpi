import { describe, expect, it } from "bun:test";
import { RequestError } from "@agentclientprotocol/sdk";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { convertPromptContent } from "../src/prompt-content";
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
