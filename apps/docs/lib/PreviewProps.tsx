import { DialRoot, useDialKit } from "dialkit";
import { useEffect, useMemo } from "react";

import {
  previewDialConfig,
  type PreviewDialValues,
} from "../islands/react-catalog/preview-dials.ts";
import type { PreviewState } from "../islands/react-catalog/preview-state.ts";
// oxlint-disable-next-line import/no-unassigned-import -- DialKit styles the on-demand props panel.
import "dialkit/styles.css";

interface Props {
  readonly colorScheme: PreviewState["colorScheme"];
  readonly initial: PreviewState;
  readonly onValuesChange: (values: PreviewDialValues) => void;
}

export default function PreviewProps({ colorScheme, initial, onValuesChange }: Props) {
  const config = useMemo(() => previewDialConfig(initial), [initial]);
  const values = useDialKit("Props", config, {
    id: `domainkit-preview-${initial.story}`,
  }) as PreviewDialValues;

  useEffect(() => onValuesChange(values), [onValuesChange, values]);

  return <DialRoot mode="inline" productionEnabled theme={colorScheme} />;
}
