import { z } from "zod";

export const MODULES = ["lumaweave", "cerebra", "bonsai", "gwells", "general"] as const;
export const CATEGORIES = ["dev-log", "hot-take", "insight", "bug-hunt", "tool"] as const;

export const frontmatterSchema = z.object({
  title:       z.string().min(1).max(120),
  description: z.string().min(20).max(200),
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time:        z.string().regex(/^\d{2}:\d{2}(:\d{2})?[+-]\d{2}:\d{2}$/),
  section:     z.literal("dev"),
  category:    z.enum(CATEGORIES).default("dev-log"),
  // free string — validated against the project registry on the bumper side, not the schema (0.2.0)
  module:      z.string().min(1),
  version:     z.string().regex(/^v\d+(\.\d+){1,2}$/),
  tags:        z.array(z.string()).default([]),
  status:      z.enum(["draft", "published"]).default("published"),
  commit:      z.string().regex(/^[0-9a-f]{7}$/),
  bumpedBy:    z.string().regex(/^blog\.bumper@\d+\.\d+\.\d+$/),
});

export type Frontmatter = z.infer<typeof frontmatterSchema>;
