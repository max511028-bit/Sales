import { stageOf } from "./fields";
import type { EntityType, RawRecord, StoredEntity } from "./types";

export interface FunnelStep {
  key: string;
  label: string;
  order: number;
  kind: "active" | "success" | "loss" | "service";
}

const LEAD_STEPS: FunnelStep[] = [
  { key: "new", label: "Поступило лидов", order: 1, kind: "active" },
  { key: "processing", label: "Взято в обработку", order: 2, kind: "active" },
  { key: "contact", label: "Удалось дозвониться", order: 3, kind: "active" },
  { key: "target", label: "Целевой лид", order: 4, kind: "success" },
  { key: "deferred", label: "Отложено", order: 5, kind: "active" },
  { key: "lost", label: "Потеряно", order: 90, kind: "loss" },
  { key: "service", label: "Технические", order: 99, kind: "service" },
];

const DEAL_STEPS: FunnelStep[] = [
  { key: "new", label: "Создана сделка", order: 1, kind: "active" },
  { key: "qualification", label: "Квалификация", order: 2, kind: "active" },
  { key: "work", label: "Проработка", order: 3, kind: "active" },
  { key: "proposal", label: "КП / предложение", order: 4, kind: "active" },
  { key: "agreement", label: "Согласование", order: 5, kind: "active" },
  { key: "success", label: "Договор / старт", order: 6, kind: "success" },
  { key: "lost", label: "Потеряно", order: 90, kind: "loss" },
  { key: "service", label: "Технические", order: 99, kind: "service" },
];

export function funnelSteps(type: EntityType) {
  return type === "lead" ? LEAD_STEPS : DEAL_STEPS;
}

export function normalizeStage(text: string) {
  return text.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

export function classifyStage(type: EntityType, stage: string): FunnelStep {
  const normalized = normalizeStage(stage);
  const steps = funnelSteps(type);
  const byKey = (key: string) => steps.find((step) => step.key === key)!;

  if (!normalized || normalized.includes("дубль") || normalized.includes("тест")) return byKey("service");

  if (type === "lead") {
    if (normalized.includes("не обработан")) return byKey("new");
    if (normalized.includes("в работе") || normalized.includes("поиск контактов")) return byKey("processing");
    if (normalized.includes("обработан") || normalized.includes("связь установлена") || normalized.includes("существующий клиент")) {
      return byKey("contact");
    }
    if (normalized.includes("качественный лид")) return byKey("target");
    if (normalized.includes("отлож")) return byKey("deferred");
    if (
      normalized.includes("недозвон") ||
      normalized.includes("нецелевой") ||
      normalized.includes("некачественный") ||
      normalized.includes("закрывают потребность")
    ) {
      return byKey("lost");
    }
    return byKey("processing");
  }

  if (normalized.includes("новая сделка")) return byKey("new");
  if (normalized.includes("квалификация") || normalized.includes("поиск контактов")) return byKey("qualification");
  if (normalized.includes("в работе") || normalized.includes("проработка") || normalized.includes("нужен подбор") || normalized.includes("мониторинг")) {
    return byKey("work");
  }
  if (normalized.includes("кп")) return byKey("proposal");
  if (normalized.includes("согласование")) return byKey("agreement");
  if (
    normalized.includes("вышел первый") ||
    normalized.includes("передан акаунт") ||
    normalized.includes("передан аккаунт") ||
    normalized.includes("проект закончен")
  ) {
    return byKey("success");
  }
  if (normalized.includes("существующий клиент")) return byKey("success");
  return byKey("lost");
}

export function lossReasonFor(type: EntityType, stage: string) {
  const normalized = normalizeStage(stage);
  if (!normalized) return "Без стадии";
  if (normalized.includes("дубль")) return "Дубль";
  if (normalized.includes("тест")) return "Тест";

  if (type === "lead") {
    if (normalized.includes("недозвон")) return "Не дозвонились";
    if (normalized.includes("нецелевой")) return "Нецелевой клиент";
    if (normalized.includes("некачественный")) return "Некачественный лид";
    if (normalized.includes("закрывают потребность")) return "Закрывают сами";
    if (normalized.includes("отлож")) return "Отложено";
    return "Другая причина";
  }

  if (normalized.includes("нет потребности")) return "Нет потребности";
  if (normalized.includes("не вышел") || normalized.includes("не отвечает")) return "Не выходит на связь";
  if (normalized.includes("маленький объем")) return "Маленький объем";
  if (normalized.includes("не предоставляем") || normalized.includes("субподряд")) return "Не наш профиль";
  if (normalized.includes("дорого") || normalized.includes("ставка")) return "Цена / экономика";
  if (normalized.includes("конкурент")) return "Конкурент";
  if (normalized.includes("сб")) return "Безопасность / отказ";
  if (normalized.includes("тендер")) return "Тендер не состоялся";
  if (normalized.includes("ликвидирована")) return "Компания ликвидирована";
  return "Другая причина";
}

export function funnelDistribution(rows: StoredEntity[], type: EntityType) {
  const counts = new Map(funnelSteps(type).map((step) => [step.key, { ...step, value: 0 }]));
  rows.forEach((row) => {
    const step = classifyStage(type, stageOf(type, row.raw));
    const current = counts.get(step.key);
    if (current) current.value += 1;
  });
  return [...counts.values()].filter((step) => step.value > 0).sort((a, b) => a.order - b.order);
}

export function cumulativeLeadFunnel(leads: StoredEntity[], dealsCreated: number, contracts: number) {
  const nonService = leads.filter((lead) => classifyStage("lead", stageOf("lead", lead.raw)).kind !== "service");
  const contacted = nonService.filter((lead) => {
    const step = classifyStage("lead", stageOf("lead", lead.raw));
    return ["contact", "target", "deferred"].includes(step.key);
  });
  const target = nonService.filter((lead) => classifyStage("lead", stageOf("lead", lead.raw)).key === "target");
  return [
    { name: "Поступило лидов", value: nonService.length },
    { name: "Удалось дозвониться", value: contacted.length },
    { name: "Целевые лиды", value: target.length },
    { name: "Создано сделок", value: dealsCreated },
    { name: "Заключено договоров", value: contracts },
  ];
}

export function leadOnlyFunnel(leads: StoredEntity[]) {
  const nonService = leads.filter((lead) => classifyStage("lead", stageOf("lead", lead.raw)).kind !== "service");
  const contacted = nonService.filter((lead) => {
    const step = classifyStage("lead", stageOf("lead", lead.raw));
    return ["contact", "target", "deferred"].includes(step.key);
  });
  const target = nonService.filter((lead) => classifyStage("lead", stageOf("lead", lead.raw)).key === "target");
  const lost = nonService.filter((lead) => classifyStage("lead", stageOf("lead", lead.raw)).kind === "loss");
  return [
    { key: "new", label: "Поступило лидов", order: 1, kind: "active" as const, value: nonService.length },
    { key: "contact", label: "Удалось дозвониться", order: 2, kind: "active" as const, value: contacted.length },
    { key: "target", label: "Целевые лиды", order: 3, kind: "success" as const, value: target.length },
    { key: "lost", label: "Потеряно лидов", order: 4, kind: "loss" as const, value: lost.length },
  ];
}

export function stageTitle(type: EntityType, record: RawRecord) {
  return classifyStage(type, stageOf(type, record)).label;
}
