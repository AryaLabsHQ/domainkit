import { defineComponents } from "blume";

import ProviderCard from "./components/ProviderCard.astro";
import ProviderLogo from "./components/ProviderLogo.astro";
import Snippet from "./components/Snippet.astro";

export default defineComponents({
  mdx: {
    ProviderCard,
    ProviderLogo,
    Snippet,
  },
});
