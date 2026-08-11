// Project Command Center view. Rendering stays separate from gateway/controller concerns.
import type { TemplateResult } from "lit";
import { renderPccDashboard, type PccPresentationProps } from "../pcc/presentation/render.ts";

export type PccProps = PccPresentationProps;

export function renderPcc(props: PccProps): TemplateResult {
  return renderPccDashboard(props);
}
