// LLM Runtime module implements stream behavior.
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStreamContract,
  Context,
  Model,
  ProviderStreamOptions,
  SimpleStreamOptions,
  StreamOptions,
} from "@openclaw/llm-core";
import { createApiRegistry, type ApiRegistry } from "./api-registry.js";

/** Creates an isolated LLM runtime backed by the supplied provider registry. */
export function createLlmRuntime(registry: ApiRegistry = createApiRegistry()) {
  const MODEL_TRANSPORT_HOOKS = Symbol.for("openclaw.judge-transport-options.v1");

  function withModelTransportHooks<TOptions extends StreamOptions>(
    model: Model,
    options: TOptions | undefined,
  ): TOptions | undefined {
    const hooks = (model as Model & { [MODEL_TRANSPORT_HOOKS]?: { onDispatch?: () => void } })[
      MODEL_TRANSPORT_HOOKS
    ];
    if (typeof hooks?.onDispatch !== "function") {
      return options;
    }
    const inheritedDispatch = options?.onDispatch;
    return {
      ...options,
      onDispatch: async (dispatchedModel: Model) => {
        await inheritedDispatch?.(dispatchedModel);
        hooks.onDispatch?.();
      },
    } as unknown as TOptions;
  }

  function resolveApiProvider(api: Api) {
    const provider = registry.getApiProvider(api);
    if (!provider) {
      throw new Error(`No API provider registered for api: ${api}`);
    }
    return provider;
  }

  function stream<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ProviderStreamOptions,
  ): AssistantMessageEventStreamContract {
    return resolveApiProvider(model.api).stream(
      model,
      context,
      withModelTransportHooks(model, options as StreamOptions),
    );
  }

  async function complete<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ProviderStreamOptions,
  ): Promise<AssistantMessage> {
    return stream(model, context, options).result();
  }

  function streamSimple<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStreamContract {
    return resolveApiProvider(model.api).streamSimple(
      model,
      context,
      withModelTransportHooks(model, options),
    );
  }

  async function completeSimple<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: SimpleStreamOptions,
  ): Promise<AssistantMessage> {
    return streamSimple(model, context, options).result();
  }

  return { registry, stream, complete, streamSimple, completeSimple };
}

export type LlmRuntime = ReturnType<typeof createLlmRuntime>;
