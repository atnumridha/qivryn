import { ChatMessage, IDE, PromptLog } from "core";
import {
  FromWebviewProtocol,
  ToCoreProtocol,
  ToWebviewProtocol,
} from "core/protocol";
import { Message } from "core/protocol/messenger";
import { MessageIde } from "core/protocol/messenger/messageIde";
import {
  GeneratorReturnType,
  GeneratorYieldType,
  WebviewSingleProtocolMessage,
} from "core/protocol/util";
import { IIdeMessenger } from "./IdeMessenger";

type MockResponses = Partial<{
  [K in keyof FromWebviewProtocol]: FromWebviewProtocol[K][1];
}>;

export type MockResponseHandler<T extends keyof FromWebviewProtocol> = (
  input: FromWebviewProtocol[T][0],
) => Promise<FromWebviewProtocol[T][1]>;

type MockResponseHandlers = Partial<{
  [K in keyof FromWebviewProtocol]: MockResponseHandler<K>;
}>;

const DEFAULT_MOCK_CORE_RESPONSES: MockResponses = {
  fileExists: true,
  getCurrentFile: {
    isUntitled: false,
    contents: "Current file contents",
    path: "file:///Users/user/workspace1/current_file.py",
  },
  getWorkspaceDirs: [
    "file:///Users/user/workspace1",
    "file:///Users/user/workspace2",
  ],
  "history/list": [],
  "session/openInMain": false,
  "agents/selectRepository": undefined,
  "agents/list": [],
  "agents/automations": [],
  "agents/queue": [],
  "agents/checkpoints": [],
  "agents/plans": [],
  "agents/events": [],
  "agents/status": {
    state: "ready",
    checkedAt: "2026-06-30T00:00:00.000Z",
    source: "bundled",
    capabilities: {
      local: true,
      remote: false,
      persistent: true,
      worktrees: true,
      checkpoints: true,
      browser: false,
      review: false,
      maxConcurrency: 4,
    },
  },
  "reviews/list": [],
  "reviews/get": undefined,
  "reviews/comments": [],
  getTerminalContents: "npm test\nError: expected 1 to equal 2",
  getFileResults: [],
  runCommand: undefined,
  "terminal/jobs": [],
  "extensions/skills": { skills: [], errors: [] },
  "extensions/plugins": [],
  "extensions/skillSave": {
    name: "Example skill",
    description: "Example skill",
    path: ".qivryn/skills/example-skill/SKILL.md",
    sourceFile: "file:///workspace/.qivryn/skills/example-skill/SKILL.md",
    provenance: "Qivryn",
    readOnly: false,
    scope: "workspace",
    content: "Example instructions",
    files: [],
  },
  "browser/list": [],
  "browser/events": [],
  "browser/grants": [],
  "slack/status": undefined,
  "slack/channels": [],
  "slack/messages": [],
  "slack/revoke": undefined,
  "docs/getIndexedPages": [],
  "history/save": undefined,
  "config/getSerializedProfileInfo": {
    profileId: "local",
    profiles: [],
    result: {
      config: {
        tools: [],
        slashCommands: [],
        contextProviders: [],
        mcpServerStatuses: [],
        modelsByRole: {
          chat: [],
          apply: [],
          edit: [],
          summarize: [],
          autocomplete: [],
          rerank: [],
          embed: [],
          subagent: [],
        },
        selectedModelByRole: {
          chat: null,
          apply: null,
          edit: null,
          summarize: null,
          autocomplete: null,
          rerank: null,
          embed: null,
          subagent: null,
        },
        rules: [],
      },
      errors: [],
      configLoadInterrupted: false,
    },
  },
  "chatDescriber/describe": "Session summary",
  "voice/transcribe": { text: "Transcribed voice input" },
  "voice/transcribeCancel": undefined,
  "voice/captureStart": { captureId: "host-capture", recorder: "ffmpeg" },
  "voice/captureStop": {
    audioBase64: "UklGRg==",
    mimeType: "audio/wav",
  },
  "voice/captureCancel": undefined,
  applyToFile: undefined,
  acceptDiff: undefined,
  readFile: "File contents",
  "tools/call": {
    contextItems: [
      {
        content: "Tool call executed successfully",
        name: "Tool Result",
        description: "Mock tool result",
      },
    ],
  },
  "context/getSymbolsForFiles": {},
  "tools/preprocessArgs": {
    preprocessedArgs: undefined,
  },
  "llm/compileChat": {
    compiledChatMessages: [],
    didPrune: false,
    contextPercentage: 0.5,
  },
  "context/getContextItems": [
    {
      id: {
        providerTitle: "mock",
        itemId: "mock",
      },
      content: "Mock current file content",
      name: "Mock File",
      description: "Mock file for testing",
      uri: {
        type: "file",
        value: "file:///Users/test/mock-file.ts",
      },
    },
  ],
};

