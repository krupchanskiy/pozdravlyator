import type { Contact } from "./types";

// Лимит представителей за одну сессию тренировки (раздел 5a).
export const TRAINING_LIMIT = 8;

export interface Representative {
  contact: Contact;
  groupLabel: string;
}

export interface RepSelection {
  reps: Representative[];
  totalGroups: number;
  capped: boolean;
}

// Подбор представителей: по одному на каждый relationship_type; если внутри типа
// есть контакты и на «ты», и на «вы» — по одному на каждое обращение (раздел 5a).
export function pickRepresentatives(contacts: Contact[]): RepSelection {
  const groups = new Map<string, Contact[]>();
  for (const c of contacts) {
    const rel = c.relationship_type?.trim() || "без типа";
    const addr = c.address_form ?? "—";
    const key = `${rel} | ${addr}`;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }

  const allReps: Representative[] = [];
  for (const [key, members] of groups) {
    // Представитель — контакт с самым насыщенным контекстом (лучше для генерации).
    const best = [...members].sort(
      (a, b) =>
        (b.context_notes?.length ?? 0) - (a.context_notes?.length ?? 0) ||
        (b.closeness ?? 0) - (a.closeness ?? 0) ||
        a.name.localeCompare(b.name),
    )[0];
    const [rel, addr] = key.split(" | ");
    const label = `${rel}${addr !== "—" ? `, на «${addr}»` : ""}`;
    allReps.push({ contact: best, groupLabel: label });
  }

  allReps.sort((a, b) => a.groupLabel.localeCompare(b.groupLabel));
  const totalGroups = allReps.length;
  return {
    reps: allReps.slice(0, TRAINING_LIMIT),
    totalGroups,
    capped: totalGroups > TRAINING_LIMIT,
  };
}
