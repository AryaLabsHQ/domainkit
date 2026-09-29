import { defineComponents } from "blume";

import BreadcrumbsWithSchema from "./components/BreadcrumbsWithSchema.astro";
import ProviderCard from "./components/ProviderCard.astro";
import ProviderLogo from "./components/ProviderLogo.astro";
import Snippet from "./components/Snippet.astro";

export default defineComponents({
  layout: {
    Breadcrumbs: BreadcrumbsWithSchema,
  },
  mdx: {
    ProviderCard,
    ProviderLogo,
    Snippet,
  },
});