const DEFAULT_MOCK_CORE_RESPONSE_HANDLERS: MockResponseHandlers = {
  "tools/evaluatePolicy": async (data) => {
    return {
      policy: data.basePolicy,
      displayValue: undefined,
    };
  },
};

const DEFAULT_CHAT_RESPONSE: ChatMessage[] = [
  {
    role: "assistant",
    content: "This is a test",
  },
];
export class MockIdeMessenger implements IIdeMessenger {
  ide: IDE;

  constructor() {
    this.ide = new MessageIde(
      async (messageType, data) => {
        const response = await this.request.bind(this)(messageType, data);
        if (response.status === "error") {
          throw new Error(response.error);
        } else {
          return response.content;
        }
      },
      (messageType, callback) => {
        return;
      },
    );
  }

  /**
   * Simulates a message being sent from the IDE to the webview
   * @param messageType The type of message to send
   * @param data The data to send with the message
   */
  mockMessageToWebview<T extends keyof ToWebviewProtocol>(
    messageType: T,
    data: ToWebviewProtocol[T][0],
  ): void {
    // Create a message object that matches what the useWebviewListener hook expects
    const messageData: Message<ToWebviewProtocol[T][0]> = {
      messageType,
      data,
      messageId: `mock-${Date.now()}-${Math.random().toString(36).substring(2)}`,
    };

    // Dispatch a custom message event that the window event listener will pick up
    window.dispatchEvent(
      new MessageEvent("message", {
        data: messageData,
        origin: window.location.origin,
      }),
    );
  }

  responses: MockResponses = { ...DEFAULT_MOCK_CORE_RESPONSES };
  responseHandlers: MockResponseHandlers = {
    ...DEFAULT_MOCK_CORE_RESPONSE_HANDLERS,
  };
  chatResponse: ChatMessage[] = DEFAULT_CHAT_RESPONSE;
  chatStreamDelay: number = 0;
  streamChunks: Partial<Record<string, unknown[][]>> = {};
  setChatResponseText(text: string): void {
    this.chatResponse = [
      {
        role: "assistant",
        content: text,
      },
    ];
  }

  async *llmStreamChat(
    msg: ToCoreProtocol["llm/streamChat"][0],
    cancelToken: AbortSignal,
  ): AsyncGenerator<ChatMessage[], PromptLog | undefined> {
    for (const response of this.chatResponse) {
      if (cancelToken.aborted) {
        console.log("MockIdeMessenger: Stream aborted");
        return undefined;
      }
      console.log(
        "MockIdeMessenger: Yielding chunk",
        JSON.stringify(response, null, 2),
      );
      yield [response];
      if (this.chatStreamDelay > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.chatStreamDelay),
        );
      }
    }
    return undefined;
  }

  post<T extends keyof FromWebviewProtocol>(
    messageType: T,
    data: FromWebviewProtocol[T][0],
    messageId?: string,
    attempt?: number,
  ): void {}

  async request<T extends keyof FromWebviewProtocol>(
    messageType: T,
    data: FromWebviewProtocol[T][0],
  ): Promise<WebviewSingleProtocolMessage<T>> {
    if (this.responseHandlers[messageType]) {
      const content = await this.responseHandlers[messageType](data);
      return {
        status: "success",
        content,
        done: true,
      };
    }
    if (messageType in this.responses) {
      const content = this.responses[messageType];
      return {
        status: "success",
        content,
        done: true,
      };
    }
    console.error(messageType);
    throw new Error(
      "MockIdeMessenger: No response handler or response defined for " +
        messageType,
    );
  }

  respond<T extends keyof ToWebviewProtocol>(
    messageType: T,
    data: ToWebviewProtocol[T][1],
    messageId: string,
  ): void {}

  async *streamRequest<T extends keyof FromWebviewProtocol>(
    messageType: T,
    data: FromWebviewProtocol[T][0],
    cancelToken?: AbortSignal,
  ): AsyncGenerator<
    GeneratorYieldType<FromWebviewProtocol[T][1]>[],
    GeneratorReturnType<FromWebviewProtocol[T][1]> | undefined
  > {
    const chunks = this.streamChunks[String(messageType)] ?? [];
    for (const chunk of chunks) {
      if (cancelToken?.aborted) return undefined;
      yield chunk as GeneratorYieldType<FromWebviewProtocol[T][1]>[];
    }
    while (chunks.length > 0 && cancelToken && !cancelToken.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return undefined;
  }

  resetMocks(): void {
    this.responses = { ...DEFAULT_MOCK_CORE_RESPONSES };
    this.responseHandlers = { ...DEFAULT_MOCK_CORE_RESPONSE_HANDLERS };
    this.chatResponse = DEFAULT_CHAT_RESPONSE;
    this.chatStreamDelay = 0;
    this.streamChunks = {};
  }
}
