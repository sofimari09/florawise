import { z } from "zod/v4";

export const identityInput = {
  name: z.string().optional(),
  personalName: z.string().nullable().optional(),
  speciesId: z.number().int().positive(),
};

export const normalizeSearch = (value: string) =>
  value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("uk-UA");

/** Legacy name is accepted only as an alias, never as botanical identity. */
export function resolvePlantName(
  data: { name?: string; personalName?: string | null },
  speciesName: string,
  existing?: { personalName: string | null },
) {
  const supplied = data.personalName !== undefined ? data.personalName : data.name;
  const personalName = supplied === undefined
    ? existing?.personalName ?? null
    : supplied?.trim() || null;
  return { personalName, name: personalName ?? speciesName };
}
