import type { LucideIcon } from "lucide-react";
import { Blocks, Box, Braces, SquareFunction } from "lucide-react";
import type { SubBlockKind } from "@core/graph";

export const KIND_ICON: Record<SubBlockKind, LucideIcon> = {
  class: Box,
  function: SquareFunction,
  method: Braces,
  block: Blocks,
};
