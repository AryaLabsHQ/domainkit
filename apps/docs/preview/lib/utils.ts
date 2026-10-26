import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** The `cn` a shadcn install ships: a later utility replaces the one it conflicts with. */
export function cn(...inputs: ReadonlyArray<ClassValue>) {
  return twMerge(clsx(inputs));
}
