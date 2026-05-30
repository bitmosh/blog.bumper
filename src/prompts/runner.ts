import { input, select, confirm } from "@inquirer/prompts";

export type PromptType = "text" | "select" | "confirm" | "custom";

export type Choice = { name: string; value: string };

export type PromptDef<A extends Record<string, unknown> = Record<string, unknown>> = {
  key: string;
  type: PromptType;
  message: string;
  default?: unknown;
  choices?: Choice[];
  validate?: (value: unknown) => true | string;
  when?: (answers: A) => boolean;
  /** Only for type:"custom" — runs arbitrary async logic and returns the collected value. */
  custom?: (answers: A) => Promise<unknown>;
};

/**
 * Generic interview loop. Knows nothing about blog.bumper.
 * Takes a prompt manifest, runs through it in order, returns a flat answers map.
 * Keys beginning with "_" are internal (e.g. shared guild ID) and survive in answers
 * for downstream prompts but can be stripped by the caller before writing config.
 */
export async function runWizard(
  manifest: PromptDef[],
): Promise<Record<string, unknown>> {
  const answers: Record<string, unknown> = {};

  for (const def of manifest) {
    if (def.when && !def.when(answers)) continue;

    let value: unknown;

    switch (def.type) {
      case "text":
        value = await input({
          message: def.message,
          default: def.default as string | undefined,
          validate: def.validate
            ? (v: string) => (def.validate as (v: unknown) => true | string)(v)
            : undefined,
        });
        break;

      case "select":
        value = await select<string>({
          message: def.message,
          choices: def.choices ?? [],
          default: def.default as string | undefined,
        });
        break;

      case "confirm":
        value = await confirm({
          message: def.message,
          default: def.default as boolean | undefined,
        });
        break;

      case "custom":
        if (!def.custom) {
          throw new Error(`PromptDef key="${def.key}" has type:"custom" but no custom fn`);
        }
        value = await def.custom(answers);
        break;
    }

    answers[def.key] = value;
  }

  return answers;
}
