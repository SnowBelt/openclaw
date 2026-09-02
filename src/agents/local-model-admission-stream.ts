import type {
  AssistantMessageEventStreamLike,
  Context,
  Model,
  SimpleStreamOptions,
  StreamFn,
} from "../llm/types.js";
import {
  acquireSharedLocalModelAdmission,
  type LocalModelAdmissionLease,
} from "./local-model-admission.js";
import { createStreamIteratorWrapper } from "./stream-iterator-wrapper.js";

type AcquireSharedAdmission = (params: {
  owner: string;
  env?: NodeJS.ProcessEnv;
}) => Promise<LocalModelAdmissionLease>;

export function createLocalModelAdmissionStreamFn(params: {
  streamFn: StreamFn;
  owner: string;
  env?: NodeJS.ProcessEnv;
  acquire?: AcquireSharedAdmission;
}): StreamFn {
  const acquire = params.acquire ?? acquireSharedLocalModelAdmission;
  return async (
    model: Model,
    context: Context,
    options?: SimpleStreamOptions,
  ): Promise<AssistantMessageEventStreamLike> => {
    const lease = await acquire({ owner: params.owner, env: params.env });
    let released = false;
    const release = async (): Promise<void> => {
      if (released) {
        return;
      }
      released = true;
      await lease.release();
    };
    let stream: AssistantMessageEventStreamLike;
    try {
      stream = await params.streamFn(model, context, options);
    } catch (error) {
      try {
        await release();
      } catch {
        // Preserve the provider construction error.
      }
      throw error;
    }

    const iterator = stream[Symbol.asyncIterator]();
    const admittedIterator = createStreamIteratorWrapper({
      iterator,
      next: async (underlying) => {
        try {
          const result = await underlying.next();
          if (result.done) {
            await release();
          }
          return result;
        } catch (error) {
          try {
            await release();
          } catch {
            // Preserve the provider iterator error.
          }
          throw error;
        }
      },
      onReturn: async (underlying, value) => {
        try {
          return (await underlying.return?.(value)) ?? { done: true, value: undefined };
        } finally {
          await release();
        }
      },
      onThrow: async (underlying, error) => {
        try {
          return (await underlying.throw?.(error)) ?? { done: true, value: undefined };
        } finally {
          await release();
        }
      },
    });

    return {
      [Symbol.asyncIterator]: () => admittedIterator,
      result: async () => {
        try {
          return await stream.result();
        } finally {
          await release();
        }
      },
    };
  };
}
