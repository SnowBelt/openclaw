// Control UI module keeps the legacy Chat renderer out of the initial bundle.
import { createLazyView, renderLazyView } from "../lazy-view.ts";
import type { ChatProps } from "../views/chat.ts";

export function createLazyChatRenderer(onChange?: () => void): (props: ChatProps) => unknown {
  const view = createLazyView(() => import("../views/chat.ts"), onChange);
  return (props) => renderLazyView(view, (module) => module.renderChat(props));
}
