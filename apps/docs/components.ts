import { defineComponents } from "blume";

import ProviderCard from "./components/ProviderCard.astro";
import ProviderLogo from "./components/ProviderLogo.astro";
import ReactExample from "./components/ReactExample.astro";

export default defineComponents({ mdx: { ProviderCard, ProviderLogo, ReactExample } });
