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

// Подбор представителей: по одному на каждый тег; если внутри тега есть контакты
// и на «ты», и на «вы» — по одному на каждое обращение (раздел 5a; теги заменили
// упразднённые типы отношений). Контакты без тегов — отдельная группа.
// Один контакт не представляет две группы — берём следующего по рангу.
export function pickRepresentatives(
  contacts: Contact[],
  tagsByContact: Map<string, string[]>,
): RepSelection {
  const groups = new Map<string, Contact[]>();
  for (const c of contacts) {
    const addr = c.address_form ?? "—";
    const tags = tagsByContact.get(c.id) ?? [];
    const keys = tags.length ? tags.map((t) => `${t} | ${addr}`) : [`без тегов | ${addr}`];
    for (const key of keys) {
      const arr = groups.get(key) ?? [];
      arr.push(c);
      groups.set(key, arr);
    }
  }

  const used = new Set<string>();
  const allReps: Representative[] = [];
  const sortedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  for (const key of sortedKeys) {
    // Представитель — контакт с самым насыщенным контекстом (лучше для генерации).
    const ranked = [...(groups.get(key) ?? [])].sort(
      (a, b) =>
        (b.context_notes?.length ?? 0) - (a.context_notes?.length ?? 0) ||
        (b.closeness ?? 0) - (a.closeness ?? 0) ||
        a.name.localeCompare(b.name),
    );
    const best = ranked.find((c) => !used.has(c.id));
    if (!best) continue; // вся группа уже представлена через другие теги
    used.add(best.id);
    const [tag, addr] = key.split(" | ");
    allReps.push({
      contact: best,
      groupLabel: `${tag}${addr !== "—" ? `, на «${addr}»` : ""}`,
    });
  }

  return {
    reps: allReps.slice(0, TRAINING_LIMIT),
    totalGroups: groups.size,
    capped: allReps.length > TRAINING_LIMIT,
  };
}
